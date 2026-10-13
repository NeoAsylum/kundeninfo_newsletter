"""Unterlagen in docs/governance (ADR-0026): der Generator ops/governance.py und das, was er
erzeugt hat. Die Dokumente dort liest die Governance-Prüfung, nicht die Anwendung — ohne
diese Tests fiele nicht auf, wenn Stückliste, Bericht und Bewertung auseinanderlaufen."""

import email.message
import http.client
import importlib.util
import io
import json
import pathlib
import re
import sys
import urllib.error

import pytest

REPO = pathlib.Path(__file__).resolve().parents[3]
ZIEL = REPO / "docs" / "governance"

_SPEC = importlib.util.spec_from_file_location("governance", REPO / "ops" / "governance.py")
assert _SPEC and _SPEC.loader
gov = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(gov)


def _json(name: str) -> dict:
    return json.loads((ZIEL / name).read_text(encoding="utf-8"))


# ---------- Urheber und Lizenzen ----------


@pytest.mark.parametrize(
    ("metadaten", "erwartet"),
    [
        # der Regelfall seit pyproject.toml: Name und Adresse zusammen in Author-email
        ({"Author-email": "Tom Christie <tom@example.org>"}, ["Tom Christie"]),
        # mehrere, einer doppelt
        (
            {"Author-email": "A One <a@example.org>, B Two <b@example.org>, A One <c@example.org>"},
            ["A One", "B Two"],
        ),
        # ein Anzeigename, der selbst eine Liste ist
        (
            {"Author-email": '"Guido van Rossum, Jukka Lehtosalo" <x@example.org>'},
            ["Guido van Rossum", "Jukka Lehtosalo"],
        ),
        # Umlaute roh und nach RFC 2047 kodiert
        ({"Author-email": "Alex Grönholm <a@example.org>"}, ["Alex Grönholm"]),
        (
            {"Author-email": "=?utf-8?q?Sebasti=C3=A1n_Ram=C3=ADrez?= <t@example.org>"},
            ["Sebastián Ramírez"],
        ),
        # Name und Adresse getrennt; die nackte Adresse ist kein Name
        ({"Author": "Kenneth Reitz", "Author-email": "me@example.org"}, ["Kenneth Reitz"]),
        ({"Author": "Armin Rigo, Maciej Fijalkowski"}, ["Armin Rigo", "Maciej Fijalkowski"]),
        # kein Autor genannt: die Betreuer
        ({"Maintainer-email": "Pallets <contact@example.org>"}, ["Pallets"]),
        # ein Autor genannt: die Betreuer kommen nicht dazu
        (
            {
                "Author-email": "Tom Christie <t@example.org>",
                "Maintainer-email": "M T <m@example.org>",
            },
            ["Tom Christie"],
        ),
        # ältere Schreibweise: Name samt Adresse im Feld Author — der Name zählt, nicht der Betreuer
        ({"Author": "Jane Doe <jane@example.org>", "Maintainer": "Other"}, ["Jane Doe"]),
        ({"Author-email": "nur@example.org"}, []),
        ({}, []),
    ],
)
def test_autoren_sind_die_namen_die_das_paket_nennt_ohne_adressen(metadaten, erwartet):
    assert gov.autoren(metadaten) == erwartet


def test_lizenz_ohne_doppelten_classifier_und_mit_kennung_aus_dem_lizenztext():
    def bereinigt(name: str, *eintraege: dict) -> list[str]:
        komponente = {"name": name, "licenses": [{"license": e} for e in eintraege]}
        gov.lizenzen_bereinigen(komponente)
        return gov.lizenzen(komponente)

    bsd = {"name": "License :: OSI Approved :: BSD License"}
    apache = {"name": "License :: OSI Approved :: Apache Software License"}
    mpl = {"name": "License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)"}

    # derselbe Inhalt zweimal: Der Classifier sagt neben der Kennung nichts Neues
    assert bereinigt("certifi", {"id": "MPL-2.0"}, mpl) == ["MPL-2.0"]
    assert bereinigt("httpx", {"id": "BSD-3-Clause"}, bsd) == ["BSD-3-Clause"]
    # eine ANDERE Lizenz bleibt stehen — sonst ginge eine Wahlmöglichkeit verloren
    assert bereinigt("anderes", {"id": "MIT"}, apache) == ["MIT", apache["name"]]
    # ohne Kennung und ohne hinterlegten Lizenztext bleibt, was das Paket sagt
    assert bereinigt("irgendwas", bsd) == [bsd["name"]]
    # mehrdeutige Angabe: Es gilt der Lizenztext — als Schluss gekennzeichnet, nicht als Angabe
    for name, ausdruck in (("Jinja2", "BSD-3-Clause"), ("uvloop", "MIT OR Apache-2.0")):
        komponente = {"name": name, "licenses": [{"license": {"id": "MIT"}}, {"license": apache}]}
        gov.lizenzen_bereinigen(komponente)
        assert komponente["licenses"] == [{"acknowledgement": "concluded", "expression": ausdruck}]


def _rohe_stueckliste() -> dict:
    return {
        "metadata": {"timestamp": "2026-10-13T00:00:00+00:00"},
        "components": [
            {"bom-ref": "fastapi==1", "name": "fastapi", "version": "1", "licenses": []},
            {"bom-ref": "starlette==2", "name": "starlette", "version": "2", "licenses": []},
            {"bom-ref": "pydantic-core==3", "name": "pydantic_core", "version": "3"},
            {"bom-ref": "pip==4", "name": "pip", "version": "4"},
        ],
        "dependencies": [{"ref": "fastapi==1", "dependsOn": ["starlette==2"]}],
    }


VORHER = {
    "metadata": {
        "component": {"bom-ref": "portal@aaaaaaa", "name": "portal", "version": "0.1+aaaaaaa"},
        "supplier": {"name": "Team"},
    }
}


def test_app_stueckliste_bekommt_autoren_wurzel_und_mitgelieferte_bibliotheken(monkeypatch):
    monkeypatch.setattr(gov, "direkte_abhaengigkeiten", lambda: {"fastapi", "pydantic-core"})
    eingebettet = {
        "bomFormat": "CycloneDX",
        "components": [
            {"name": "pydantic_core", "version": "3"},  # das Paket selbst
            {
                "name": "pyo3",
                "version": "0.2",
                "purl": "pkg:cargo/pyo3@0.2",
                "bom-ref": "x",
                "author": "D H <d@example.org>, PyO3 Authors",
            },
            {"name": "pyo3", "version": "0.2", "purl": "pkg:cargo/pyo3@0.2", "bom-ref": "y"},
            {"name": "cc", "version": "1.0", "scope": "excluded"},  # diente nur dem Bau
            {"name": "ohne-version"},
        ],
    }
    metadaten = [
        {"Name": "FastAPI", "Author-email": "S R <s@example.org>", "Stuecklisten": []},
        {
            "Name": "pydantic-core",
            "Author-email": "S C <c@example.org>",
            "Stuecklisten": [
                {"datei": "pydantic_core-3.dist-info/sboms/x.json", "inhalt": eingebettet}
            ],
        },
        {"Name": "pip", "Stuecklisten": []},
    ]

    roh = _rohe_stueckliste()

    sbom = gov.app_stueckliste(roh, metadaten, VORHER, "bbbbbbb", "python:3-slim")

    je_name = {k["name"]: k for k in sbom["components"]}
    assert je_name["fastapi"]["authors"] == [{"name": "S R"}]
    assert "authors" not in je_name["starlette"]  # nichts erfinden, wo das Paket nichts nennt
    assert je_name["pip"]["properties"] == [{"name": "scope", "value": "build-tool"}]
    # Namen mit Unterstrich und Bindestrich meinen dasselbe Paket
    enthalten = je_name["pydantic_core"]["components"]
    assert [(k["name"], k["version"], k.get("scope")) for k in enthalten] == [
        ("cc", "1.0", "excluded"),
        ("pyo3", "0.2", None),
    ]
    assert enthalten[1]["bom-ref"] == "pydantic-core==3/pyo3@0.2"
    assert enthalten[1]["authors"] == [{"name": "D H"}, {"name": "PyO3 Authors"}]
    assert "authors" not in enthalten[0]
    assert sbom["metadata"]["component"] == {
        "bom-ref": "portal@bbbbbbb",
        "name": "portal",
        "version": "0.1+bbbbbbb",
    }
    assert sbom["metadata"]["supplier"] == {"name": "Team"}
    assert sbom["metadata"]["properties"] == [
        {"name": "runtime:base-image", "value": "python:3-slim"}
    ]
    assert sbom["dependencies"][-1] == {
        "ref": "portal@bbbbbbb",
        "dependsOn": ["fastapi==1", "pydantic-core==3"],
    }
    assert "@example.org" not in json.dumps(sbom)


def test_stueckliste_eines_images_nennt_das_image_und_keine_adressen():
    sbom = {
        "metadata": {
            "component": {
                "type": "container",
                "name": "/tmp/image.tar",
                "properties": [
                    {"name": "Labels:maintainer", "value": "Maintainers <maint@example.org>"},
                    {"name": "DiffID", "value": "sha256:0123"},
                    # So führt Podman ein Image, das docker-compose gebaut hat …
                    {
                        "name": "aquasecurity:trivy:RepoTag",
                        "value": "docker.io/library/stoerungsinfo-nginx:local",
                    },
                    # … und so eines aus „podman build“. Docker nennt nur den Namen.
                    {
                        "name": "aquasecurity:trivy:Reference",
                        "value": "localhost/stoerungsinfo-nginx:local",
                    },
                ],
            }
        },
        "components": [
            {"name": "a", "supplier": {"name": "NGINX Packaging <packaging@example.org>"}},
            {"name": "b", "supplier": {"name": "Ohne Adresse"}},
            {"name": "c"},
            # Freitext „2-clause BSD-like license“, von Trivy in drei Wörter zerlegt
            {"name": "nginx", "licenses": [{"license": {"name": "2-clause"}},
                                           {"license": {"id": "BSD-3-Clause"}},
                                           {"license": {"name": "license"}}]},
            {"name": "echt", "licenses": [{"license": {"id": "BSD-3-Clause"}}]},
            # derselbe Freitext, aber laut COPYRIGHT im Image eine andere Lizenz
            {"name": "nginx-module-acme", "licenses": [{"license": {"name": "2-clause"}},
                                                       {"license": {"id": "BSD-3-Clause"}},
                                                       {"license": {"name": "license"}}]},
        ],
        "vulnerabilities": [],
    }  # fmt: skip

    fertig = gov.image_stueckliste(sbom, "nginx", "sha256:abc", {"NGINX_VERSION": "1.30.5"})

    assert fertig["metadata"]["component"] == {
        "type": "container",
        "name": "stoerungsinfo-nginx",
        "version": "sha256:abc",
        "properties": [
            {"name": "Labels:maintainer", "value": "Maintainers"},
            {"name": "DiffID", "value": "sha256:0123"},
            {"name": "aquasecurity:trivy:RepoTag", "value": "stoerungsinfo-nginx:local"},
            {"name": "aquasecurity:trivy:Reference", "value": "stoerungsinfo-nginx:local"},
        ],
    }
    assert gov.lokaler_name("stoerungsinfo-nginx:local") == "stoerungsinfo-nginx:local"
    assert [k.get("supplier") for k in fertig["components"]] == [
        {"name": "NGINX Packaging"},
        {"name": "Ohne Adresse"},
        None,
        None,
        None,
        None,
    ]
    assert [gov.lizenzen(k) for k in fertig["components"][3:]] == [
        ["BSD-2-Clause"],
        ["BSD-3-Clause"],
        ["Apache-2.0"],
    ]
    assert "vulnerabilities" not in fertig


def test_was_der_scanner_nicht_sieht_steht_von_hand_in_der_stueckliste_des_image():
    """PostgreSQL und Python sind in ihren Images aus dem Quelltext gebaut; Trivy listet sie
    nicht. Wer nur die Stückliste verarbeitet, sähe die Hauptsache des Image sonst nicht."""
    leer = {
        "metadata": {"component": {"bom-ref": "wurzel"}},
        "components": [],
        "dependencies": [{"ref": "wurzel", "dependsOn": ["alpine"]}],
    }

    postgres = gov.image_stueckliste(leer, "postgres", "sha256:abc", {"PG_VERSION": "18.6"})

    assert postgres["dependencies"] == [
        {"ref": "wurzel", "dependsOn": ["alpine", "von-hand:postgresql@18.6"]},
        {"ref": "von-hand:postgresql@18.6", "dependsOn": []},
    ]

    assert postgres["components"] == [
        {
            "bom-ref": "von-hand:postgresql@18.6",
            "type": "application",
            "name": "PostgreSQL",
            "version": "18.6",
            "purl": "pkg:generic/postgresql@18.6",
            "licenses": [{"license": {"id": "PostgreSQL"}}],
            "supplier": {"name": "PostgreSQL Global Development Group"},
            "properties": [
                {
                    "name": "stoerungsinfo:quelle",
                    "value": "von Hand (ops/governance.py) — aus dem Quelltext gebaut",
                }
            ],
        }
    ]
    # NGINX, gosu und Keycloak findet der Scanner selbst: nichts von Hand
    ohne = {"metadata": {"component": {}}, "components": []}
    assert gov.image_stueckliste(ohne, "nginx", "sha256:abc", {})["components"] == []


def test_eine_stueckliste_mit_schwachstellen_wird_nicht_geschrieben():
    """Stückliste und Schwachstellen sind getrennte Dokumente (BSI TR-03183-2, 3.1)."""
    sbom = {"metadata": {"component": {}}, "vulnerabilities": [{"id": "CVE-1"}]}

    with pytest.raises(SystemExit, match="enthält Schwachstellen"):
        gov.image_stueckliste(sbom, "api", "sha256:abc", {})


# ---------- Funde und Bewertung ----------

BERICHT = {
    "Results": [
        {
            "Target": "image (debian 13)",
            "Class": "os-pkgs",
            "Type": "debian",
            "Packages": [
                {"ID": "mount@2.41", "Name": "mount", "SrcName": "util-linux"},
                {"ID": "bsdutils@1:2.41", "Name": "bsdutils", "SrcName": "util-linux"},
            ],
            "Vulnerabilities": [
                {"VulnerabilityID": "CVE-1", "PkgID": "mount@2.41", "PkgName": "mount",
                 "InstalledVersion": "2.41", "Severity": "HIGH", "Status": "affected"},
                {"VulnerabilityID": "CVE-1", "PkgID": "bsdutils@1:2.41", "PkgName": "bsdutils",
                 "InstalledVersion": "1:2.41", "Severity": "HIGH", "Status": "affected"},
                {"VulnerabilityID": "CVE-2", "PkgID": "mount@2.41", "PkgName": "mount",
                 "InstalledVersion": "2.41", "Severity": "LOW", "Status": "affected"},
            ],
        },
        {
            "Target": "usr/local/bin/gosu",
            "Class": "lang-pkgs",
            "Type": "gobinary",
            "Vulnerabilities": [
                {"VulnerabilityID": "CVE-3", "PkgName": "stdlib", "InstalledVersion": "v1.24.6",
                 "FixedVersion": "1.25.1", "Severity": "CRITICAL", "Status": "fixed",
                 "Title": "t", "PrimaryURL": "https://example.org/CVE-3"},
            ],
        },
        {
            "Target": "Python",
            "Class": "lang-pkgs",
            "Type": "python-pkg",
            "Vulnerabilities": [
                {"VulnerabilityID": "CVE-4", "PkgName": "urllib3", "InstalledVersion": "2.7.0",
                 "FixedVersion": "2.8.0", "Severity": "HIGH", "Status": "fixed"},
            ],
        },
        {"Target": "Java", "Class": "lang-pkgs", "Type": "jar", "Vulnerabilities": None},
    ]
}  # fmt: skip


def test_funde_nennen_quellpaket_und_ort():
    funde = gov.funde_aus_trivy("api", BERICHT)

    assert [(f["id"], f["paket"], f["quellpaket"], f["ort"]) for f in funde] == [
        ("CVE-1", "mount", "util-linux", ""),
        ("CVE-1", "bsdutils", "util-linux", ""),
        ("CVE-2", "mount", "util-linux", ""),
        ("CVE-3", "stdlib", "stdlib", "usr/local/bin/gosu"),
        ("CVE-4", "urllib3", "urllib3", ""),
    ]
    assert funde[3] | {"image": "", "art": ""} == {
        "image": "", "id": "CVE-3", "schweregrad": "CRITICAL", "paket": "stdlib",
        "quellpaket": "stdlib", "art": "", "ort": "usr/local/bin/gosu", "installiert": "v1.24.6",
        "korrigiert_in": "1.25.1", "status_der_quelle": "fixed", "titel": "t",
        "url": "https://example.org/CVE-3",
    }  # fmt: skip


def test_bericht_ueber_eine_mitgelieferte_stueckliste_zaehlt_nur_die_bibliotheken_darin():
    """Die Stückliste eines Python-Pakets nennt auch das Paket selbst. Dessen Funde meldet
    schon der Scan des Images — hier zählen nur die eingebauten Bibliotheken."""
    bericht = {
        "Results": [
            BERICHT["Results"][2],
            {
                "Type": "cargo",
                "Vulnerabilities": [
                    {"VulnerabilityID": "GHSA-1", "PkgName": "pyo3", "Severity": "HIGH"}
                ],
            },
        ]
    }
    funde = gov.funde_aus_trivy("api", bericht, ort="pydantic_core (mitgeliefert)")

    assert [(f["id"], f["art"], f["ort"]) for f in funde] == [
        ("GHSA-1", "cargo", "pydantic_core (mitgeliefert)")
    ]


def test_je_luecke_fasst_die_binaerpakete_eines_quelltexts_zusammen():
    luecken = gov.je_luecke(gov.funde_aus_trivy("api", BERICHT))

    assert [(lu["quellpaket"], lu["id"], lu["pakete"], lu["versionen"]) for lu in luecken] == [
        ("util-linux", "CVE-1", ["mount", "bsdutils"], ["2.41", "1:2.41"]),
        ("util-linux", "CVE-2", ["mount"], ["2.41"]),
        ("stdlib", "CVE-3", ["stdlib"], ["v1.24.6"]),
        ("urllib3", "CVE-4", ["urllib3"], ["2.7.0"]),
    ]


BEWERTUNG_OK = {
    "image": "api",
    "paket": "util-linux",
    "status": "not_affected",
    "warum": "vulnerable_code_not_in_execute_path",
    "begruendung": "Läuft nie.",
    "stand": "2026-10-13",
}


@pytest.mark.parametrize(
    ("aenderung", "fehler"),
    [
        ({}, None),
        ({"cves": ["CVE-1", "GHSA-2"]}, None),
        ({"status": "affected", "warum": "", "massnahme": "Paket anheben."}, None),
        ({"status": "under_investigation", "warum": ""}, None),
        # „warum“ gehört zu „nicht betroffen“ — bei einem anderen Status widerspräche es ihm
        ({"status": "under_investigation"}, "nur bei „not_affected“"),
        # ein vertipptes Feld machte aus dem Eintrag ein Urteil über alle Lücken des Pakets
        ({"cve": ["CVE-1"]}, "unbekanntes Feld „cve“"),
        ({"cves": "CVE-1"}, "Liste von Kennungen"),
        ({"cves": []}, "Liste von Kennungen"),
        ({"begruendung": ""}, "begruendung"),
        ({"stand": ""}, "stand"),
        ({"image": "mailpit"}, "unbekanntes Image"),
        ({"status": "harmlos"}, "unbekannter Status"),
        ({"warum": ""}, "braucht „warum“"),
        ({"warum": "weil"}, "braucht „warum“"),
        ({"status": "affected", "warum": ""}, "braucht eine „massnahme“"),
    ],
)
def test_eine_bewertung_braucht_status_begruendung_und_stand(aenderung, fehler):
    """„Nicht betroffen“ ohne Grund und „betroffen“ ohne Maßnahme sind keine Bewertung."""
    ergebnis = gov.pruefe_bewertung(BEWERTUNG_OK | aenderung)

    assert (ergebnis is None) if fehler is None else (fehler in ergebnis)


def test_die_datei_der_bewertungen_wird_als_ganzes_geprueft():
    doppelt = [BEWERTUNG_OK | {"cves": ["CVE-1", "CVE-2"]}, BEWERTUNG_OK | {"cves": ["CVE-2"]}]
    getrennt = [BEWERTUNG_OK | {"cves": ["CVE-2"]}, BEWERTUNG_OK | {"cves": ["CVE-2"], "ort": "x"}]

    assert gov.pruefe_datei({}) is None
    assert gov.pruefe_datei({"bewertung": getrennt}) is None  # derselbe Name an anderem Ort
    assert "zwei Einträge für dieselbe Lücke" in gov.pruefe_datei({"bewertung": doppelt})
    assert "„status“ fehlt" in gov.pruefe_datei({"bewertung": [{"image": "api", "paket": "x"}]})
    ohne_stand = {"komponente": "CPython", "version": "3.14.8", "aussage": "Neuester Stand."}
    assert "[[ohne_scan]]: „stand“ fehlt" in gov.pruefe_datei({"ohne_scan": [ohne_stand]})
    # eine Version ohne Anführungszeichen läse TOML als Zahl — und nie gleich der im Bestand
    als_zahl = ohne_stand | {"version": 18.6, "stand": "2026-10-13"}
    assert "[[ohne_scan]]: „version“ fehlt oder ist kein Text" in gov.pruefe_datei(
        {"ohne_scan": [als_zahl]}
    )
    assert "[[massnahme]]: „aufwand“ fehlt" in gov.pruefe_datei(
        {"massnahme": [{"titel": "t", "wirkung": "w"}]}
    )


def test_die_bewertung_mit_kennung_geht_der_fuer_das_ganze_paket_vor():
    paket = BEWERTUNG_OK
    einzeln = BEWERTUNG_OK | {"cves": ["CVE-2"], "status": "under_investigation", "warum": ""}
    anderes_image = BEWERTUNG_OK | {"image": "nginx"}
    anderer_ort = BEWERTUNG_OK | {"paket": "stdlib", "ort": "usr/bin/anderes"}
    bewertungen = [anderes_image, anderer_ort, paket, einzeln]
    je_id = {lu["id"]: lu for lu in gov.je_luecke(gov.funde_aus_trivy("api", BERICHT))}

    assert gov.bewertung_fuer(je_id["CVE-1"], bewertungen) is paket
    assert gov.bewertung_fuer(je_id["CVE-2"], bewertungen) is einzeln
    assert gov.bewertung_fuer(je_id["CVE-3"], bewertungen) is None  # anderer Ort
    assert gov.bewertung_fuer(je_id["CVE-4"], bewertungen) is None


def test_ein_eintrag_ohne_ort_gilt_nicht_fuer_die_gleichnamige_bibliothek_in_einem_paket():
    """openssl als Paket des Betriebssystems und openssl als Kopie in einem Python-Paket sind
    zwei Dinge. Ein Eintrag für das eine darf das andere nicht still mit freisprechen."""
    paket = {"image": "api", "quellpaket": "openssl", "ort": "", "id": "CVE-1"}
    kopie = paket | {"ort": "cryptography (mitgeliefert)"}
    eintrag = BEWERTUNG_OK | {"paket": "openssl", "cves": ["CVE-1"]}
    fuer_die_kopie = eintrag | {"ort": "cryptography (mitgeliefert)"}

    assert gov.bewertung_fuer(paket, [eintrag, fuer_die_kopie]) is eintrag
    assert gov.bewertung_fuer(kopie, [eintrag]) is None
    assert gov.bewertung_fuer(kopie, [eintrag, fuer_die_kopie]) is fuer_die_kopie


def _scan() -> dict:
    stand = {
        "erzeugt": "2026-10-13T06:00:00Z",
        "code": {"commit": "abc1234", "unveraendert": True},
        "werkzeug": {"name": "Trivy", "version": "0.75.0", "image": "x"},
        "datenbank": {"schwachstellen": "2026-10-13T01:00:00Z", "java": "2026-10-12T01:00:00Z"},
        "images": {
            "api": {
                "image": "stoerungsinfo-api:local",
                "id": "sha256:0123456789abcdef",
                "basis": "python:3.14.8-slim@sha256:aa",
                "basis_aktuell": True,
                "plattform": "linux/amd64",
                "os": "debian 13",
                "versionen": {"PYTHON_VERSION": "3.14.8"},
            }
        },
        "fremd_images": [],
    }
    return {"stand": stand, "funde": gov.funde_aus_trivy("api", BERICHT)}


APP = {"components": [{"name": "cryptography", "version": "50", "components": [
    {"name": "openssl", "version": "4.0.3"}]}]}  # fmt: skip
IMAGES = {"nginx": {"components": [{"name": "libssl3", "version": "3.5.8-r0"}]}}


def test_bericht_nennt_jede_luecke_einmal_und_unbewertete_als_in_pruefung():
    nur_cve_1 = BEWERTUNG_OK | {"cves": ["CVE-1"]}
    bewertung = {"bewertung": [nur_cve_1], "ohne_scan": [], "massnahme": []}

    text = gov.schwachstellen_md(_scan(), bewertung, APP, IMAGES)

    # Zahlen wie der Scanner (CVE-1 zweimal), bewertet wird jede Lücke einmal
    assert "| api | 1 | 3 | 0 | 1 | 0 | 3 | 2 |" in text
    assert "| nicht betroffen (`not_affected`) | 1 |" in text
    assert "| in Prüfung (`under_investigation`) | 2 |" in text
    # Binärpakete tragen teils eine eigene Version (hier mit Epoche) — beide stehen da
    assert "**util-linux 1:2.41 / 2.41** (Debian-Paket; installiert als: bsdutils, mount)" in text
    assert "Untersucht sind die Images der Tabelle (linux/amd64):" in text
    assert "steht in Abschnitt 4. „Laut Quelle“" in text  # nichts in Prüfung außerhalb des Scans
    assert text.count("| CVE-1 |") == 1
    assert (
        "Bewertung: **nicht betroffen** (verwundbarer Code wird nicht ausgeführt) — Läuft nie. "
        "(Stand 2026-10-13)"
    ) in text
    assert "**stdlib v1.24.6** (Go-Modul, in `usr/local/bin/gosu`)" in text
    assert "[CVE-3](https://example.org/CVE-3) | CRITICAL | 1.25.1 | Korrektur verfügbar" in text
    assert text.count("Bewertung: **in Prüfung** — noch nicht bewertet.") == 2
    assert "CVE-2" not in text  # LOW: nur gezählt
    assert "Bewertungen ohne Fund" not in text
    assert "Mögliche Maßnahmen" not in text
    assert "\n\n\n" not in text


def test_auch_ein_niedrig_eingestufter_fund_steht_im_bericht_wenn_er_eigens_bewertet_ist():
    eigens = BEWERTUNG_OK | {"cves": ["CVE-2"], "begruendung": "Eigens geprüft."}
    bewertung = {"bewertung": [eigens], "ohne_scan": [], "massnahme": [], "methode": "So geprüft."}

    text = gov.schwachstellen_md(_scan(), bewertung, APP, IMAGES)

    assert "| CVE-2 | LOW |" in text
    assert "— Eigens geprüft. (Stand 2026-10-13)" in text
    assert "| api | 1 | 3 | 0 | 1 | 0 | 4 | 2 |" in text
    assert "\n\nSo geprüft.\n\n### api\n" in text


def test_ein_image_ohne_fund_und_ein_unbekannter_paketart_brechen_den_bericht_nicht():
    scan = _scan()
    scan["funde"] = [f | {"art": "rustbinary"} for f in scan["funde"] if f["id"] == "CVE-4"]
    scan["stand"]["images"]["nginx"] = scan["stand"]["images"]["api"] | {"plattform": "linux/arm64"}
    leer = {"bewertung": [], "ohne_scan": [], "massnahme": []}

    text = gov.schwachstellen_md(scan, leer, APP, IMAGES)

    assert "**urllib3 2.7.0** (rustbinary)" in text
    assert "(linux/amd64, linux/arm64)" in text
    assert "### nginx\n\nKeine Funde CRITICAL, HIGH oder UNKNOWN.\n\n## 4. Was der Scan" in text


def test_bericht_meldet_bewertungen_ohne_fund_und_veraltete_angaben():
    erledigt = BEWERTUNG_OK | {"paket": "weg", "cves": ["CVE-9"]}
    # CVE-1 meldet der Scan noch, CVE-8 nicht mehr: Nur die eine Kennung ist gegenstandslos
    teils = BEWERTUNG_OK | {"cves": ["CVE-1", "CVE-8"]}
    ganzes_paket = BEWERTUNG_OK | {"paket": "entfallen"}
    bewertung = {
        "bewertung": [erledigt, teils, ganzes_paket],
        "ohne_scan": [
            {"komponente": "CPython", "version": "3.14.8", "version_aus": "api:PYTHON_VERSION",
             "aussage": "Neuester Stand.", "stand": "2026-10-13"},
            {"komponente": "OpenSSL", "version": "4.0.2", "aussage": "Neuester Stand.",
             "version_aus": "paket:cryptography:openssl", "stand": "2026-10-01"},
            {"komponente": "libuv", "version": "1.50", "aussage": "Ohne Prüfung.",
             "stand": "2026-10-13"},
            {"komponente": "OpenSSL im Image", "version": "3.5.8-r0", "aussage": "Nicht bewertet.",
             "version_aus": "sbom:nginx:libssl3", "stand": "2026-10-13", "offen": True},
            {"komponente": "weg", "version": "1", "aussage": "x", "version_aus": "sbom:nginx:fehlt",
             "stand": "2026-10-13"},
        ],
        "massnahme": [{"titel": "Paket anheben", "wirkung": "behebt | zwei", "aufwand": "klein"}],
    }  # fmt: skip

    text = gov.schwachstellen_md(_scan(), bewertung, APP, IMAGES)

    assert "## 5. Mögliche Maßnahmen" in text
    assert r"| Paket anheben | behebt \| zwei | klein |" in text
    assert "## 6. Bewertungen ohne Fund" in text
    assert "- api: weg (CVE-9)\n- api: util-linux (CVE-8)\n- api: entfallen\n" in text
    assert "steht in Abschnitt 4; dort ist ein Punkt in Prüfung." in text
    assert "| CPython | 3.14.8 | Neuester Stand. | 2026-10-13 |" in text
    # Die Angabe galt für 4.0.2 — im Bestand ist inzwischen 4.0.3
    assert (
        "| OpenSSL | 4.0.3 | **Veraltet:** Die Angabe gilt für 4.0.2, im Bestand ist 4.0.3. "
        "Neu prüfen. | 2026-10-01 |"
    ) in text
    assert "| libuv | 1.50 | Ohne Prüfung. | 2026-10-13 |" in text
    assert "| OpenSSL im Image | 3.5.8-r0 | **In Prüfung.** Nicht bewertet. | 2026-10-13 |" in text
    assert "im Bestand ist nichts dergleichen. Neu prüfen." in text
    # ohne Maßnahmen rückt der letzte Abschnitt auf
    ohne_massnahmen = gov.schwachstellen_md(_scan(), bewertung | {"massnahme": []}, APP, IMAGES)
    assert "## 5. Bewertungen ohne Fund" in ohne_massnahmen
    assert "## 6." not in ohne_massnahmen


def test_tabellenzellen_brechen_die_tabelle_nicht():
    assert gov.tabelle(["a", "b"], [["x|y", "zwei\nZeilen"], ["", 0]]) == (
        "| a | b |\n|---|---|\n| x\\|y | zwei Zeilen |\n| – | 0 |"
    )


def test_komponentenliste_nennt_jede_bibliothek_einmal_und_kennt_fremde_paketarten():
    def paket(name: str, art: str, **mehr: object) -> dict:
        eigenschaften = [{"name": "aquasecurity:trivy:PkgType", "value": art}]
        return {"name": name, "version": "1", "properties": eigenschaften} | mehr

    stand = _scan()["stand"]
    stand["images"] |= {name: {"versionen": {}} for name in gov.IMAGES if name != "api"}
    app = {
        "components": [
            {
                "name": "cryptography",
                "version": "50",
                "licenses": [],
                "components": [
                    {"name": "openssl", "version": "4.0.3", "purl": "pkg:generic/openssl@4.0.3"},
                    {"name": "cc", "version": "1.0", "purl": "pkg:cargo/cc@1.0",
                     "scope": "excluded", "authors": [{"name": "A B"}]},
                ],
            }
        ]
    }  # fmt: skip
    image = {
        "components": [
            paket("libc6", "debian", supplier={"name": "GNU Libc Maintainers"}),
            paket("jna", "jar", group="net.java"),
            paket("jna", "jar", group="net.java"),  # dieselbe Bibliothek an zweiter Stelle
            paket("neu", "rustbinary"),
            paket("fastapi", "python-pkg"),  # steht in Abschnitt 2
            {"name": "ohne-art", "version": "1"},
        ]
    }

    text = gov.komponenten_md(stand, app, {"api": image})

    assert "1 × Debian-Paket, 1 × Java-Bibliothek, 1 × rustbinary. Dazu die Python-Pakete" in text
    assert "| libc6 | 1 | Debian-Paket | – | GNU Libc Maintainers |" in text
    assert text.count("| net.java:jna | 1 | Java-Bibliothek | – | – |") == 1
    assert "| neu | 1 | rustbinary | – | – |" in text
    assert "| fastapi | 1 |" not in text and "ohne-art" not in text
    assert "| cryptography | openssl | 4.0.3 | aus Quelltext gebaut | – | – |" in text
    assert "| cryptography | cc | 1.0 | Rust-Bibliothek, nur zum Bau | – | A B |" in text


# ---------- Was im Ordner liegt ----------


def test_jedes_python_paket_der_stueckliste_nennt_autoren_und_eine_spdx_lizenz():
    sbom = _json("stoerungsinfo-app.cdx.json")

    ohne_autor = [k["name"] for k in sbom["components"] if not k.get("authors")]
    ohne_kennung = [
        k["name"]
        for k in sbom["components"]
        if not any("expression" in e or "id" in e.get("license", {}) for e in k.get("licenses", []))
    ]
    assert (ohne_autor, ohne_kennung) == ([], [])


def test_die_stuecklisten_fuehren_namen_aber_keine_email_adressen():
    """Autoren und Herausgeber stehen mit Namen da. Adressen Dritter gehören nicht in ein
    öffentliches Repository, nur weil ein Paket sie in seinen Metadaten führt."""
    adresse = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
    treffer = []
    for datei in sorted(ZIEL.glob("*.cdx.json")):
        sbom = _json(datei.name)
        # Labels des Image (etwa „maintainer“) stehen als Eigenschaften an der Wurzel
        namen = [e.get("value", "") for e in sbom["metadata"]["component"].get("properties", [])]
        for komponente in sbom["components"]:
            namen += [a.get("name", "") for a in komponente.get("authors", [])]
            namen.append((komponente.get("supplier") or {}).get("name", ""))
            assert all("email" not in a for a in komponente.get("authors", [])), datei.name
        treffer += [(datei.name, name) for name in namen if adresse.search(name)]
        # … und nirgends sonst in der Schreibweise „Name <adresse>“ oder als mailto-Verweis
        text = (ZIEL / datei.name).read_text(encoding="utf-8")
        assert not re.search(r"<[^<>\s]+@[^<>\s]+>|mailto:", text), datei.name
    assert treffer == []
    for datei in ("KOMPONENTEN.md", "SCHWACHSTELLEN.md"):
        assert not adresse.search((ZIEL / datei).read_text(encoding="utf-8")), datei


def test_keine_stueckliste_enthaelt_schwachstellen():
    """Stückliste und Schwachstellen sind getrennte Dokumente (BSI TR-03183-2, 3.1): Die eine
    ändert sich mit der Software, die anderen täglich."""
    for datei in sorted(ZIEL.glob("*.cdx.json")):
        assert "vulnerabilities" not in _json(datei.name), datei.name


def test_der_scan_deckt_die_images_ab_die_das_projekt_baut():
    """Hebt jemand ein Basis-Image an, beschreiben Stücklisten und Bericht ein Image, das so
    nicht mehr gebaut wird — bis `make governance` neu gelaufen ist. Die Unterlagen nennen
    die Images in der Kurzform von Docker Hub, Dockerfiles und Generator schreiben die
    Registry aus (ADR-0033)."""
    stand = _json("schwachstellen.json")["stand"]

    assert list(stand["images"]) == list(gov.IMAGES)
    for name, angaben in stand["images"].items():
        assert angaben["basis"] == gov.kurzform(gov.basis_image(name)), name
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", angaben["id"]), name
        assert (ZIEL / f"stoerungsinfo-image-{name}.cdx.json").is_file()
    assert stand["werkzeug"]["image"] == gov.kurzform(gov.TRIVY)
    assert re.fullmatch(r"docker\.io/aquasec/trivy:[\d.]+@sha256:[0-9a-f]{64}", gov.TRIVY)


def test_das_nginx_image_des_pilots_baut_auf_demselben_basis_image():
    """Untersucht wird das NGINX-Image aus deploy/nginx/Dockerfile. Der Bericht sagt, das des
    Pilots (Dockerfile.public) habe dasselbe Basis-Image und nur eine andere Konfiguration —
    das gilt, solange beide dieselbe FROM-Zeile haben und keines Pakete nachinstalliert."""
    pilot = (REPO / "deploy" / "nginx" / "Dockerfile.public").read_text(encoding="utf-8")

    assert re.findall(r"^FROM\s+(\S+)", pilot, re.M) == [gov.basis_image("nginx")]
    assert not re.search(r"\b(?:apk|apt-get|pip|curl|wget)\b", pilot)


def test_komponentenliste_und_bericht_sind_das_was_der_generator_schreibt():
    """Beide Markdown-Dokumente entstehen aus den Dateien daneben. Wer eine Stückliste, den
    Scan oder die Bewertung ändert, ohne `python ops/governance.py bericht` laufen zu lassen
    — oder ein Dokument von Hand —, hat danach zwei Stände."""
    scan = _json("schwachstellen.json")
    app = _json("stoerungsinfo-app.cdx.json")
    images = {
        name: _json(f"stoerungsinfo-image-{name}.cdx.json") for name in scan["stand"]["images"]
    }

    komponenten = gov.komponenten_md(scan["stand"], app, images)
    bericht = gov.schwachstellen_md(scan, gov.lade_bewertung(), app, images)

    assert (ZIEL / "KOMPONENTEN.md").read_text(encoding="utf-8") == komponenten
    assert (ZIEL / "SCHWACHSTELLEN.md").read_text(encoding="utf-8") == bericht
    # Keine Version der Hauptkomponenten blieb offen
    assert "| ? |" not in komponenten


def test_jede_angabe_von_hand_gilt_fuer_die_version_im_bestand():
    """Abschnitt 4 des Berichts stützt sich auf Aussagen von Hand (etwa „neuester Patch-Stand“).
    Sie gelten für eine Version — ändert sich die, ist die Aussage neu zu prüfen."""
    scan, app = _json("schwachstellen.json"), _json("stoerungsinfo-app.cdx.json")
    images = {
        name: _json(f"stoerungsinfo-image-{name}.cdx.json") for name in scan["stand"]["images"]
    }

    def im_bestand(eintrag: dict) -> str | None:
        return gov.version_im_bestand(eintrag["version_aus"], scan["stand"], app, images)

    veraltet = [
        eintrag["komponente"]
        for eintrag in gov.lade_bewertung()["ohne_scan"]
        if "version_aus" in eintrag and im_bestand(eintrag) != eintrag["version"]
    ]
    assert veraltet == []


# ---------- Container-Engine: Docker oder Podman (ADR-0033) ----------


def test_kurzform_ist_der_name_auf_docker_hub():
    """Die Unterlagen nennen Images so, wie Docker Hub sie führt; eine andere Registry gehört
    zum Namen."""
    python = "docker.io/library/python:3.14.8-slim@sha256:aa"
    assert gov.kurzform(python) == "python:3.14.8-slim@sha256:aa"
    assert (
        gov.kurzform("docker.io/aquasec/trivy:0.75.0@sha256:bb") == "aquasec/trivy:0.75.0@sha256:bb"
    )
    assert gov.kurzform("quay.io/keycloak/keycloak:26.8.0") == "quay.io/keycloak/keycloak:26.8.0"
    assert gov.kurzform("python:3.14.8-slim") == "python:3.14.8-slim"


def test_die_image_id_traegt_unter_jeder_engine_dasselbe_praefix():
    """Der Bericht zeigt die zwölf Stellen hinter „sha256:“. Die Kommandozeile von Podman
    nennt die ID ohne das Präfix — ungeprüft stünden dort die Stellen 8 bis 19."""
    assert gov.image_id("sha256:" + "a" * 64) == "sha256:" + "a" * 64
    assert gov.image_id("b" * 64) == "sha256:" + "b" * 64


@pytest.mark.parametrize(
    ("gesetzt", "erwartet"), [(None, "docker"), ("", "docker"), ("podman", "podman")]
)
def test_der_generator_ruft_die_engine_aus_der_umgebung(monkeypatch, gesetzt, erwartet):
    """Dieselbe Variable wie im Makefile: `make governance CONTAINER_ENGINE=podman` baut mit
    Podman — läse der Generator danach die Images von Docker, untersuchte er einen anderen
    Bestand oder fände keinen."""
    if gesetzt is None:
        monkeypatch.delenv("CONTAINER_ENGINE", raising=False)
    else:
        monkeypatch.setenv("CONTAINER_ENGINE", gesetzt)
    assert _SPEC and _SPEC.loader
    modul = importlib.util.module_from_spec(_SPEC)
    _SPEC.loader.exec_module(modul)
    aufrufe: list[list[str]] = []

    def run(befehl, **_):
        aufrufe.append(befehl)
        return modul.subprocess.CompletedProcess(befehl, len(aufrufe) - 1, b"ok", b"kaputt")

    monkeypatch.setattr(modul.subprocess, "run", run)

    assert modul.engine("image", "inspect", "x") == b"ok"
    assert aufrufe == [[erwartet, "image", "inspect", "x"]]
    with pytest.raises(SystemExit, match=f"FEHLER: {erwartet} save x"):
        modul.engine("save", "x")


def test_der_generator_nennt_die_engine_nur_als_voreinstellung():
    """Drei Aufrufe gehen an engine() vorbei: „save“ und der Scanner in scanne(), die Frage
    nach den gebauten Images in erzeuge(). Stünde dort wieder „docker“, läse der Generator
    nach einem Bau mit Podman den Bestand der anderen Engine."""
    quelle = (REPO / "ops" / "governance.py").read_text(encoding="utf-8")

    assert re.findall(r"""["'](?:docker|podman)["']""", quelle) == ['"docker"']


class _Antwort(io.BytesIO):
    """Was urlopen zurückgibt, soweit der Generator es nutzt: Kopfzeilen, Inhalt, with."""

    def __init__(self, kopf: dict[str, str] | None = None, inhalt: bytes = b""):
        super().__init__(inhalt)
        self.headers = kopf or {}


def _registry(monkeypatch, antworten: dict) -> list[tuple]:
    """Ersetzt den Abruf: je (Methode, URL) die Antworten der Reihe nach — oder eine
    Ausnahme, die er wirft."""
    aufrufe: list[tuple] = []
    offen = {stelle: list(folge) for stelle, folge in antworten.items()}

    def https(url, kopf, methode="GET"):
        aufrufe.append((methode, url, dict(kopf)))
        ergebnis = offen[(methode, url)].pop(0)
        if isinstance(ergebnis, Exception):
            raise ergebnis
        return ergebnis

    monkeypatch.setattr(gov, "_https", https)
    return aufrufe


def _abgewiesen(url: str, code: int = 401, verweis: str | None = None) -> urllib.error.HTTPError:
    kopf = email.message.Message()
    if verweis:
        kopf["WWW-Authenticate"] = verweis
    return urllib.error.HTTPError(url, code, "abgewiesen", kopf, None)


_MANIFEST = "https://registry-1.docker.io/v2/library/python/manifests/3.14.8-slim"
_TOKEN = (
    "https://auth.docker.io/token"
    "?service=registry.docker.io&scope=repository%3Alibrary%2Fpython%3Apull"
)
_VERWEIS = (
    'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",'
    'scope="repository:library/python:pull"'
)


def test_der_digest_kommt_von_der_registry_mit_anonymem_token(monkeypatch):
    """Docker Hub weist die erste Anfrage ab und nennt, wo es ein Token gibt. Gefragt wird
    nach dem Index (alle Plattformen): Dessen Digest ist in den Dockerfiles gepinnt."""
    aufrufe = _registry(
        monkeypatch,
        {
            ("HEAD", _MANIFEST): [
                _abgewiesen(_MANIFEST, verweis=_VERWEIS),
                _Antwort({"Docker-Content-Digest": "sha256:cc"}),
            ],
            ("GET", _TOKEN): [_Antwort(inhalt=b'{"token": "geheim"}')],
        },
    )

    assert gov.digest_in_der_registry("docker.io/library/python:3.14.8-slim") == "sha256:cc"
    assert [(methode, url) for methode, url, _ in aufrufe] == [
        ("HEAD", _MANIFEST),
        ("GET", _TOKEN),
        ("HEAD", _MANIFEST),
    ]
    erste, _, zweite = (kopf for _, _, kopf in aufrufe)
    assert "application/vnd.oci.image.index.v1+json" in erste["Accept"]
    assert "application/vnd.docker.distribution.manifest.list.v2+json" in erste["Accept"]
    assert "Authorization" not in erste
    assert zweite["Authorization"] == "Bearer geheim"
    assert zweite["Accept"] == erste["Accept"]


def test_der_digest_kommt_ohne_token_wenn_die_registry_keins_verlangt(monkeypatch):
    url = "https://quay.io/v2/keycloak/keycloak/manifests/26.8.0"
    aufrufe = _registry(
        monkeypatch, {("HEAD", url): [_Antwort({"Docker-Content-Digest": "sha256:dd"})]}
    )

    assert gov.digest_in_der_registry("quay.io/keycloak/keycloak:26.8.0") == "sha256:dd"
    assert len(aufrufe) == 1


@pytest.mark.parametrize(
    "antworten",
    [
        pytest.param({("HEAD", _MANIFEST): [_abgewiesen(_MANIFEST, 404)]}, id="tag-unbekannt"),
        pytest.param({("HEAD", _MANIFEST): [OSError("kein Netz")]}, id="kein-netz"),
        pytest.param(
            {("HEAD", _MANIFEST): [http.client.BadStatusLine("x")]}, id="antwort-unlesbar"
        ),
        pytest.param({("HEAD", _MANIFEST): [_Antwort({})]}, id="antwort-ohne-digest"),
        pytest.param({("HEAD", _MANIFEST): [_abgewiesen(_MANIFEST)]}, id="abgewiesen-ohne-verweis"),
        pytest.param(
            {
                ("HEAD", _MANIFEST): [_abgewiesen(_MANIFEST, verweis=_VERWEIS)],
                ("GET", _TOKEN): [_Antwort(inhalt=b"{}")],
            },
            id="antwort-ohne-token",
        ),
        pytest.param(
            {
                ("HEAD", _MANIFEST): [_abgewiesen(_MANIFEST, verweis=_VERWEIS)],
                ("GET", _TOKEN): [ValueError("nur https")],
            },
            id="token-stelle-ohne-https",
        ),
    ],
)
def test_ohne_auskunft_der_registry_bleibt_der_stand_offen(monkeypatch, antworten):
    """Der Bericht sagt dann „nicht geprüft“ — er rät nicht und bricht nicht ab."""
    _registry(monkeypatch, antworten)
    assert gov.digest_in_der_registry("docker.io/library/python:3.14.8-slim") is None

    _registry(monkeypatch, antworten)
    assert gov.basis_ist_aktuell("docker.io/library/python:3.14.8-slim@sha256:cc") is None


def test_ein_name_ohne_registry_wird_nicht_abgefragt(monkeypatch):
    """Wohin ein Kurzname führt, entscheidet die Engine — der Generator rät keine Registry."""
    aufrufe = _registry(monkeypatch, {})

    assert gov.digest_in_der_registry("python:3.14.8-slim") is None
    assert gov.digest_in_der_registry("aquasec/trivy:0.75.0") is None
    assert gov.digest_in_der_registry("docker.io/library/python") is None
    assert aufrufe == []


def test_der_abruf_geht_nur_ueber_https():
    """Die Stelle für das Token nennt die Registry selbst. Verwiese sie auf http oder eine
    Datei, fragte der Generator dort nicht an."""
    for url in ("http://auth.example/token", "file:///etc/passwd", "ftp://x/y"):
        with pytest.raises(ValueError, match="nur https"):
            gov._https(url, {})


def test_der_befehl_digest_nennt_den_digest_oder_bricht_ab(monkeypatch, capsys):
    """Der Weg, einen Pin anzuheben, ohne ein Werkzeug der Engine (RUNBOOK 2 und 5b). Ohne
    Auskunft der Registry endet der Aufruf mit einem Fehler statt mit einer leeren Zeile."""
    antworten = {"docker.io/library/postgres:18-alpine": "sha256:ff"}
    monkeypatch.setattr(gov, "digest_in_der_registry", antworten.get)

    monkeypatch.setattr(
        sys, "argv", ["governance.py", "digest", "docker.io/library/postgres:18-alpine"]
    )
    assert gov.main() == 0
    assert capsys.readouterr().out == "sha256:ff\n"

    for argumente in (["digest", "postgres:18-alpine"], ["digest"]):
        monkeypatch.setattr(sys, "argv", ["governance.py", *argumente])
        with pytest.raises(SystemExit, match="FEHLER: Kein Digest"):
            gov.main()


@pytest.mark.parametrize(
    ("basis", "heute", "erwartet"),
    [
        ("docker.io/library/python:3.14.8-slim@sha256:cc", "sha256:cc", True),
        ("docker.io/library/python:3.14.8-slim@sha256:cc", "sha256:ee", False),
        ("docker.io/library/python:3.14.8-slim@sha256:cc", None, None),
        ("docker.io/library/python:3.14.8-slim", "sha256:cc", None),
    ],
)
def test_das_basis_image_gilt_als_aktuell_wenn_die_registry_denselben_digest_fuehrt(
    monkeypatch, basis, heute, erwartet
):
    gefragt: list[str] = []
    monkeypatch.setattr(gov, "digest_in_der_registry", lambda image: gefragt.append(image) or heute)

    assert gov.basis_ist_aktuell(basis) is erwartet
    assert gefragt == ["docker.io/library/python:3.14.8-slim"]
