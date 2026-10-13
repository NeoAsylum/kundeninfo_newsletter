"""Die Dateien der Lieferkette passen zueinander (ADR-0026, ADR-0028, ADR-0029).

requirements.txt nennt die direkten Abhängigkeiten, requirements.lock ist das, was das Image
installiert, die SBOM das, was der Governance-Prüfung vorliegt. Das Lockfile liest sonst nur
der Dockerfile: Wer eine der drei Dateien ändert und die anderen vergisst, merkt es ohne
diese Tests nicht. Dasselbe gilt für das Testwerkzeug des Frontends, das kein Image
erreichen darf, und für den Realm, der zu den Scopes der Anwendung passen muss.
"""

import json
import pathlib
import re

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version

from app.core.config import Settings

REPO = pathlib.Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"
FRONTEND_TESTS = REPO / "frontend" / "tests"
LOCK = (BACKEND / "requirements.lock").read_text(encoding="utf-8")


def _lock() -> dict[str, Version]:
    pins = re.findall(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)", LOCK, re.M)
    return {canonicalize_name(name): Version(version) for name, version in pins}


def test_lockfile_erfuellt_jede_direkte_abhaengigkeit():
    lock = _lock()
    direkt = [
        Requirement(zeile)
        for zeile in (BACKEND / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if zeile.strip() and not zeile.startswith("#")
    ]
    assert len(direkt) >= 10
    for anforderung in direkt:
        name = canonicalize_name(anforderung.name)
        assert name in lock, f"{anforderung.name} fehlt im Lockfile — neu erzeugen (RUNBOOK 5b)"
        assert lock[name] in anforderung.specifier, (
            f"{anforderung.name}: Lockfile pinnt {lock[name]}, verlangt ist {anforderung.specifier}"
        )


def test_jeder_lock_eintrag_ist_gehasht():
    """Der Container installiert mit --require-hashes; ein Eintrag ohne Hash bräche den Build."""
    eintraege = re.split(r"\n(?=[A-Za-z0-9_.-]+==)", LOCK)[1:]
    assert len(eintraege) == len(_lock())
    assert all("--hash=sha256:" in eintrag for eintrag in eintraege)


def test_sbom_beschreibt_genau_das_lockfile():
    sbom = json.loads(
        (REPO / "docs" / "governance" / "stoerungsinfo-app.cdx.json").read_text(encoding="utf-8")
    )
    werkzeug = {"name": "scope", "value": "build-tool"}  # pip: im Image, aber kein Lock-Eintrag
    komponenten = {
        canonicalize_name(k["name"]): Version(k["version"])
        for k in sbom["components"]
        if werkzeug not in k.get("properties", [])
    }
    assert komponenten == _lock(), "SBOM und Lockfile laufen auseinander — RUNBOOK 5b"


def test_python_version_ist_im_image_in_der_ci_und_in_der_sbom_dieselbe():
    """ci.yml verspricht „Python wie im Image“, und die SBOM nennt das Basis-Image. Wer im
    Dockerfile Version und Digest anhebt, ließe die CI sonst still auf der alten Version
    weiterlaufen und die SBOM ein Image nennen, das nicht mehr gebaut wird."""
    dockerfile = (BACKEND / "Dockerfile").read_text(encoding="utf-8")
    im_image = re.findall(r"^FROM python:(\d+\.\d+\.\d+)-slim@sha256:", dockerfile, re.M)
    assert len(im_image) == 1, "backend/Dockerfile: FROM python:X.Y.Z-slim@sha256:… erwartet"

    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    in_der_ci = re.findall(r"""^\s+python-version:\s*["']?([^\s"'#]+)""", ci, re.M)
    assert len(in_der_ci) == ci.count("actions/setup-python@") >= 2
    assert set(in_der_ci) == set(im_image)

    sbom = json.loads(
        (REPO / "docs" / "governance" / "stoerungsinfo-app.cdx.json").read_text(encoding="utf-8")
    )
    angaben = sbom["metadata"]["properties"]
    basis = [angabe["value"] for angabe in angaben if angabe["name"] == "runtime:base-image"]
    assert basis == [f"python:{im_image[0]}-slim"]


def test_frontend_testwerkzeug_ist_exakt_und_mit_pruefsumme_gepinnt():
    paket = json.loads((FRONTEND_TESTS / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((FRONTEND_TESTS / "package-lock.json").read_text(encoding="utf-8"))
    assert paket.get("dependencies", {}) == {}, "Laufzeit-Abhängigkeiten gibt es hier nicht"
    (name, version), *weitere = paket["devDependencies"].items()
    assert (name, weitere) == ("@playwright/test", []), "ein Werkzeug, mehr nicht (ADR-0029)"
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), "exakte Version, kein ^ oder ~"
    pakete = {pfad: eintrag for pfad, eintrag in lock["packages"].items() if pfad}
    assert pakete["node_modules/@playwright/test"]["version"] == version
    for pfad, eintrag in pakete.items():
        assert eintrag["integrity"].startswith("sha512-"), pfad
        assert eintrag["resolved"].startswith("https://registry.npmjs.org/"), pfad
        assert not eintrag.get("hasInstallScript"), f"{pfad} bringt ein Install-Skript mit"


def test_testwerkzeug_erreicht_kein_image():
    """Zwei Sperren: Der Docker-Kontext lässt frontend/tests und node_modules weg, und die
    NGINX-Images kopieren vom Frontend ausschließlich frontend/public."""
    ignoriert = (REPO / ".dockerignore").read_text(encoding="utf-8").split()
    assert {"frontend/tests", "**/node_modules"} <= set(ignoriert)
    dockerfiles = sorted((REPO / "deploy" / "nginx").glob("Dockerfile*"))
    assert len(dockerfiles) == 2
    for dockerfile in dockerfiles:
        quellen = re.findall(r"^COPY\s+(\S+)", dockerfile.read_text(encoding="utf-8"), re.M)
        frontend = [quelle for quelle in quellen if not quelle.startswith("deploy/nginx/")]
        assert frontend == ["frontend/public/"], f"{dockerfile.name}: {quellen}"


def test_realm_kennt_nur_email_und_passwort_und_passt_zur_anwendung():
    """ADR-0028: Der Realm erhebt keine Namen und gibt dem Client den Scope `profile` nicht
    mit. Was die Anwendung von sich aus anfordert, muss der Client dagegen bekommen —
    sonst antwortet Keycloak mit invalid_scope und niemand kann sich anmelden."""
    realm = json.loads(
        (REPO / "deploy" / "keycloak" / "realm-dev.json").read_text(encoding="utf-8")
    )
    (profil,) = realm["components"]["org.keycloak.userprofile.UserProfileProvider"]
    attribute = json.loads(profil["config"]["kc.user.profile.config"][0])["attributes"]
    assert [a["name"] for a in attribute] == ["username", "email"]

    (client,) = realm["clients"]
    scopes = set(client["defaultClientScopes"]) | set(client.get("optionalClientScopes", []))
    assert "profile" not in scopes
    angefordert = set(Settings.model_fields["oidc_scopes"].default.split()) - {"openid"}
    assert angefordert <= set(client["defaultClientScopes"])

    assert [u["username"] for u in realm["users"] if "firstName" in u or "lastName" in u] == []


def test_opentelemetry_bleibt_ohne_sdk_und_exporter():
    """FastAPI zieht seit 0.142 `opentelemetry-api` nach — für sich allein zeichnet das nichts
    auf und sendet nichts. Erst ein SDK oder Exporter im Image machte daraus eine Aufzeichnung
    jeder Anfrage samt Query-String (ADR-0014) und eine neue Verbindung nach außen."""
    otel = sorted(name for name in _lock() if name.startswith("opentelemetry"))
    assert otel == ["opentelemetry-api"]
