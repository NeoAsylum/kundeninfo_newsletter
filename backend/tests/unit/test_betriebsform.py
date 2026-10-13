"""PostgreSQL läuft auch in PROD als Container (ADR-0030): Jeder Compose-Aufruf in Makefile
und make.ps1 muss das DB-Overlay laden — ohne es startet die API ohne Datenbank."""

import os
import pathlib
import re
import shutil
import subprocess
import sys
from itertools import pairwise

import pytest

REPO = pathlib.Path(__file__).resolve().parents[3]

# „-f compose.yaml“ im Makefile ebenso wie „"-f", "compose.yaml"“ in make.ps1
_DATEIANGABE = r"""-f["']?,?\s+["']?compose"""
_ZEICHENKETTE = r"""('[^']*'|"[^"]*")"""
_AUFRUF = r"\bdocker\s+compose\b"
# Eine Scan-Zeile, die ausgeführt wird und den Lauf bei einem Fund abbricht: kein „-“ davor
# (make überginge den Fehler), --exit-code 1, dahinter kein Befehl außer Fail-IfError (make.ps1)
_SCAN = re.compile(
    r"\s+@?trivy image (?=[^;|&]*--exit-code[ =]1\b)[^;|&]*?\b(stoerungsinfo-[\w-]+):[^;|&]*?"
    r"(; Fail-IfError)?\s*"
)


def _zeilen(datei: str) -> list[str]:
    """Die Zeilen ohne ihre Kommentare, im Makefile mit zusammengezogenen Fortsetzungen:
    Auskommentiertes wird nicht ausgeführt und zählt deshalb nicht."""
    text = (REPO / datei).read_bytes().decode("utf-8").replace("\\\n", " ")
    kommentar = rf"{_ZEICHENKETTE}|(?:^|(?<=\s))#.*"
    return [re.sub(kommentar, lambda m: m.group(1) or "", z) for z in text.splitlines()]


def _dateilisten(zeilen: list[str]) -> list[str]:
    """Die Zeilen, die Compose-Dateien nennen — gleich unter welchem Namen und ob in einer
    Zuweisung oder im Aufruf selbst. Jede muss das DB-Overlay nennen."""
    listen = [z for z in zeilen if re.search(_DATEIANGABE, z)]
    assert len(listen) >= 2, "Dateiangaben für DEV und PROD nicht gefunden"
    for liste in listen:
        assert re.search(_DATEIANGABE + r"\.db\.yaml\b", liste), liste.strip()
    return listen


def _aufrufe(zeilen: list[str]) -> list[str]:
    """Die Zeilen mit „docker compose“ außerhalb von Zeichenketten — die Worte in einem echo
    sind kein Aufruf."""
    aufrufe = [z for z in zeilen if re.search(_AUFRUF, re.sub(_ZEICHENKETTE, "", z))]
    assert aufrufe, "kein Compose-Aufruf gefunden"
    return aufrufe


def test_jeder_compose_aufruf_im_makefile_laedt_das_db_overlay():
    zeilen = _zeilen("Makefile")
    listen = _dateilisten(zeilen)
    # Ein Aufruf ohne Dateiangabe lüde nur compose.yaml
    assert [z.strip() for z in _aufrufe(zeilen) if z not in listen] == []
    makefile = (REPO / "Makefile").read_text("utf-8")
    assert re.search(r"^prod-localdb: prod\b", makefile, re.M), "prod-localdb muss prod auslösen"


def test_jeder_compose_aufruf_in_make_ps1_laedt_das_db_overlay():
    skript = (REPO / "make.ps1").read_bytes()
    assert skript.count(b"\r\n") == skript.count(b"\n"), "make.ps1 braucht CRLF (.gitattributes)"
    zeilen = _zeilen("make.ps1")
    listen = _dateilisten(zeilen)
    namen = {n.lower() for z in listen for n in re.findall(r"^\s*\$(\w+)\s*=", z)}
    # Jeder Aufruf nimmt seine Dateien aus einer dieser Listen oder nennt sie selbst
    for aufruf in _aufrufe(zeilen):
        liste = re.search(_AUFRUF + r"\s+@(\w+)", aufruf)
        assert aufruf in listen or (liste and liste.group(1).lower() in namen), aufruf.strip()
    alias = r'"prod-localdb" \{[^}]*& \$PSCommandPath prod\s*\}'
    assert re.search(alias, skript.decode("utf-8")), "prod-localdb muss prod auslösen"


def test_der_image_scan_erfasst_auch_das_datenbank_image():
    """Das Release-Gate muss jedes Image sehen, das `make prod` baut — seit ADR-0030 auch das
    der Datenbank. Welche das sind, steht in den Compose-Dateien."""
    gebaut: set[str] = set()
    for datei in ("compose.yaml", "compose.db.yaml", "compose.prod.yaml"):
        compose = (REPO / datei).read_text("utf-8")
        gebaut.update(re.findall(r"^\s+image: (stoerungsinfo-[\w-]+):", compose, re.M))
    assert "stoerungsinfo-postgres" in gebaut
    for datei in ("Makefile", "make.ps1"):
        zeilen = [z for z in _zeilen(datei) if z.strip()]
        scans = {nr: scan for nr, z in enumerate(zeilen) if (scan := _SCAN.fullmatch(z))}
        assert {scan.group(1) for scan in scans.values()} == gebaut, datei
        if datei == "make.ps1":
            # PowerShell bricht nach einem roten Scan nicht von selbst ab. Ohne Fail-IfError
            # zählt nur der letzte Befehl des Zweigs: Sein Ergebnis gibt das Skript zurück.
            for nr, scan in scans.items():
                danach = "".join(zeilen[nr + 1 : nr + 2]).strip()
                assert scan.group(2) or danach == "}", zeilen[nr].strip()


def _dienst(datei: str, name: str) -> str | None:
    """Der Block eines Dienstes aus einer Compose-Datei — None, wenn sie ihn nicht nennt."""
    text = (REPO / datei).read_text("utf-8")
    block = re.search(rf"^  {name}:\n(.*?)(?=^  \S|\Z)", text, re.M | re.S)
    return block.group(1) if block else None


def _postgres_befehl(datei: str) -> list[str] | None:
    """Die command-Liste des Dienstes postgres — None, wenn die Datei keine setzt."""
    dienst = _dienst(datei, "postgres") or ""
    befehl = re.search(r"^    command:(.*)\n((?:      .*\n)*)", dienst + "\n", re.M)
    if befehl is None:
        return None
    in_der_zeile = re.split(r"[\[\],\s]+", re.sub(r"\s#.*", "", befehl.group(1)))
    eintraege = re.findall(r"^ +- (\S+)", befehl.group(2), re.M) or in_der_zeile
    return [e.strip("\"'") for e in eintraege if e.strip("\"'")]


def test_postgres_schreibt_in_keiner_betriebsform_detail_oder_statement_zeilen_ins_log():
    """ADR-0014 gilt auch für das Log des Datenbank-Containers: Ohne die beiden Angaben nennt
    PostgreSQL bei einem Unique-Verstoß die Adresse (DETAIL-Zeile) und wiederholt
    fehlgeschlagenes SQL samt seinen Literalen (STATEMENT-Zeile). Ein Overlay mit eigener
    command-Liste ersetzt die aus compose.db.yaml und muss die Angaben deshalb wiederholen."""
    befehle = {d.name: _postgres_befehl(d.name) for d in sorted(REPO.glob("compose*.yaml"))}
    assert befehle.get("compose.db.yaml"), "compose.db.yaml: command für postgres fehlt"
    for datei, befehl in befehle.items():
        for angabe in ("log_error_verbosity=terse", "log_min_error_statement=panic"):
            assert befehl is None or ("-c", angabe) in pairwise(befehl), f"{datei}: {angabe}"


def test_der_datenbank_container_hat_in_prod_eine_log_rotation():
    """Wie nginx und api: Ohne die Angabe wächst das json-file-Log des Containers unbegrenzt."""
    dienst = _dienst("compose.prod.yaml", "postgres")
    assert dienst is not None, "Dienst postgres fehlt in compose.prod.yaml"
    assert re.search(r"^    logging: \*logrotate\s*$", dienst, re.M)


def test_postgres_ist_per_digest_gepinnt_und_die_test_db_nutzt_denselben_stand():
    """Wie nginx, python und keycloak (ADR-0008). Die Tests sollen gegen die Version laufen,
    die ausgeliefert wird — sonst prüfen sie einen anderen Stand als den der VM."""
    muster = r"postgres:18-alpine@(sha256:[0-9a-f]{64})"
    dockerfile = (REPO / "deploy" / "postgres" / "Dockerfile").read_text("utf-8")
    dev = (REPO / "compose.dev.yaml").read_text("utf-8")
    im_image = re.findall(rf"^FROM {muster}\s*$", dockerfile, re.M)
    in_tests = re.findall(rf"^\s+image: {muster}\s*$", dev, re.M)
    assert len(im_image) == 1, "deploy/postgres/Dockerfile: FROM ohne Digest"
    assert in_tests == im_image


def _ohne_kommentare(yaml: str) -> str:
    return re.sub(r"(?m)(?:^|(?<=\s))#.*$", "", yaml)


def _eintraege(dienst: str, schluessel: str) -> list[str]:
    """Die Listeneinträge unter einem Schlüssel des Dienstes, in der Kurzform „- eintrag“."""
    liste = re.search(rf"^    {schluessel}:[ \t]*\n((?:      .*\n)*)", dienst + "\n", re.M)
    return re.findall(r"^      - [\"']?([^\s\"']+)", liste.group(1), re.M) if liste else []


def test_das_datenbank_volume_liegt_dort_wo_das_image_es_erwartet():
    """Ab PostgreSQL 18 erwartet das Image sein Volume unter /var/lib/postgresql und legt das
    Datenverzeichnis darin unter <major>/docker an. Mit einem Mount am alten Ort
    (/var/lib/postgresql/data) bricht der Server beim Start ab — auch die Test-DB, und auch
    dann, wenn erst ein Overlay den Mount beisteuert (Compose führt die Listen zusammen).
    Das alte Volume db_data hält den Bestand von PostgreSQL 16: Es darf an keinem
    Datenbank-Dienst hängen, auch nicht unter dem Schlüssel pg_data."""
    dienste: dict[str, str] = {}
    pg_data: dict[str, str | None] = {}
    for datei in sorted(REPO.glob("compose*.yaml")):
        text = _ohne_kommentare(datei.read_text("utf-8")) + "\n"
        # Jeder Dienst, dessen Name mit postgres beginnt — bis zum nächsten Dienst oder Abschnitt
        for dienst in re.finditer(
            r"^  (postgres[\w-]*):[ \t]*\n(.*?)(?=^ {0,2}\S|\Z)", text, re.M | re.S
        ):
            dienste[f"{datei.name}: {dienst.group(1)}"] = dienst.group(2)
        abschnitt = re.search(r"^volumes:[ \t]*\n((?:[ \t].*\n|\n)*)", text, re.M)
        volumes = abschnitt.group(1) if abschnitt else ""
        angaben = re.search(r"^  pg_data:(.*\n(?:   .*\n)*)", volumes, re.M)
        pg_data[datei.name] = angaben.group(1).strip() if angaben else None

    for ort, dienst in dienste.items():
        assert "/var/lib/postgresql/data" not in dienst, ort
        assert "PGDATA" not in dienst, ort
        assert not re.search(r"(?<![\w-])db_data\b", dienst), ort
    # Verglichen wird das Ziel, nicht die ganze Liste: Ein zweites Volume oder eine Option am
    # tmpfs ändert nichts daran, wo das Datenverzeichnis liegt.
    db = _eintraege(dienste["compose.db.yaml: postgres"], "volumes")
    assert "pg_data:/var/lib/postgresql" in [":".join(e.split(":")[:2]) for e in db]
    test_db = _eintraege(dienste["compose.dev.yaml: postgres-test"], "tmpfs")
    assert "/var/lib/postgresql" in [e.split(":")[0] for e in test_db]
    # Unter „volumes:“ steht pg_data ohne Angaben: name: oder external: hängten ein anderes
    # Volume darunter, etwa das alte. Das gilt auch für ein Overlay, das es noch einmal nennt.
    assert pg_data["compose.db.yaml"] == ""
    assert set(pg_data.values()) <= {"", None}


# ---------- deploy/vm/pg-umzug-sperre.sh: kein Start mit leerer Datenbank ----------

SPERRE = REPO / "deploy" / "vm" / "pg-umzug-sperre.sh"
# Wie die Aufrufer: unter „set -euo pipefail“ und mit „|| exit 1“. Die docker-Attrappe steht
# vorn im PATH; „cd … && pwd“ macht aus ihrem Verzeichnis auch unter Git Bash einen Pfad der
# Shell.
SPERRE_AUFRUF = """set -euo pipefail
PATH="$(cd "$1" && pwd):$PATH"
. "$2"
pg_umzug_sperre || exit 1
echo weiter
"""
# Kennt genau ein Volume: das aus der Umgebung (leer = keins)
DOCKER_ATTRAPPE = """#!/bin/sh
[ "$*" = "volume inspect $VORHANDENES_VOLUME" ]
"""


def _altes_volume() -> str:
    """So heißt das Volume db_data im Compose-Projekt: <name aus compose.yaml>_db_data."""
    projekt = re.findall(r"^name: (\S+)\s*$", (REPO / "compose.yaml").read_text("utf-8"), re.M)
    assert len(projekt) == 1, "compose.yaml: Projektname (name:) nicht gefunden"
    return f"{projekt[0]}_db_data"


def _bash() -> str | None:
    """Unter Windows nur eine Git Bash: C:\\Windows\\System32\\bash.exe startet WSL und sähe
    weder die Attrappe noch das Arbeitsverzeichnis. Überall sonst die bash des Systems."""
    if sys.platform != "win32":
        return "bash"
    git = shutil.which("git")
    # git.exe liegt je nach Aufruf in Git\cmd oder Git\mingw64\bin, die Bash in Git\bin
    wurzeln = list(pathlib.Path(git).parents[:3]) if git else []
    wurzeln.append(pathlib.Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Git")
    bashes = [wurzel / "bin" / "bash.exe" for wurzel in wurzeln]
    return next((str(bash) for bash in bashes if bash.is_file()), None)


@pytest.mark.skipif(_bash() is None, reason="keine Git Bash gefunden (die von WSL taugt nicht)")
@pytest.mark.parametrize(
    ("altes_volume", "env", "gesperrt"),
    [
        pytest.param(False, "SMTP_HOST=mailpit\n", False, id="frische-vm"),
        pytest.param(False, None, False, id="frische-vm-ohne-env"),
        pytest.param(True, "SMTP_HOST=mailpit\n", True, id="nicht-umgezogen"),
        pytest.param(True, None, True, id="nicht-umgezogen-ohne-env"),
        pytest.param(True, "SMTP_HOST=mailpit\nPG_UMZUG_ERLEDIGT=1\n", False, id="umgezogen"),
        pytest.param(True, "PG_UMZUG_ERLEDIGT=0\n", True, id="marke-0"),
        pytest.param(True, "# PG_UMZUG_ERLEDIGT=1\n", True, id="marke-auskommentiert"),
        pytest.param(True, "PG_UMZUG_ERLEDIGT=1 nach dem Vergleich\n", True, id="marke-mit-text"),
        pytest.param(True, "PG_UMZUG_ERLEDIGT=10\n", True, id="marke-10"),
    ],
)
def test_sperre_bricht_ab_solange_der_alte_bestand_nicht_umgezogen_ist(
    tmp_path, altes_volume, env, gesperrt
):
    """Seit PostgreSQL 18 liegt der Bestand in einem neuen Volume. Solange das alte noch da
    ist, legte ein Start einen leeren Cluster an, und das Portal liefe ohne Konten und Historie
    — bei offener Registrierung. Die Sperre gibt den Start erst frei, wenn in der .env des
    Arbeitsverzeichnisses genau die Zeile PG_UMZUG_ERLEDIGT=1 steht; sonst beendet sie den
    Lauf mit einer Meldung auf der Fehlerausgabe. Ohne altes Volume greift sie nicht."""
    attrappen, arbeitsverzeichnis = tmp_path / "bin", tmp_path / "repo"
    attrappen.mkdir()
    arbeitsverzeichnis.mkdir()
    (attrappen / "docker").write_text(DOCKER_ATTRAPPE, encoding="utf-8", newline="\n")
    (attrappen / "docker").chmod(0o755)
    if env is not None:
        (arbeitsverzeichnis / ".env").write_text(env, encoding="utf-8", newline="\n")
    # Vorhanden ist höchstens das alte Volume DIESES Compose-Projekts: Fragte die Sperre nach
    # einem anderen Namen, gäbe sie den Start frei.
    vorhanden = _altes_volume() if altes_volume else ""

    lauf = subprocess.run(
        [_bash(), "-c", SPERRE_AUFRUF, "sperre", attrappen.as_posix(), SPERRE.as_posix()],
        cwd=arbeitsverzeichnis,
        env={**os.environ, "VORHANDENES_VOLUME": vorhanden},
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    if gesperrt:
        assert (lauf.returncode, lauf.stdout) == (1, "")
        assert lauf.stderr.startswith("ABBRUCH: ")
    else:
        assert (lauf.returncode, lauf.stdout, lauf.stderr) == (0, "weiter\n", "")


def _shell_zeilen(skript: str) -> list[str]:
    """Was die Shell ausführt: die Zeilen ohne Kommentare und ohne den Inhalt der Zeichenketten,
    in denen nichts ausgeführt wird (kein „$(“, kein Backtick)."""

    def nur_ausgefuehrtes(kette: re.Match[str]) -> str:
        text = kette.group(0)
        return text if text[0] == '"' and re.search(r"\$\(|`", text) else text[0] * 2

    zeilen = [re.sub(_ZEICHENKETTE, nur_ausgefuehrtes, z) for z in skript.splitlines()]
    return [re.sub(r"(?:^|(?<=\s))#.*", "", z) for z in zeilen]


_EINGEBUNDEN = re.compile(r"""\s*(?:\.|source)\s+["']?\S*/pg-umzug-sperre\.sh["']?\s*""")
_SCHREIBT_ENV = re.compile(
    r">>?\s*\.env\b|\b(?:sed -i|install|chmod|cp|mv|rm|tee|touch)\b.*\.env\b"
)
# $COMPOSE, ausgeschrieben — oder ein Befehl aus irgendeiner anderen Variable am Zeilenanfang
_COMPOSE_AUFRUF = re.compile(r"\$\{?COMPOSE\b|\bdocker[\s-]+compose\b|^\s*\$\{?\w")
_BLOCK_AUF = re.compile(r"(?<![\w-])(?:if|case|for|while|until)(?![\w-])")
_BLOCK_ZU = re.compile(r"(?<![\w-])(?:fi|esac|done)(?![\w-])")


def _startet_den_stack(zeilen: list[str]) -> bool:
    return any(_COMPOSE_AUFRUF.search(z) and re.search(r"\bup\b", z) for z in zeilen)


def test_die_vm_skripte_rufen_die_sperre_auf_bevor_sie_etwas_aendern_oder_starten():
    """Ein abgebrochener Lauf soll nichts verändert haben. In deploy.sh steht die Sperre
    deshalb vor dem ersten Schreiben in die .env und vor jedem Compose-Aufruf — gleich ob als
    $COMPOSE, ausgeschrieben oder über eine andere Variable —, in demo-mode.sh im Zweig
    „start“ vor dessen erstem, in update-cloudflare-ranges.sh vor dem Abruf der Listen. Sie
    steht in keinem if/case/for, das sie überspringen könnte, und beendet den Lauf selbst."""
    vm = REPO / "deploy" / "vm"
    deploy = (vm / "deploy.sh").read_text("utf-8")
    demo = (vm / "demo-mode.sh").read_text("utf-8")
    bereiche = (vm / "update-cloudflare-ranges.sh").read_text("utf-8")
    # Kein weiteres Skript der VM startet den Stack an der Sperre vorbei. pg-umzug.sh ist der
    # Umzug selbst: Es startet nur die Datenbank und gibt die Sperre am Ende frei.
    starter = {
        s.name for s in vm.glob("*.sh") if _startet_den_stack(_shell_zeilen(s.read_text("utf-8")))
    }
    assert starter == {"deploy.sh", "demo-mode.sh", "update-cloudflare-ranges.sh", "pg-umzug.sh"}
    # Was „demo-mode.sh start“ der Reihe nach ausführt: alles vor dem case, dann der Zweig
    vor_case, case, zweige = demo.partition('\ncase "$ACTION" in\n')
    start = re.search(r"^ *start\)\n(.*?)^ *;;$", zweige, re.M | re.S)
    assert case and start, "demo-mode.sh: Zweig start nicht gefunden"
    ablaeufe = {
        "deploy.sh": deploy,
        "demo-mode.sh start": f"{vor_case}\n{start.group(1)}",
        "update-cloudflare-ranges.sh": bereiche,
    }

    for name, ablauf in ablaeufe.items():
        zeilen = _shell_zeilen(ablauf)
        aufrufe = [nr for nr, zeile in enumerate(zeilen) if "pg_umzug_sperre" in zeile]
        assert [zeilen[nr].strip() for nr in aufrufe] == ["pg_umzug_sperre || exit 1"], name
        davor, danach = zeilen[: aufrufe[0]], zeilen[aufrufe[0] + 1 :]
        # Der Pfad steht in einer Zeichenkette — deshalb in den unveränderten Zeilen suchen
        eingebunden = [z for z in ablauf.splitlines()[: aufrufe[0]] if _EINGEBUNDEN.fullmatch(z)]
        assert len(eingebunden) == 1, f"{name}: pg-umzug-sperre.sh vor dem Aufruf nicht eingebunden"
        zu_frueh = [z for z in davor if _SCHREIBT_ENV.search(z) or _COMPOSE_AUFRUF.search(z)]
        assert zu_frueh == [], name
        offen = sum(len(_BLOCK_AUF.findall(z)) - len(_BLOCK_ZU.findall(z)) for z in davor)
        assert offen == 0, f"{name}: Die Sperre steht in einem Block, der sie überspringen kann"
        # Gegenprobe: Dieselben Muster finden danach den Start …
        assert _startet_den_stack(danach), name
    # … und in deploy.sh das Schreiben der .env
    assert any(_SCHREIBT_ENV.search(z) for z in _shell_zeilen(deploy))


def test_die_sperre_prueft_das_alte_volume_dieses_compose_projekts():
    """Der Name des Volumes steht fest im Skript. Hieße das Projekt in compose.yaml anders,
    fragte die Sperre nach einem Volume, das es nie gab — und gäbe jeden Start frei."""
    sperre = "\n".join(_shell_zeilen(SPERRE.read_text("utf-8")))
    assert re.findall(r"\bdocker volume inspect (\S+)", sperre) == [_altes_volume()]


def test_der_umzug_schreibt_genau_die_marke_auf_die_die_sperre_wartet():
    """pg-umzug.sh gibt den Start frei, indem es am Ende eine Zeile in die .env schreibt; die
    Sperre sucht genau diese Zeile. Wichen beide voneinander ab, bliebe die VM nach einem
    gelungenen Umzug gesperrt."""
    umzug = (REPO / "deploy" / "vm" / "pg-umzug.sh").read_text("utf-8")
    gesucht = re.findall(r"grep -qs '\^(\S+)\$' \.env", SPERRE.read_text("utf-8"))
    geschrieben = re.findall(r"^printf '.*\\n(\w+=\w+)\\n' .*>> \.env$", umzug, re.M)

    assert len(gesucht) == 1
    assert geschrieben == gesucht
    # Das Skript selbst erkennt den erledigten Umzug an derselben Zeile.
    assert re.findall(r"grep -qs '\^(\S+)\$' \.env", umzug) == gesucht


# ---------- ops/backup.sh: ein Dump, dem eine Datenbank fehlt, ist kein Backup ----------

BACKUP_AUFRUF = """PATH="$(cd "$1" && pwd):$PATH"
sh "$2"
"""
# Beantwortet, was backup.sh fragt. Der Dump ist so groß, dass die Größenprüfung des Skripts
# ihn nicht schon verwirft (Zufallsdaten: gzip macht sie nicht klein).
BACKUP_ATTRAPPE = """#!/bin/sh
case "$*" in
    *"ps --quiet postgres"*) echo abc123 ;;
    *"FROM pg_database"*) [ -z "$ABFRAGE_SCHEITERT" ] || exit 1; echo 1 ;;
    *"pg_dump -U postgres "*)
        for db; do :; done
        echo "-- PostgreSQL database dump"
        head -c 6000 /dev/urandom | base64
        [ "$db" != "$BRICHT_AB" ] || exit 1
        echo "-- PostgreSQL database dump complete"
        ;;
    *) echo "unerwarteter Aufruf: $*" >&2; exit 64 ;;
esac
"""


@pytest.mark.skipif(_bash() is None, reason="keine Git Bash gefunden (die von WSL taugt nicht)")
@pytest.mark.parametrize(
    ("bricht_ab", "abfrage_scheitert", "meldung"),
    [
        pytest.param("", "", "", id="beide-vollstaendig"),
        pytest.param("keycloak", "", "1 von 2 Datenbanken", id="keycloak-bricht-ab"),
        pytest.param("newsletter", "", "0 von 2 Datenbanken", id="newsletter-bricht-ab"),
        pytest.param("", "1", None, id="abfrage-nach-keycloak-scheitert"),
    ],
)
def test_backup_verwirft_einen_dump_dem_eine_datenbank_fehlt(
    tmp_path, bricht_ab, abfrage_scheitert, meldung
):
    """Der Exit-Status der Dump-Pipeline ist nur der von gzip. Bräche pg_dump für eine
    Datenbank ab — oder scheiterte schon die Frage, ob es keycloak gibt —, läge sonst ein
    Backup da, dem die Konten fehlen, und das Skript meldete „Backup OK“."""
    attrappen, repo, ziel = tmp_path / "bin", tmp_path / "repo", tmp_path / "ziel"
    for ordner in (attrappen, repo, ziel):
        ordner.mkdir()
    (attrappen / "docker").write_text(BACKUP_ATTRAPPE, encoding="utf-8", newline="\n")
    (attrappen / "docker").chmod(0o755)
    (repo / "compose.public.yaml").write_text("", encoding="utf-8")
    (repo / ".env").write_text("DB_NAME=newsletter\n", encoding="utf-8", newline="\n")
    skript = REPO / "ops" / "backup.sh"

    lauf = subprocess.run(
        [_bash(), "-c", BACKUP_AUFRUF, "backup", attrappen.as_posix(), skript.as_posix()],
        env={
            **os.environ,
            "REPO_DIR": repo.as_posix(),
            "BACKUP_DIR": ziel.as_posix(),
            "BRICHT_AB": bricht_ab,
            "ABFRAGE_SCHEITERT": abfrage_scheitert,
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    backups = [datei.name for datei in ziel.iterdir()]
    if meldung == "":
        assert lauf.returncode == 0, lauf.stderr
        assert "Sichere Datenbanken: newsletter keycloak" in lauf.stdout
        assert "Backup OK" in lauf.stdout
        assert len(backups) == 1
    else:
        assert lauf.returncode != 0
        assert "Backup OK" not in lauf.stdout
        assert backups == []
        if meldung is not None:
            assert f"FEHLER: Dump unvollständig ({meldung})" in lauf.stderr
