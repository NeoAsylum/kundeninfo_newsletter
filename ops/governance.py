"""Erzeugt die Unterlagen in docs/governance/: Stücklisten (SBOM), die lesbare Komponentenliste
und das Ergebnis der Schwachstellenanalyse (RUNBOOK 5b, ADR-0026).

    python ops/governance.py erzeuge   # liest die gebauten Images — braucht Docker und Netz
    python ops/governance.py bericht   # schreibt nur die beiden Markdown-Dokumente neu, ohne
                                       # Docker (etwa nach einer Änderung an der Bewertung)

Nur Standardbibliothek. Kein Bind-Mount und kein Docker-Socket im Scanner: Ein Image geht als
Archiv über die Standardeingabe in den Container, das Ergebnis kommt über die Standardausgabe
zurück. Der Scan selbst läuft ohne Netz; ins Netz gehen das Laden des Scanner-Image und der
Schwachstellen-Datenbank, die Installation des SBOM-Werkzeugs und die Abfrage, ob die Registry
ein neueres Basis-Image führt.
"""

import argparse
import datetime
import email.header
import email.utils
import io
import json
import pathlib
import re
import subprocess
import sys
import tarfile
import tomllib
from typing import Any

REPO = pathlib.Path(__file__).resolve().parents[1]
ZIEL = REPO / "docs" / "governance"
APP_SBOM = ZIEL / "stoerungsinfo-app.cdx.json"
SCAN = ZIEL / "schwachstellen.json"
BEWERTUNG = ZIEL / "schwachstellen-bewertung.toml"
KOMPONENTEN_MD = ZIEL / "KOMPONENTEN.md"
SCHWACHSTELLEN_MD = ZIEL / "SCHWACHSTELLEN.md"

# Per Digest gepinnt: Im März 2026 lagen unter den Tags 0.69.4 bis 0.69.6 manipulierte Images
# (GHSA-69fq-xp46-6x23); per Digest bezogene Images waren nicht betroffen.
TRIVY = (
    "aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa"
)
TRIVY_CACHE = "stoerungsinfo-trivy-cache"
TRIVY_SCHALTER = (
    "--cache-dir /cache --skip-db-update --skip-java-db-update --offline-scan "
    "--skip-version-check --disable-telemetry --no-progress --quiet"
)
CYCLONEDX_BOM = "7.5.0"

# Die Images, die dieses Projekt baut. Der Tag von keycloak steht fest in compose.dev.yaml.
IMAGES: dict[str, dict[str, Any]] = {
    "api": {
        "tag": None,
        "dockerfile": "backend/Dockerfile",
        "inhalt": "Anwendung (FastAPI, Versand-Worker)",
    },
    "nginx": {
        "tag": None,
        "dockerfile": "deploy/nginx/Dockerfile",
        "inhalt": "Reverse Proxy, liefert die Oberfläche aus",
    },
    "postgres": {
        "tag": None,
        "dockerfile": "deploy/postgres/Dockerfile",
        "inhalt": "Datenbank",
    },
    "keycloak": {
        "tag": "dev",
        "dockerfile": "deploy/keycloak/Dockerfile",
        "inhalt": "Anmeldung in DEV und im Pilot (in PROD: der IdP des Konzerns)",
    },
}

# Von Hand gepflegt: was die Stücklisten der Images nicht oder nicht als Hauptsache zeigen.
# Aus Quelltext gebaute Programme (Python, PostgreSQL) kennt kein Paketverzeichnis des Images,
# Trivy sieht sie deshalb nicht („im_scan“: False) — sie kommen von hier in die Stückliste des
# Image. Die Version liest das Skript aus den Umgebungsvariablen des gebauten Image, bei
# Keycloak aus dem Tag der FROM-Zeile (BASIS).
HAUPTKOMPONENTEN: list[dict[str, Any]] = [
    {
        "name": "Python (CPython)",
        "purl": "python",
        "version": ("api", "PYTHON_VERSION"),
        "urheber": "Python Software Foundation",
        "lizenz": "PSF-2.0",
        "rolle": "Laufzeit der Anwendung",
        "im_scan": False,
    },
    {
        "name": "NGINX",
        "version": ("nginx", "NGINX_VERSION"),
        "urheber": "Igor Sysoev, Nginx, Inc.",
        "lizenz": "BSD-2-Clause",
        "rolle": "Reverse Proxy, liefert die Oberfläche aus",
        "im_scan": True,
    },
    {
        "name": "PostgreSQL",
        "purl": "postgresql",
        "version": ("postgres", "PG_VERSION"),
        "urheber": "PostgreSQL Global Development Group",
        "lizenz": "PostgreSQL",
        "rolle": "Datenbank",
        "im_scan": False,
    },
    {
        "name": "gosu",
        "version": ("postgres", "GOSU_VERSION"),
        "urheber": "Tianon Gravi",
        "lizenz": "Apache-2.0",
        "rolle": "wechselt beim Start des Datenbank-Containers von root auf das Dienstkonto",
        "im_scan": True,
    },
    {
        "name": "Keycloak",
        "version": ("keycloak", "BASIS"),
        "urheber": "Red Hat, Inc. und Mitwirkende (Projekt der CNCF)",
        "lizenz": "Apache-2.0",
        "rolle": "Anmeldung in DEV und im Pilot — in PROD der IdP des Konzerns",
        "im_scan": True,
    },
]
# Unverändert bezogene Images, per Digest gepinnt; nicht Teil der Stücklisten und des Scans.
FREMD_IMAGES = [
    {
        "name": "Mailpit",
        "muster": r"axllent/mailpit:v?([\w.]+)@",
        "datei": "compose.dev.yaml",
        "urheber": "Ralph Slooten",
        "lizenz": "MIT",
        "rolle": "fängt Mails ab — nur DEV",
    },
    {
        "name": "Certbot",
        "muster": r"certbot/certbot:v?([\w.]+)@",
        "datei": "compose.public.yaml",
        "urheber": "Electronic Frontier Foundation",
        "lizenz": "Apache-2.0",
        "rolle": "holt das TLS-Zertifikat — nur Pilot",
    },
]

# Lizenz laut Lizenztext der Distribution, wo die Angabe des Pakets mehrdeutig ist. Im Image
# nachgelesen: Jinja2 nennt nur „BSD License“ (licenses/LICENSE.txt: drei Bedingungen); uvloop
# nennt MIT und Apache nebeneinander (LICENSE-MIT, LICENSE-APACHE: wahlweise).
LIZENZ_LAUT_TEXT = {"jinja2": "BSD-3-Clause", "uvloop": "MIT OR Apache-2.0"}
# Die Pakete von nginx.org nennen als Lizenz den Freitext „2-clause BSD-like license“. Für
# NGINX, seine Module und njs stimmt das (COPYRIGHT im Image: BSD mit zwei Bedingungen);
# das ACME-Modul steht laut seinem COPYRIGHT im Image unter der Apache License 2.0.
NGINX_ORG_LIZENZ = {"nginx-module-acme": "Apache-2.0"}
# Trove-Classifier, die neben einer SPDX-Kennung derselben Lizenzfamilie nichts Neues sagen
CLASSIFIER_FAMILIEN = {
    "License :: OSI Approved :: BSD License": "BSD-",
    "License :: OSI Approved :: Apache Software License": "Apache-",
    "License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "License :: OSI Approved :: MIT License": "MIT",
}

SCHWEREGRADE = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
# Einzeln bewertet: was hoch eingestuft ist — und was noch gar nicht eingestuft ist.
BEWERTET = ("CRITICAL", "HIGH", "UNKNOWN")
# Statuswörter und Begründungen wie bei VEX (CISA, „Minimum Requirements for VEX“, 2023)
STATUS = {
    "not_affected": "nicht betroffen",
    "affected": "betroffen",
    "fixed": "behoben",
    "under_investigation": "in Prüfung",
}
BEGRUENDUNGEN = {
    "component_not_present": "Komponente nicht enthalten",
    "vulnerable_code_not_present": "verwundbarer Code nicht enthalten",
    "vulnerable_code_not_in_execute_path": "verwundbarer Code wird nicht ausgeführt",
    "vulnerable_code_cannot_be_controlled_by_adversary": (
        "Angreifer kann den verwundbaren Code nicht ansteuern"
    ),
    "inline_mitigations_already_exist": "vorhandene Schutzmaßnahme greift",
}
STATUS_DER_QUELLE = {
    "fixed": "Korrektur verfügbar",
    "affected": "keine Korrektur verfügbar",
    "fix_deferred": "Korrektur zurückgestellt",
    "will_not_fix": "wird nicht korrigiert",
    "end_of_life": "Version ohne Pflege",
}
BASIS_STAND = {True: "aktuell", False: "**neueres verfügbar**", None: "nicht geprüft"}
ARTEN = {
    "debian": "Debian-Paket",
    "alpine": "Alpine-Paket",
    "redhat": "RPM-Paket",
    "python-pkg": "Python-Paket",
    "jar": "Java-Bibliothek",
    "gobinary": "Go-Modul",
    "cargo": "Rust-Bibliothek",
}
# Art einer mitgelieferten Komponente nach ihrer Paket-URL (purl)
FELDER_DER_BEWERTUNG = {
    "image", "paket", "ort", "cves", "status", "warum", "begruendung", "massnahme", "stand",
}  # fmt: skip
ARTEN_NACH_PURL = {
    "pkg:cargo": "Rust-Bibliothek",
    "pkg:rpm": "RPM-Paket aus dem Bau des Pakets",
    "pkg:pypi": "Python-Paket",
    "pkg:generic": "aus Quelltext gebaut",
}

# Läuft im api-Image: je installierter Distribution die Urheberangaben, wie das Paket sie
# nennt, und die Stücklisten, die es selbst mitbringt (für fest eingebaute Bibliotheken).
METADATEN_SKRIPT = """
import importlib.metadata as md, json
felder = ["Name", "Author", "Author-email", "Maintainer", "Maintainer-email"]
import decimal, pyexpat
eingebaut = {
    "EXPAT_VERSION": pyexpat.EXPAT_VERSION.removeprefix("expat_"),
    "MPDEC_VERSION": decimal.__libmpdec_version__,
}
aus = [{"Name": None, "Eingebaut": eingebaut, "Stuecklisten": []}]
for d in md.distributions():
    eintrag = {f: d.metadata.get(f) for f in felder}
    dateien = [f for f in d.files or [] if "/sboms/" in str(f) or str(f).endswith("bom.cdx.json")]
    eintrag["Stuecklisten"] = [
        {"datei": str(f), "inhalt": json.loads(f.read_text(encoding="utf-8"))} for f in dateien
    ]
    aus.append(eintrag)
print(json.dumps(aus))
"""


# ---------- Urheber und Lizenzen ----------


def _ohne_adresse(text: str) -> str:
    """„Name <adresse@host>“ ohne den Teil in spitzen Klammern."""
    return re.sub(r"\s*<[^<>@]*@[^<>]*>", "", text).strip()


def _namen(freitext: str | None, adressen: str | None) -> list[str]:
    """Namen aus einem Feldpaar der Paket-Metadaten (Author/Author-email oder
    Maintainer/Maintainer-email) — ohne Adressen. Ein Feld kann mehrere Namen tragen."""
    namen = [teil.strip() for teil in _ohne_adresse(freitext or "").split(",")]
    for anzeige, _adresse in email.utils.getaddresses([adressen or ""]):
        klartext = str(email.header.make_header(email.header.decode_header(anzeige)))
        namen += [teil.strip() for teil in klartext.split(",")]
    eindeutig: list[str] = []
    for name in namen:
        if name and "@" not in name and name not in eindeutig:
            eindeutig.append(name)
    return eindeutig


def autoren(metadaten: dict) -> list[str]:
    """Die Autoren, die ein Paket angibt; nennt es keine, seine Betreuer (Maintainer)."""
    return _namen(metadaten.get("Author"), metadaten.get("Author-email")) or _namen(
        metadaten.get("Maintainer"), metadaten.get("Maintainer-email")
    )


def _kanonisch(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def lizenzen(komponente: dict) -> list[str]:
    """SPDX-Kennungen bzw. -Ausdrücke einer Komponente, ersatzweise die genannten Namen."""
    gefunden = []
    for eintrag in komponente.get("licenses", []):
        lizenz = eintrag.get("license", {})
        gefunden.append(eintrag.get("expression") or lizenz.get("id") or lizenz.get("name") or "")
    return [lizenz for lizenz in gefunden if lizenz]


def lizenzen_bereinigen(komponente: dict) -> None:
    """cyclonedx-py führt neben einer SPDX-Kennung teils noch den Trove-Classifier derselben
    Lizenz. Er entfällt, wo die Kennung derselben Familie steht — ein Classifier einer
    anderen Lizenz bleibt. Für Pakete mit mehrdeutiger Angabe gilt der Lizenztext
    (LIZENZ_LAUT_TEXT)."""
    name = _kanonisch(komponente["name"])
    if name in LIZENZ_LAUT_TEXT:
        ausdruck = LIZENZ_LAUT_TEXT[name]
        komponente["licenses"] = [{"acknowledgement": "concluded", "expression": ausdruck}]
        return
    eintraege = komponente.get("licenses", [])
    kennungen = [e["license"]["id"] for e in eintraege if "id" in e.get("license", {})]
    kennungen += [e["expression"] for e in eintraege if "expression" in e]

    def doppelt(eintrag: dict) -> bool:
        familie = CLASSIFIER_FAMILIEN.get(eintrag.get("license", {}).get("name", ""))
        return bool(familie) and any(familie in kennung for kennung in kennungen)

    komponente["licenses"] = [e for e in eintraege if not doppelt(e)]


def direkte_abhaengigkeiten() -> set[str]:
    """Die Paketnamen aus backend/requirements.txt (kanonisch)."""
    zeilen = (REPO / "backend" / "requirements.txt").read_text(encoding="utf-8").splitlines()
    namen = [re.match(r"[A-Za-z0-9._-]+", zeile) for zeile in zeilen]
    return {_kanonisch(treffer.group(0)) for treffer in namen if treffer}


def mitgeliefert(paket: dict, metadaten: dict) -> list[dict]:
    """Was ein Python-Paket in seiner eigenen Stückliste nennt — als Komponenten unterhalb des
    Pakets, je einmal: die Bibliotheken, aus denen sein übersetzter Teil gebaut ist, samt dem,
    was nur zum Bau diente (dort „scope: excluded“). Urheber wie dort genannt, ohne Adressen."""
    gefunden: dict[tuple, dict] = {}
    for stueckliste in metadaten.get("Stuecklisten", []):
        for k in stueckliste["inhalt"].get("components", []):
            if not k.get("version") or _kanonisch(k["name"]) == _kanonisch(paket["name"]):
                continue  # das Paket selbst
            eintrag = {
                "bom-ref": f"{paket['bom-ref']}/{k['name']}@{k['version']}",
                "type": k.get("type", "library"),
                "name": k["name"],
                "version": k["version"],
                "properties": [{"name": "stoerungsinfo:quelle", "value": stueckliste["datei"]}],
            }
            eintrag |= {feld: k[feld] for feld in ("purl", "licenses", "scope") if k.get(feld)}
            namen = _namen(k.get("author"), None)
            namen += [n for a in k.get("authors", []) for n in _namen(a.get("name"), None)]
            if namen:
                eintrag["authors"] = [{"name": name} for name in dict.fromkeys(namen)]
            gefunden.setdefault((k["name"], k["version"]), eintrag)
    return [gefunden[schluessel] for schluessel in sorted(gefunden)]


def app_stueckliste(
    roh: dict, metadaten: list[dict], vorher: dict, commit: str, basis: str
) -> dict:
    """Aus der Ausgabe von cyclonedx-py die Stückliste der Anwendung: mit Autoren je Paket,
    bereinigten Lizenzen, den mitgelieferten Bibliotheken, der Anwendung als Wurzel und deren
    direkten Abhängigkeiten."""
    je_paket = {_kanonisch(m["Name"]): m for m in metadaten if m.get("Name")}
    for komponente in roh["components"]:
        angaben = je_paket.get(_kanonisch(komponente["name"]), {})
        lizenzen_bereinigen(komponente)
        namen = autoren(angaben)
        if namen:
            komponente["authors"] = [{"name": name} for name in namen]
        enthalten = mitgeliefert(komponente, angaben)
        if enthalten:
            komponente["components"] = enthalten
        if _kanonisch(komponente["name"]) == "pip":  # im Image, aber kein Eintrag im Lockfile
            komponente["properties"] = [{"name": "scope", "value": "build-tool"}]

    # Name, Beschreibung und Herausgeber der Anwendung stehen in der bisherigen Datei. Der
    # Commit dahinter ist der Stand, auf dem erzeugt wurde — mit „-dirty“, wenn dabei nicht
    # eingecheckte Änderungen vorlagen (dann beschreibt die Stückliste nicht genau ihn).
    wurzel = dict(vorher["metadata"]["component"])
    alter_commit = wurzel["bom-ref"].split("@", 1)[1]
    wurzel["bom-ref"] = wurzel["bom-ref"].replace(alter_commit, commit)
    wurzel["version"] = wurzel["version"].replace(alter_commit, commit)
    roh["metadata"]["component"] = wurzel
    roh["metadata"]["supplier"] = vorher["metadata"]["supplier"]
    roh["metadata"]["properties"] = [{"name": "runtime:base-image", "value": basis}]

    direkt = direkte_abhaengigkeiten()
    refs = sorted(k["bom-ref"] for k in roh["components"] if _kanonisch(k["name"]) in direkt)
    kanten = [k for k in roh.get("dependencies", []) if k["ref"] != wurzel["bom-ref"]]
    roh["dependencies"] = [*kanten, {"ref": wurzel["bom-ref"], "dependsOn": refs}]
    return roh


def image_stueckliste(sbom: dict, name: str, image_id: str, versionen: dict) -> dict:
    """Die Stückliste eines Images, wie Trivy sie schreibt — mit vier Eingriffen: Sie nennt
    das Image statt der Archivdatei, aus der Trivy es las; Herausgeber und Labels stehen
    ohne E-Mail-Adresse da (Trivy nennt bei Betriebssystem-Paketen den Betreuer samt
    Adresse); der leere Abschnitt für Schwachstellen entfällt — sie stehen im Bericht, nicht
    hier; und was Trivy nicht sieht, weil es aus dem Quelltext gebaut ist (HAUPTKOMPONENTEN
    mit „im_scan“: False), kommt als gekennzeichnete Komponente von Hand dazu.

    Dazu eine Korrektur: Die Pakete von nginx.org nennen ihre Lizenz als Freitext
    („2-clause BSD-like license“), den Trivy in drei Wörter zerlegt — eines davon liest es als
    BSD-3-Clause. Eingetragen wird die Lizenz laut COPYRIGHT im Image (NGINX_ORG_LIZENZ)."""
    wurzel = sbom["metadata"]["component"]
    wurzel |= {"name": f"stoerungsinfo-{name}", "version": image_id}
    for eigenschaft in wurzel.get("properties", []):  # Labels des Image, etwa „maintainer“
        eigenschaft["value"] = _ohne_adresse(eigenschaft.get("value", ""))
    for komponente in sbom.get("components", []):
        if {"2-clause", "license"} <= set(lizenzen(komponente)):
            kennung = NGINX_ORG_LIZENZ.get(komponente["name"], "BSD-2-Clause")
            komponente["licenses"] = [{"license": {"id": kennung}}]
        herausgeber = komponente.get("supplier")
        if herausgeber and "name" in herausgeber:
            herausgeber["name"] = _ohne_adresse(herausgeber["name"])
    for haupt in HAUPTKOMPONENTEN:
        image, schluessel = haupt["version"]
        if image == name and not haupt["im_scan"]:
            version = versionen.get(schluessel, "")
            ref = f"von-hand:{haupt['purl']}@{version}"
            # … und in den Abhängigkeiten: als Bestandteil des Image, selbst ohne Kanten
            kanten = sbom.setdefault("dependencies", [])
            for kante in kanten:
                if kante.get("ref") == wurzel.get("bom-ref"):
                    kante.setdefault("dependsOn", []).append(ref)
            kanten.append({"ref": ref, "dependsOn": []})
            sbom.setdefault("components", []).append(
                {
                    "bom-ref": ref,
                    "type": "application",
                    "name": haupt["name"],
                    "version": version,
                    "purl": f"pkg:generic/{haupt['purl']}@{version}",
                    "licenses": [{"license": {"id": haupt["lizenz"]}}],
                    "supplier": {"name": haupt["urheber"]},
                    "properties": [
                        {
                            "name": "stoerungsinfo:quelle",
                            "value": "von Hand (ops/governance.py) — aus dem Quelltext gebaut",
                        }
                    ],
                }
            )
    if sbom.get("vulnerabilities"):
        raise SystemExit("FEHLER: Die Stückliste enthält Schwachstellen — Aufruf von Trivy prüfen.")
    sbom.pop("vulnerabilities", None)
    return sbom


# ---------- Schwachstellen ----------


def funde_aus_trivy(image: str, bericht: dict, ort: str | None = None) -> list[dict]:
    """Die Funde eines Trivy-Berichts in der Form, die schwachstellen.json führt.

    „quellpaket“ fasst zusammen, was aus demselben Quelltext gebaut ist (die Distributionen
    melden eine Lücke je Binärpaket); „ort“ nennt die Datei oder das Paket, worin eine
    Bibliothek steckt. Mit festem „ort“ (Bericht über eine mitgelieferte Stückliste) zählen
    nur die Bibliotheken darin, nicht das Python-Paket selbst."""
    funde = []
    for ergebnis in bericht.get("Results", []):
        if ort is not None and ergebnis.get("Type") == "python-pkg":
            continue
        quelle = {p["ID"]: p.get("SrcName") for p in ergebnis.get("Packages") or [] if "ID" in p}
        im_programm = ergebnis.get("Type") in ("gobinary", "jar")
        for fund in ergebnis.get("Vulnerabilities") or []:
            funde.append(
                {
                    "image": image,
                    "id": fund["VulnerabilityID"],
                    "schweregrad": fund.get("Severity", "UNKNOWN"),
                    "paket": fund["PkgName"],
                    "quellpaket": quelle.get(fund.get("PkgID")) or fund["PkgName"],
                    "art": ergebnis.get("Type", ""),
                    "ort": ort
                    or fund.get("PkgPath")
                    or (ergebnis.get("Target", "") if im_programm else ""),
                    "installiert": fund.get("InstalledVersion", ""),
                    "korrigiert_in": fund.get("FixedVersion", ""),
                    "status_der_quelle": fund.get("Status", ""),
                    "titel": fund.get("Title", ""),
                    "url": fund.get("PrimaryURL", ""),
                }
            )
    return funde


def sortiert(funde: list[dict]) -> list[dict]:
    def rang(fund: dict) -> tuple:
        return (
            list(IMAGES).index(fund["image"]),
            SCHWEREGRADE.index(fund["schweregrad"]),
            fund["quellpaket"],
            fund["ort"],
            fund["id"],
            fund["paket"],
        )

    return sorted(funde, key=rang)


def lade_bewertung() -> dict:
    if not BEWERTUNG.exists():
        return {"bewertung": [], "ohne_scan": [], "massnahme": []}
    daten = tomllib.loads(BEWERTUNG.read_text(encoding="utf-8"))
    fehler = pruefe_datei(daten)
    if fehler:
        raise SystemExit(f"FEHLER in {BEWERTUNG.name}: {fehler}")
    return daten


def pruefe_datei(daten: dict) -> str | None:
    """Was an der Datei der Bewertungen nicht stimmt — None, wenn nichts. Füllt fehlende
    Abschnitte mit leeren Listen."""
    for abschnitt in ("bewertung", "ohne_scan", "massnahme"):
        daten.setdefault(abschnitt, [])
    vergeben: set[tuple] = set()
    for eintrag in daten["bewertung"]:
        fehler = pruefe_bewertung(eintrag)
        if fehler:
            return f"{fehler} — Eintrag: {eintrag}"
        for kennung in eintrag.get("cves", [None]):
            schluessel = (eintrag["image"], eintrag["paket"], eintrag.get("ort", ""), kennung)
            if schluessel in vergeben:
                return f"zwei Einträge für dieselbe Lücke: {schluessel}"
            vergeben.add(schluessel)
    pflicht = {"ohne_scan": ("komponente", "version", "aussage", "stand"),
               "massnahme": ("titel", "wirkung", "aufwand")}  # fmt: skip
    for abschnitt, felder in pflicht.items():
        for eintrag in daten[abschnitt]:
            fehlt = [f for f in felder if not isinstance(eintrag.get(f), str) or not eintrag[f]]
            if fehlt:
                return (
                    f"[[{abschnitt}]]: „{fehlt[0]}“ fehlt oder ist kein Text — Eintrag: {eintrag}"
                )
    return None


def pruefe_bewertung(eintrag: dict) -> str | None:
    """Was an einem Eintrag der Bewertung fehlt oder nicht stimmt — None, wenn nichts."""
    for feld in ("image", "paket", "status", "begruendung", "stand"):
        if not eintrag.get(feld):
            return f"Feld „{feld}“ fehlt"
    # Ein vertipptes „cve“ machte aus dem Eintrag ein Urteil über ALLE Lücken des Pakets.
    unbekannt = sorted(set(eintrag) - FELDER_DER_BEWERTUNG)
    if unbekannt:
        erlaubt = ", ".join(sorted(FELDER_DER_BEWERTUNG))
        return f"unbekanntes Feld „{unbekannt[0]}“ (erlaubt: {erlaubt})"
    cves = eintrag.get("cves")
    if "cves" in eintrag and not (
        isinstance(cves, list) and cves and all(isinstance(kennung, str) for kennung in cves)
    ):
        return "„cves“ ist eine Liste von Kennungen"
    if eintrag["image"] not in IMAGES:
        return f"unbekanntes Image „{eintrag['image']}“"
    if eintrag["status"] not in STATUS:
        return f"unbekannter Status „{eintrag['status']}“ (erlaubt: {', '.join(STATUS)})"
    if eintrag["status"] == "not_affected":
        if eintrag.get("warum") not in BEGRUENDUNGEN:
            return f"„not_affected“ braucht „warum“ aus: {', '.join(BEGRUENDUNGEN)}"
    elif eintrag.get("warum"):
        return "„warum“ steht nur bei „not_affected“"
    if eintrag["status"] == "affected" and not eintrag.get("massnahme"):
        return "„affected“ braucht eine „massnahme“"
    return None


def bewertung_fuer(fund: dict, bewertungen: list[dict]) -> dict | None:
    """Der Eintrag, der für einen Fund gilt: einer, der dessen Kennung nennt, vor einem, der
    das ganze (Quell-)Paket im Image meint. Ein Eintrag ohne „ort“ gilt nur für Funde ohne
    Ort — nicht auch für eine gleichnamige Bibliothek, die in einem anderen Paket steckt."""
    passend = [
        b
        for b in bewertungen
        if b["image"] == fund["image"]
        and b["paket"] == fund["quellpaket"]
        and b.get("ort", "") == fund["ort"]
        and ("cves" not in b or fund["id"] in b["cves"])
    ]
    passend.sort(key=lambda b: "cves" not in b)
    return passend[0] if passend else None


def je_luecke(funde: list[dict]) -> list[dict]:
    """Eine Zeile je Lücke und Quellpaket: Der Scanner meldet dieselbe Lücke für jedes
    Binärpaket aus demselben Quelltext einzeln. „pakete“ nennt, welche es waren, „versionen“
    ihre installierten Versionen (Binärpakete tragen teils eine eigene)."""
    zeilen: dict[tuple, dict] = {}
    for fund in funde:
        schluessel = (fund["image"], fund["quellpaket"], fund["ort"], fund["id"])
        zeile = zeilen.setdefault(schluessel, {**fund, "pakete": [], "versionen": []})
        if fund["paket"] not in zeile["pakete"]:
            zeile["pakete"].append(fund["paket"])
        if fund["installiert"] not in zeile["versionen"]:
            zeile["versionen"].append(fund["installiert"])
    return list(zeilen.values())


def version_im_bestand(quelle: str, stand: dict, app: dict, images: dict[str, dict]) -> str | None:
    """Wo eine Angabe von Hand ihre Version prüft: „api:PYTHON_VERSION“ ist eine
    Versionsangabe des Image, „paket:cryptography:openssl“ eine Bibliothek, die ein
    Python-Paket mitbringt, „sbom:nginx:libssl3“ ein Paket aus der Stückliste eines Image."""
    teile = quelle.split(":")
    if teile[0] == "sbom":
        komponenten = images.get(teile[1], {}).get("components", [])
        return next((k.get("version") for k in komponenten if k["name"] == teile[2]), None)
    if teile[0] != "paket":
        return stand["images"].get(teile[0], {}).get("versionen", {}).get(teile[1])
    for komponente in app["components"]:
        if _kanonisch(komponente["name"]) == _kanonisch(teile[1]):
            enthalten = {k["name"]: k["version"] for k in komponente.get("components", [])}
            return enthalten.get(teile[2]) if len(teile) > 2 else komponente["version"]
    return None


# ---------- Markdown ----------


def _zelle(text: object) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ").strip() or "–"


def tabelle(kopf: list[str], zeilen: list[list[object]]) -> str:
    kopfzeile = "| " + " | ".join(kopf) + " |"
    trenner = "|" + "---|" * len(kopf)
    return "\n".join(
        [kopfzeile, trenner, *("| " + " | ".join(map(_zelle, z)) + " |" for z in zeilen)]
    )


def _datum(zeitpunkt: str) -> str:
    return zeitpunkt[:10]


def _code_stand(stand: dict) -> str:
    zusatz = "" if stand["code"]["unveraendert"] else " mit nicht eingecheckten Änderungen"
    return f"`{stand['code']['commit']}`{zusatz}"


def _art(komponente: dict) -> str:
    eigenschaften = {e["name"]: e["value"] for e in komponente.get("properties", [])}
    return eigenschaften.get("aquasecurity:trivy:PkgType", "")


def _art_name(art: str) -> str:
    """Trivy kennt mehr Paketarten, als hier einen deutschen Namen haben."""
    return ARTEN.get(art, art)


def _art_rang(art: str) -> int:
    return list(ARTEN).index(art) if art in ARTEN else len(ARTEN)


def komponenten_md(stand: dict, app: dict, image_sboms: dict[str, dict]) -> str:
    eingebaut = stand["images"]["api"]["versionen"]
    teile = [
        "# Software-Komponenten",
        "",
        "<!-- Erzeugt von ops/governance.py — nicht von Hand ändern (RUNBOOK 5b). -->",
        "",
        f"Stand: {_datum(stand['erzeugt'])}, Code {_code_stand(stand)}. Lesbare Fassung der "
        "Stücklisten in diesem Ordner (`*.cdx.json`, CycloneDX); maßgeblich sind die Dateien.",
        "Urheber und Lizenzen stehen in den Abschnitten 2 und 3 so, wie die Komponenten sie "
        "selbst angeben — nachgeprüft sind sie dort nicht, und nicht jede Komponente nennt "
        "beides. Drei Ausnahmen folgen dem Lizenztext statt der Angabe: Jinja2 und uvloop "
        "(mehrdeutige Angabe) und die Pakete von nginx.org (Freitext). Abschnitt 1 ist von "
        "Hand gepflegt, nach den Lizenztexten der Projekte. Genannt werden Namen, keine "
        "E-Mail-Adressen.",
        "",
        "## 1. Hauptkomponenten",
        "",
    ]
    zeilen = []
    for k in HAUPTKOMPONENTEN:
        image, schluessel = k["version"]
        version = stand["images"][image]["versionen"].get(schluessel, "?")
        zeilen.append([k["name"], version, k["rolle"], k["urheber"], f"`{k['lizenz']}`", image])
    teile.append(
        tabelle(["Komponente", "Version", "Aufgabe", "Urheber", "Lizenz", "Image"], zeilen)
    )
    teile += [
        "",
        "Python und PostgreSQL sind in ihren Images aus dem Quelltext gebaut. Sie stehen in "
        "keinem Paketverzeichnis, der Scanner sieht sie nicht; die Stückliste des Image führt "
        "sie deshalb als von Hand ergänzte Komponente. Python trägt außerdem fest eingebaut "
        f"libexpat {eingebaut.get('EXPAT_VERSION', '?')} (Lizenz `MIT`), mpdecimal "
        f"{eingebaut.get('MPDEC_VERSION', '?')} (`BSD-2-Clause`), HACL* und macholib in sich; "
        "sie stehen in keiner Stückliste hier (welche es sind, sagt die Stückliste, die "
        "python.org zum Quelltext veröffentlicht; Versionen aus dem Image gelesen, Lizenzen "
        "aus den Lizenztexten im Quelltext von Python).",
        "",
        "Unverändert bezogene Images, per Digest gepinnt, **nicht** in den Stücklisten:",
        "",
        tabelle(
            ["Image", "Version", "Aufgabe", "Urheber", "Lizenz"],
            [
                [f["name"], f["version"], f["rolle"], f["urheber"], f"`{f['lizenz']}`"]
                for f in stand["fremd_images"]
            ],
        ),
        "",
        f"## 2. Python-Pakete der Anwendung ({len(app['components'])})",
        "",
        "Quelle: `stoerungsinfo-app.cdx.json` — alles, was im Image der Anwendung installiert "
        "ist. Autoren: die Angabe des Pakets; nennt es keine, seine Betreuer.",
        "",
        tabelle(
            ["Paket", "Version", "Lizenz", "Autoren"],
            [
                [
                    k["name"],
                    k["version"],
                    ", ".join(f"`{lizenz}`" for lizenz in lizenzen(k)),
                    ", ".join(a["name"] for a in k.get("authors", [])),
                ]
                for k in sorted(app["components"], key=lambda k: k["name"].lower())
            ],
        ),
        "",
        "`pip` ist das Installationswerkzeug aus dem Basis-Image, kein Teil der Anwendung "
        "(in der Stückliste als `build-tool` gekennzeichnet).",
        "",
        "### Was Python-Pakete in ihrer eigenen Stückliste nennen",
        "",
        "Einige Pakete bringen eine eigene Stückliste mit: die Bibliotheken, aus denen ihr "
        "übersetzter Teil gebaut ist. Sie nennt auch, was nur zum Bau diente („nur zum Bau“; "
        "dort `scope: excluded`). Vollständig ist das nicht: Was ein Paket nicht selbst "
        "angibt, steht hier nicht (etwa libpq und OpenSSL in `psycopg-binary`, libuv in "
        "`uvloop`).",
        "",
        tabelle(
            ["Paket", "Nennt", "Version", "Art", "Lizenz", "Urheber"],
            [
                [
                    k["name"],
                    unter["name"],
                    unter["version"],
                    ARTEN_NACH_PURL.get(unter.get("purl", "").split("/")[0], "–")
                    + (", nur zum Bau" if unter.get("scope") == "excluded" else ""),
                    ", ".join(f"`{lizenz}`" for lizenz in lizenzen(unter)),
                    ", ".join(a["name"] for a in unter.get("authors", [])),
                ]
                for k in sorted(app["components"], key=lambda k: k["name"].lower())
                for unter in k.get("components", [])
            ],
        ),
        "",
        "## 3. Inhalt der Images",
        "",
        "Quelle: `stoerungsinfo-image-<name>.cdx.json`, von Trivy aus dem gebauten Image gelesen. "
        "Herausgeber ist bei Betriebssystem-Paketen der Betreuer des Pakets in der Distribution; "
        "Java-Bibliotheken und Go-Module nennen keinen. Liegt dieselbe Bibliothek an mehreren "
        "Stellen im Image, steht sie hier einmal.",
    ]
    for image, sbom in image_sboms.items():
        pakete = [k for k in sbom.get("components", []) if _art(k)]
        if image == "api":  # die Python-Pakete stehen in Abschnitt 2
            pakete = [k for k in pakete if _art(k) != "python-pkg"]
        pakete.sort(key=lambda k: (_art_rang(_art(k)), k["name"].lower(), k.get("version", "")))
        reihen = list(
            dict.fromkeys(
                (
                    f"{k['group']}:{k['name']}" if k.get("group") else k["name"],
                    k.get("version", ""),
                    _art_name(_art(k)),
                    ", ".join(f"`{lizenz}`" for lizenz in lizenzen(k)),
                    (k.get("supplier") or {}).get("name", ""),
                )
                for k in pakete
            )
        )
        je_art: dict[str, int] = {}
        for reihe in reihen:
            je_art[reihe[2]] = je_art.get(reihe[2], 0) + 1
        zahl = ", ".join(f"{anzahl} × {art}" for art, anzahl in je_art.items())
        info = stand["images"][image]
        teile += [
            "",
            f"### {image} — {IMAGES[image]['inhalt']}",
            "",
            f"Basis `{info['basis'].split('@')[0]}`, {info['os']}. {zahl}."
            + (" Dazu die Python-Pakete aus Abschnitt 2." if image == "api" else ""),
            "",
            tabelle(
                ["Komponente", "Version", "Art", "Lizenz", "Herausgeber"], [[*r] for r in reihen]
            ),
        ]
    return "\n".join(teile) + "\n"


def schwachstellen_md(scan: dict, bewertung: dict, app: dict, images: dict[str, dict]) -> str:
    stand, funde = scan["stand"], scan["funde"]
    bewertungen = bewertung["bewertung"]
    # Einzeln bewertet: was hoch oder noch gar nicht eingestuft ist — und jeder Fund darunter,
    # für den es eigens einen Eintrag gibt.
    luecken = je_luecke(
        [f for f in funde if f["schweregrad"] in BEWERTET or bewertung_fuer(f, bewertungen)]
    )
    urteile = [bewertung_fuer(luecke, bewertungen) for luecke in luecken]
    gedeckt: dict[int, set[str]] = {}
    for luecke, urteil in zip(luecken, urteile, strict=True):
        if urteil is not None:
            gedeckt.setdefault(id(urteil), set()).add(luecke["id"])
    plattformen = sorted({i.get("plattform", "") for i in stand["images"].values()} - {""})
    plattform = f" ({', '.join(plattformen)})" if plattformen else ""
    offen = sum(bool(eintrag.get("offen")) for eintrag in bewertung["ohne_scan"])

    teile = [
        "# Ergebnis der Schwachstellenanalyse",
        "",
        "<!-- Erzeugt von ops/governance.py — nicht von Hand ändern. Die Bewertungen stehen in",
        "     schwachstellen-bewertung.toml; danach: python ops/governance.py bericht -->",
        "",
        f"**Scan vom {_datum(stand['erzeugt'])}** mit {stand['werkzeug']['name']} "
        f"{stand['werkzeug']['version']}, Schwachstellen-Datenbank vom "
        f"{_datum(stand['datenbank']['schwachstellen'])} "
        f"(Java: {_datum(stand['datenbank']['java'])}), Code {_code_stand(stand)}.",
        "",
        "Ein Scan gilt für den Tag, an dem er lief: Neue Meldungen kommen täglich hinzu. "
        "Die Bewertungen sind die Einschätzung des Entwicklungsteams, keine Freigabe der "
        "Informationssicherheit (offene Frage B10).",
        "",
        "## 1. Umfang",
        "",
        tabelle(
            [
                "Image",
                "Inhalt",
                "Basis-Image",
                "Stand des Basis-Image",
                "Betriebssystem",
                "Image-ID",
            ],
            [
                [
                    name,
                    IMAGES[name]["inhalt"],
                    f"`{i['basis'].split('@')[0]}`",
                    BASIS_STAND[i.get("basis_aktuell")],
                    i["os"],
                    f"`{i['id'][7:19]}`",
                ]
                for name, i in stand["images"].items()
            ],
        ),
        "",
        "Die Basis-Images sind per Digest gepinnt; „Stand“ sagt, ob die Registry am Tag des "
        "Scans unter demselben Tag schon ein neueres Image führte.",
        "",
        f"Untersucht sind die Images der Tabelle{plattform}: Betriebssystem-Pakete, "
        "Python-Pakete, Java-Bibliotheken und Go-Programme darin, dazu die Bibliotheken, die "
        "Python-Pakete in ihrer eigenen Stückliste nennen. **Nicht** untersucht: das "
        "NGINX-Image des Pilotbetriebs (`deploy/nginx/Dockerfile.public` — dasselbe Basis-Image, "
        "andere Konfiguration), die unverändert bezogenen Images (Mailpit und die "
        "Test-Datenbank in DEV, Certbot im Pilot, PostgreSQL 16 als einmaliger Helfer in "
        "`deploy/vm/pg-umzug.sh`), die Testwerkzeuge (sie erreichen kein Image) und der eigene "
        "Code der Anwendung. Was der Scan grundsätzlich nicht sieht, steht in Abschnitt 4.",
        "",
        "## 2. Ergebnis in Zahlen",
        "",
    ]
    zeilen = []
    for image in stand["images"]:
        eigene = [f for f in funde if f["image"] == image]
        je_grad = [sum(f["schweregrad"] == grad for f in eigene) for grad in SCHWEREGRADE]
        verschieden = [luecke for luecke in luecken if luecke["image"] == image]
        mit_korrektur = sum(bool(luecke["korrigiert_in"]) for luecke in verschieden)
        zeilen.append([image, *je_grad, len(verschieden), mit_korrektur])
    teile += [
        tabelle(
            [
                "Image",
                *SCHWEREGRADE,
                "Einzeln bewertet: verschiedene Lücken",
                "davon mit Korrektur",
            ],
            zeilen,
        ),
        "",
        "Die Spalten der Schweregrade zählen wie der Scanner: jede Lücke je betroffenem Paket. "
        "Pakete aus demselben Quelltext melden dieselbe Lücke mehrfach; „verschiedene Lücken“ "
        "zählt sie einmal. Alle Funde einzeln, auch MEDIUM und LOW: `schwachstellen.json`. "
        "Einzeln bewertet sind CRITICAL und HIGH, dazu UNKNOWN (Meldungen, die noch niemand "
        "eingestuft hat) und was darunter eigens einen Eintrag hat.",
        "",
        "## 3. Bewertung je Lücke",
        "",
    ]
    je_status = {
        status: sum(
            (urteil or {}).get("status", "under_investigation") == status for urteil in urteile
        )
        for status in STATUS
    }
    in_pruefung = {0: "", 1: "; dort ist ein Punkt in Prüfung"}.get(
        offen, f"; dort sind {offen} Punkte in Prüfung"
    )
    teile += [
        tabelle(
            ["Bewertung", "Lücken"],
            [[f"{STATUS[s]} (`{s}`)", anzahl] for s, anzahl in je_status.items()],
        ),
        "",
        "Statuswörter wie bei VEX (CISA). Eine Lücke ohne Eintrag in der Bewertung gilt als "
        "„in Prüfung“. Die Tabelle zählt, was der Scanner gemeldet hat — was er nicht meldet, "
        f"steht in Abschnitt 4{in_pruefung}. „Laut Quelle“ gibt den Stand der "
        "Scanner-Datenbank vom Tag des Scans wieder.",
    ]
    if bewertung.get("methode"):
        teile += ["", bewertung["methode"]]
    for image in stand["images"]:
        eigene = [(lu, u) for lu, u in zip(luecken, urteile, strict=True) if lu["image"] == image]
        teile += ["", f"### {image}", ""]
        if not eigene:
            teile.append("Keine Funde CRITICAL, HIGH oder UNKNOWN.")
            continue
        gruppen: dict[tuple, list] = {}
        for luecke, urteil in eigene:
            gruppen.setdefault((luecke["quellpaket"], luecke["ort"], id(urteil)), []).append(
                (luecke, urteil)
            )
        for (quellpaket, ort, _), gruppe in gruppen.items():
            erste, urteil = gruppe[0]
            pakete = sorted({paket for luecke, _ in gruppe for paket in luecke["pakete"]})
            versionen = sorted({v for luecke, _ in gruppe for v in luecke["versionen"]})
            wo = f", in `{ort}`" if ort else ""
            als = f"; installiert als: {', '.join(pakete)}" if pakete != [quellpaket] else ""
            teile += [
                f"**{quellpaket} {' / '.join(versionen)}** ({_art_name(erste['art'])}{wo}{als})",
                "",
                tabelle(
                    ["Kennung", "Schweregrad", "Korrigiert in", "Laut Quelle", "Kurzbeschreibung"],
                    [
                        [
                            f"[{lu['id']}]({lu['url']})" if lu["url"] else lu["id"],
                            lu["schweregrad"],
                            lu["korrigiert_in"],
                            STATUS_DER_QUELLE.get(lu["status_der_quelle"], lu["status_der_quelle"]),
                            lu["titel"] if len(lu["titel"]) <= 100 else lu["titel"][:97] + "…",
                        ]
                        for lu, _ in gruppe
                    ],
                ),
                "",
            ]
            if urteil is None:
                teile.append("Bewertung: **in Prüfung** — noch nicht bewertet.")
                continue
            nicht_betroffen = urteil["status"] == "not_affected"
            warum = f" ({BEGRUENDUNGEN[urteil['warum']]})" if nicht_betroffen else ""
            massnahme = f" Maßnahme: {urteil['massnahme']}" if urteil.get("massnahme") else ""
            teile.append(
                f"Bewertung: **{STATUS[urteil['status']]}**{warum} — {urteil['begruendung']}"
                f"{massnahme} (Stand {urteil['stand']})"
            )
            teile.append("")
        while teile[-1] == "":
            teile.pop()
    teile += [
        "",
        "## 4. Was der Scan nicht sieht",
        "",
        "Der Scanner kennt, was in einem Paketverzeichnis des Images oder in einer "
        "mitgelieferten Stückliste steht, und meldet, was seine Datenbank dazu führt. Zu "
        "Programmen, die im Image aus dem Quelltext gebaut sind, zu fest eingebauten "
        "Bibliotheken ohne eigene Angabe und zu Korrekturen, die eine Distribution noch nicht "
        "als Sicherheitsmeldung führt, meldet er nichts — auch dann nicht, wenn es Meldungen "
        "gibt. Dafür gilt die Angabe von Hand; vollständig ist auch sie nicht.",
        "",
    ]
    zeilen = []
    for eintrag in bewertung["ohne_scan"]:
        version = eintrag["version"]
        aussage = ("**In Prüfung.** " if eintrag.get("offen") else "") + eintrag["aussage"]
        if "version_aus" in eintrag:
            im_bestand = version_im_bestand(eintrag["version_aus"], stand, app, images)
            if im_bestand != version:
                aussage = (
                    f"**Veraltet:** Die Angabe gilt für {version}, im Bestand ist "
                    f"{im_bestand or 'nichts dergleichen'}. Neu prüfen."
                )
                version = im_bestand or "–"
        zeilen.append([eintrag["komponente"], version, aussage, eintrag["stand"]])
    teile.append(
        tabelle(["Komponente", "Version", "Angabe", "Stand"], zeilen)
        if zeilen
        else "Keine Angaben hinterlegt."
    )
    nummer = 5
    if bewertung["massnahme"]:
        teile += [
            "",
            f"## {nummer}. Mögliche Maßnahmen",
            "",
            "Was die Funde an der Quelle beseitigt oder ihre Voraussetzungen nimmt. Umgesetzt ist "
            "davon nichts, was nicht ausdrücklich so dasteht — die Entscheidung liegt beim "
            "Betrieb und der Informationssicherheit (offene Frage B10). Wo nichts anderes steht, "
            "ist die Wirkung erwartet, nicht nachgemessen.",
            "",
            tabelle(
                ["Maßnahme", "Wirkung", "Aufwand und Kehrseite"],
                [[m["titel"], m["wirkung"], m["aufwand"]] for m in bewertung["massnahme"]],
            ),
        ]
        nummer += 1
    # Was die Bewertung nennt, der Scan aber nicht mehr meldet: ganze Einträge oder einzelne
    # Kennungen daraus.
    ohne_fund = []
    for b in bewertungen:
        if "cves" in b:
            fehlend = [kennung for kennung in b["cves"] if kennung not in gedeckt.get(id(b), set())]
            if fehlend:
                ohne_fund.append(f"- {b['image']}: {b['paket']} ({', '.join(fehlend)})")
        elif id(b) not in gedeckt:
            ohne_fund.append(f"- {b['image']}: {b['paket']}")
    if ohne_fund:
        teile += [
            "",
            f"## {nummer}. Bewertungen ohne Fund",
            "",
            "Diese Einträge oder Kennungen der Bewertung treffen auf keinen Fund dieses Scans "
            "mehr zu (behoben oder das Paket ist entfallen) und können aus der Datei entfernt "
            "werden:",
            "",
            *ohne_fund,
        ]
    return "\n".join(teile) + "\n"


# ---------- Docker ----------


def docker(*argumente: str, eingabe: bytes | None = None) -> bytes:
    lauf = subprocess.run(["docker", *argumente], input=eingabe, capture_output=True, check=False)
    if lauf.returncode != 0:
        fehler = lauf.stderr.decode("utf-8", "replace")[-1500:]
        raise SystemExit(f"FEHLER: docker {' '.join(argumente[:4])} …\n{fehler}")
    return lauf.stdout


def image_name(name: str) -> str:
    """Untersucht wird, was „make governance“ gerade gebaut hat — immer unter dem Tag local,
    gleich was IMAGE_TAG in der .env sagt (das Make-Target baut mit IMAGE_TAG=local)."""
    return f"stoerungsinfo-{name}:{IMAGES[name]['tag'] or 'local'}"


def basis_image(name: str) -> str:
    """Die letzte FROM-Zeile des Dockerfiles: Darauf baut das ausgelieferte Image."""
    text = (REPO / IMAGES[name]["dockerfile"]).read_text(encoding="utf-8")
    return re.findall(r"^FROM\s+(\S+)", text, re.M)[-1]


def basis_ist_aktuell(basis: str) -> bool | None:
    """Ob der gepinnte Digest noch der ist, den die Registry heute unter dem Tag führt —
    None, wenn sich das nicht feststellen lässt (kein Netz, kein buildx)."""
    tag, _, digest = basis.partition("@")
    lauf = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", tag],
        capture_output=True,
        text=True,
        check=False,
    )
    heute = re.search(r"^Digest:\s+(\S+)", lauf.stdout, re.M)
    return heute.group(1) == digest if lauf.returncode == 0 and heute and digest else None


def scanne(image: str) -> tuple[dict, dict]:
    """Trivy liest das Image als Archiv (docker save) — ohne Docker-Socket und ohne Netz.
    Zurück kommen der Bericht über Schwachstellen und die Stückliste (CycloneDX)."""
    befehl = (
        "cat > /tmp/image.tar && "
        f"trivy image --input /tmp/image.tar {TRIVY_SCHALTER} --scanners vuln "
        "--format json --output /tmp/funde.json >&2 && "
        f"trivy image --input /tmp/image.tar {TRIVY_SCHALTER} "
        "--format cyclonedx --output /tmp/sbom.json >&2 && "
        "tar -c -C /tmp funde.json sbom.json"
    )
    sichern = subprocess.Popen(["docker", "save", image], stdout=subprocess.PIPE)
    lauf = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "-v",
            f"{TRIVY_CACHE}:/cache",
            "--entrypoint",
            "sh",
            TRIVY,
            "-c",
            befehl,
        ],
        stdin=sichern.stdout,
        capture_output=True,
        check=False,
    )
    assert sichern.stdout is not None
    sichern.stdout.close()
    if sichern.wait() != 0 or lauf.returncode != 0:
        fehler = lauf.stderr.decode("utf-8", "replace")[-1500:]
        raise SystemExit(f"FEHLER: Scan von {image} gescheitert\n{fehler}")
    with tarfile.open(fileobj=io.BytesIO(lauf.stdout)) as archiv:
        funde = json.load(archiv.extractfile("funde.json"))  # type: ignore[arg-type]
        sbom = json.load(archiv.extractfile("sbom.json"))  # type: ignore[arg-type]
    return funde, sbom


def scanne_stueckliste(stueckliste: dict) -> dict:
    """Trivy-Bericht über eine Stückliste (CycloneDX), die ein Python-Paket selbst mitbringt."""
    befehl = (
        "cat > /tmp/s.cdx.json && "
        f"trivy sbom {TRIVY_SCHALTER} --scanners vuln --format json /tmp/s.cdx.json"
    )
    ausgabe = docker(
        "run", "--rm", "-i", "--network", "none", "-v", f"{TRIVY_CACHE}:/cache",
        "--entrypoint", "sh", TRIVY, "-c", befehl,
        eingabe=json.dumps(stueckliste).encode(),
    )  # fmt: skip
    return json.loads(ausgabe)


def datenbank_laden() -> dict:
    """Lädt die Schwachstellen-Datenbanken in das Cache-Volume (dafür braucht Trivy Netz)
    und meldet ihren Stand."""
    for schalter in ("--download-db-only", "--download-java-db-only"):
        docker(
            "run", "--rm", "-v", f"{TRIVY_CACHE}:/cache", TRIVY, "image", "--cache-dir", "/cache",
            schalter, "--no-progress", "--skip-version-check", "--disable-telemetry",
        )  # fmt: skip
    ausgabe = docker(
        "run", "--rm", "--network", "none", "-v", f"{TRIVY_CACHE}:/cache", TRIVY,
        "version", "--cache-dir", "/cache", "--format", "json",
    )  # fmt: skip
    return json.loads(ausgabe)


def app_rohdaten(image: str) -> tuple[dict, list[dict]]:
    """Stückliste (cyclonedx-py) und Urheberangaben der Python-Umgebung im Image der
    Anwendung. Das Werkzeug kommt in eine eigene Umgebung, damit es nicht mitgezählt wird."""
    befehl = (
        "python -m venv /tmp/werkzeug >&2 && /tmp/werkzeug/bin/pip install -q "
        f"--disable-pip-version-check cyclonedx-bom=={CYCLONEDX_BOM} >&2 && "
        '/tmp/werkzeug/bin/cyclonedx-py environment --sv 1.6 --of JSON "$(command -v python)"'
    )
    roh = json.loads(docker("run", "--rm", "--entrypoint", "sh", image, "-c", befehl))
    metadaten = json.loads(
        docker(
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--entrypoint",
            "python",
            image,
            "-",
            eingabe=METADATEN_SKRIPT.encode(),
        )
    )
    return roh, metadaten


def git_stand() -> dict:
    def git(*argumente: str) -> str:
        return subprocess.run(
            ["git", *argumente], cwd=REPO, capture_output=True, text=True, check=True
        ).stdout.strip()

    try:
        # Die erzeugten Unterlagen selbst zählen nicht als Änderung am Code.
        geaendert = [
            z for z in git("status", "--porcelain").splitlines() if "docs/governance/" not in z
        ]
        return {"commit": git("rev-parse", "--short", "HEAD"), "unveraendert": not geaendert}
    except (OSError, subprocess.CalledProcessError) as fehler:
        raise SystemExit(
            "FEHLER: Die Unterlagen nennen den Commit, auf dem sie entstehen — dafür braucht es "
            f"git und einen Checkout ({fehler})."
        ) from fehler


def schreibe_json(pfad: pathlib.Path, daten: dict) -> None:
    pfad.write_text(
        json.dumps(daten, indent=2, ensure_ascii=True) + "\n", encoding="utf-8", newline="\n"
    )


def erzeuge() -> None:
    fehlend = [
        image_name(n)
        for n in IMAGES
        if subprocess.run(
            ["docker", "image", "inspect", image_name(n)], capture_output=True, check=False
        ).returncode
        != 0
    ]
    if fehlend:
        raise SystemExit(
            f"FEHLER: Images fehlen: {', '.join(fehlend)} — erst bauen (make governance)."
        )

    # Beides vor dem langen Teil prüfen, nicht nach dem Laden der Datenbank.
    code = git_stand()
    if not APP_SBOM.exists():
        raise SystemExit(
            f"FEHLER: {APP_SBOM.name} fehlt — aus ihr kommen Name, Version und Herausgeber der "
            "Anwendung (metadata.component, metadata.supplier)."
        )

    print("Schwachstellen-Datenbank laden …", flush=True)
    werkzeug = datenbank_laden()
    stand: dict = {
        "erzeugt": datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "code": code,
        "werkzeug": {"name": "Trivy", "version": werkzeug["Version"], "image": TRIVY},
        "datenbank": {
            "schwachstellen": werkzeug["VulnerabilityDB"]["UpdatedAt"],
            "java": werkzeug["JavaDB"]["UpdatedAt"],
        },
        "images": {},
        "fremd_images": [],
    }
    for fremd in FREMD_IMAGES:
        text = (REPO / fremd["datei"]).read_text(encoding="utf-8")
        version = re.search(fremd["muster"], text)
        stand["fremd_images"].append(
            {k: fremd[k] for k in ("name", "urheber", "lizenz", "rolle")}
            | {"version": version.group(1) if version else "?"}
        )

    funde: list[dict] = []
    for name in IMAGES:
        image = image_name(name)
        print(f"{image} untersuchen …", flush=True)
        bericht, sbom = scanne(image)
        beschreibung = json.loads(docker("image", "inspect", image, "--format", "{{json .}}"))
        umgebung = dict(e.split("=", 1) for e in beschreibung["Config"]["Env"] or [])
        basis = basis_image(name)
        versionen = {k: v for k, v in umgebung.items() if k.endswith("_VERSION")}
        versionen["BASIS"] = basis.split("@")[0].rsplit(":", 1)[-1]
        betriebssystem = bericht.get("Metadata", {}).get("OS", {})
        stand["images"][name] = {
            "image": image,
            "id": beschreibung["Id"],
            "basis": basis,
            "basis_aktuell": basis_ist_aktuell(basis),
            "plattform": f"{beschreibung.get('Os', '?')}/{beschreibung.get('Architecture', '?')}",
            "os": f"{betriebssystem.get('Family', '?')} {betriebssystem.get('Name', '')}".strip(),
            "versionen": versionen,
        }
        funde += funde_aus_trivy(name, bericht)
        schreibe_json(
            ZIEL / f"stoerungsinfo-image-{name}.cdx.json",
            image_stueckliste(sbom, name, beschreibung["Id"], versionen),
        )

    print("Stückliste der Anwendung …", flush=True)
    roh, metadaten = app_rohdaten(image_name("api"))
    stand["images"]["api"]["versionen"] |= metadaten[0]["Eingebaut"]
    installiert = {_kanonisch(k["name"]): k["version"] for k in roh["components"]}
    traeger: dict[tuple, str] = {}
    for angaben in metadaten:
        ort = f"{angaben['Name']} (mitgeliefert)"
        for stueckliste in angaben["Stuecklisten"]:
            funde += funde_aus_trivy("api", scanne_stueckliste(stueckliste["inhalt"]), ort=ort)
            for k in stueckliste["inhalt"].get("components", []):
                traeger[(_kanonisch(k["name"]), k.get("version"))] = ort
    # Python-Pakete, die der Scan des Images meldet, die aber nicht installiert sind:
    # Sie stecken in einem anderen Paket (pip bringt seine Bibliotheken so mit).
    for fund in funde:
        name = _kanonisch(fund["paket"])
        if fund["art"] == "python-pkg" and installiert.get(name) != fund["installiert"]:
            fund["ort"] = traeger.get((name, fund["installiert"]), fund["ort"])

    vorher = json.loads(APP_SBOM.read_text(encoding="utf-8"))
    basis_ohne_digest = basis_image("api").split("@")[0]
    kennung = code["commit"] + ("" if code["unveraendert"] else "-dirty")
    schreibe_json(APP_SBOM, app_stueckliste(roh, metadaten, vorher, kennung, basis_ohne_digest))
    schreibe_json(SCAN, {"stand": stand, "funde": sortiert(funde)})
    bericht_schreiben()


def bericht_schreiben() -> None:
    scan = json.loads(SCAN.read_text(encoding="utf-8"))
    app = json.loads(APP_SBOM.read_text(encoding="utf-8"))
    image_sboms = {
        name: json.loads(
            (ZIEL / f"stoerungsinfo-image-{name}.cdx.json").read_text(encoding="utf-8")
        )
        for name in scan["stand"]["images"]
    }
    KOMPONENTEN_MD.write_text(
        komponenten_md(scan["stand"], app, image_sboms), encoding="utf-8", newline="\n"
    )
    SCHWACHSTELLEN_MD.write_text(
        schwachstellen_md(scan, lade_bewertung(), app, image_sboms), encoding="utf-8", newline="\n"
    )
    print(f"Geschrieben: {KOMPONENTEN_MD.name}, {SCHWACHSTELLEN_MD.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("befehl", choices=["erzeuge", "bericht"])
    befehl = parser.parse_args().befehl
    erzeuge() if befehl == "erzeuge" else bericht_schreiben()
    return 0


if __name__ == "__main__":
    sys.exit(main())
