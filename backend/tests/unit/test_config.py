import pathlib
import re

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from tests.conftest import make_settings


def test_retention_leer_bedeutet_aus():
    s = make_settings(retention_days_recipients="", retention_days_audit="")
    assert s.retention_days_recipients is None
    assert s.retention_days_audit is None


def test_retry_backoff_wird_geparst():
    s = make_settings(worker_retry_backoff_s="60,300,900")
    assert s.retry_backoff == [60, 300, 900]


def test_session_secret_muss_lang_sein():
    with pytest.raises(ValidationError):
        make_settings(session_secret="zu-kurz")


@pytest.mark.parametrize(
    ("genannt", "werte"),
    [
        ("session_secret", {"session_secret": "nur-im-test-geheim"}),
        ("mail_redirect_to", {"mail_redirect_to": "eins@x.de, zwei@x.de"}),
        ("smtp_port", {"smtp_port": "nur-im-test-geheim"}),
        ("SMTP_AUTH_MODE", {"smtp_auth_mode": "login", "smtp_password": "nur-im-test-geheim"}),
    ],
)
def test_startfehler_nennt_das_feld_aber_nicht_den_wert(genannt, werte):
    """Ein Startfehler landet im Log des Containers. Dort gehört weder ein abgewiesenes
    Secret hin noch eine Adresse (ADR-0014) — pydantic hängt sonst jeden Wert an."""
    with pytest.raises(ValidationError) as fehler:
        make_settings(**werte)

    meldung = str(fehler.value)
    assert genannt in meldung
    assert "input_value" not in meldung
    assert "nur-im-test-geheim" not in meldung
    assert "@x.de" not in meldung


def test_smtp_login_erfordert_credentials():
    with pytest.raises(ValidationError):
        make_settings(smtp_auth_mode="login", smtp_user="", smtp_password="")
    s = make_settings(smtp_auth_mode="login", smtp_user="u", smtp_password="p")
    assert s.smtp_auth_mode == "login"


def test_cookie_secure_folgt_https():
    assert make_settings(public_base_url="https://portal.example").cookie_secure is True
    assert make_settings(public_base_url="http://localhost:8080").cookie_secure is False


def test_callback_url():
    s = make_settings(public_base_url="http://localhost:8080")
    assert s.callback_url == "http://localhost:8080/auth/callback"


def test_scopes_ohne_namen_als_standard():
    """Das Portal verarbeitet keine Namen — also fragt es `profile` nicht an (ADR-0028)."""
    assert make_settings().oidc_scopes == "openid email"


def test_scopes_muessen_openid_enthalten():
    with pytest.raises(ValidationError):
        make_settings(oidc_scopes="email profile")
    assert make_settings(oidc_scopes="  openid   profile email ").oidc_scopes == (
        "openid profile email"
    )


def test_check_smtp_liest_werte_in_anfuehrungszeichen(tmp_path, monkeypatch):
    """.env.example setzt Werte mit Leerzeichen in Anführungszeichen. check_smtp.py liest die
    .env selbst — und muss sie dann wie Shell und Docker Compose behandeln, sonst scheitert
    schon der Aufbau der Settings an `"openid`."""
    from scripts.check_smtp import _load_env

    datei = tmp_path / ".env"
    zeilen = [
        'OIDC_SCOPES="openid email"',
        "MAIL_FROM_NAME='Störungsinfo (Test)'",
        "SMTP_HOST=mailpit",
    ]
    datei.write_text("\n".join(zeilen), encoding="utf-8")
    umgebung: dict[str, str] = {}
    monkeypatch.setattr("os.environ", umgebung)
    _load_env(datei)
    assert umgebung == {
        "OIDC_SCOPES": "openid email",
        "MAIL_FROM_NAME": "Störungsinfo (Test)",
        "SMTP_HOST": "mailpit",
    }


def test_env_example_laesst_sich_mit_der_shell_einlesen():
    """deploy/vm/*.sh und ops/backup.sh lesen die .env per `. ./.env` ein. Ein Wert mit
    Leerzeichen, Klammern oder anderen Shell-Zeichen muss deshalb in Anführungszeichen
    stehen — `MAIL_FROM_NAME=Störungsinfo (DEV)` brach jedes dieser Skripte ab."""
    beispiel = pathlib.Path(__file__).resolve().parents[3] / ".env.example"
    ohne_quotes, in_quotes = r"[A-Za-z0-9_./:@,+%=-]*", r'"[^"$`\\]*"'
    zeilen = [z for z in beispiel.read_text("utf-8").splitlines() if z and not z.startswith("#")]
    assert len(zeilen) >= len(Settings.model_fields)
    for zeile in zeilen:
        name, gleich, wert = zeile.partition("=")
        assert gleich and re.fullmatch(r"[A-Z][A-Z0-9_]*", name), zeile
        assert re.fullmatch(f"{ohne_quotes}|{in_quotes}", wert), f"{name} braucht Anführungszeichen"


def test_oeffentliches_compose_reicht_jedes_settings_feld_durch():
    """compose.public.yaml gibt dem api-Container bewusst nur eine Aufzählung statt der
    ganzen .env mit. Fehlt dort ein neues Feld, greift auf der VM still der Default."""
    compose = pathlib.Path(__file__).resolve().parents[3] / "compose.public.yaml"
    dienst = re.search(r"^  api:\n(.*?)(?=^  \S|\Z)", compose.read_text("utf-8"), re.M | re.S)
    assert dienst, "Dienst api nicht gefunden"
    # Im Dienst api, und zwar als NAME: ${NAME} bzw. ${NAME:-Vorgabe} — ein fest
    # verdrahteter Wert oder eine andere Variable überginge die .env der VM genauso still.
    zeilen = re.findall(
        r"^      ([A-Z][A-Z0-9_]*): \$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}\s*$", dienst.group(1), re.M
    )
    durchgereicht = {name for name, quelle in zeilen if name == quelle}
    fehlend = sorted(
        feld.upper() for feld in Settings.model_fields if feld.upper() not in durchgereicht
    )
    assert fehlend == []


def test_tageslimit_ist_aus_und_nie_negativ():
    """SMTP_MAX_PER_DAY (ADR-0032): Voreinstellung 0 = kein Limit. Ein negativer Wert bricht
    den Start ab, statt still „kein Limit“ zu bedeuten."""
    assert make_settings().smtp_max_per_day == 0
    assert make_settings(smtp_max_per_day="5").smtp_max_per_day == 5  # die .env liefert Text
    with pytest.raises(ValidationError, match="SMTP_MAX_PER_DAY"):
        make_settings(smtp_max_per_day=-1)


KEINE_EINZELNE_ADRESSE = [
    "eins@x.de, zwei@x.de",
    "eins@x.de,zwei@x.de",
    "eins@x.de;zwei@x.de",
    "eins@x.de zwei@x.de",
    # Trenner auch dort, wo nur ein @ steht
    "eins@x.de,zwei",
    "eins@x.de;zwei",
    "eins@x.de zwei",
    "Tester <tester@x.de>",
    "tester",
]


def test_umleitung_ist_leer_oder_genau_eine_adresse():
    """MAIL_REDIRECT_TO (ADR-0032): Das Tageslimit zählt Mails, nicht Zustellungen. Mit zwei
    Adressen in der Umleitung ging jede gezählte Mail an beide — der Start bricht deshalb ab."""
    assert make_settings().mail_redirect_to == ""
    assert make_settings(mail_redirect_to=" tester@x.de ").mail_redirect_to == "tester@x.de"
    for wert in KEINE_EINZELNE_ADRESSE:
        with pytest.raises(ValidationError, match="MAIL_REDIRECT_TO .* genau EINE"):
            make_settings(mail_redirect_to=wert)


def test_umleitung_und_login_verstehen_unter_einer_adresse_dasselbe():
    """config.py kann das Muster des Logins nicht importieren (oidc importiert config) und
    führt deshalb ein eigenes. Beide müssen dieselben Werte annehmen und abweisen: je ASCII-
    Zeichen und einigen weiteren eine Probe vor und eine hinter dem @."""
    from app.core import config, oidc

    # ASCII, dazu ein Umlaut und Leerraum jenseits von ASCII (U+00A0, U+2028, U+3000)
    zeichen = [chr(nr) for nr in (*range(128), 0xE4, 0xA0, 0x2028, 0x3000)]
    proben = [*KEINE_EINZELNE_ADRESSE, "tester@x.de", "", "@", "a@", "@x.de"]
    proben += [muster.format(z) for z in zeichen for muster in ("a{}b@x.de", "a@x{}y.de")]
    urteile = {
        p: (bool(config._ADRESSE.fullmatch(p)), bool(oidc._ADRESSE.fullmatch(p))) for p in proben
    }

    assert {p: u for p, u in urteile.items() if u[0] != u[1]} == {}
    # Sonst hielte der Vergleich auch zwei Muster zusammen, die alles annehmen oder nichts.
    assert {u[0] for u in urteile.values()} == {True, False}


def test_deploy_und_compose_uebernehmen_das_tageslimit_mit_vorgabe_0():
    """deploy/vm/deploy.sh liest vor dem Start die .env der VM ein. Ein beim Aufruf übergebenes
    SMTP_MAX_PER_DAY muss deshalb dort landen — beim ersten Lauf und bei jedem weiteren über
    die Schlüsselliste der Mailkonfiguration. Sonst überschreibt es der alte Wert aus der
    Datei, oder es ist beim nächsten Start über demo-mode.sh wieder weg: Der Testversand
    liefe dann ohne Limit, und nichts wiese darauf hin. Ohne Angabe gilt 0 (kein Limit), im
    Skript wie in compose.public.yaml — jede andere Vorgabe ließe still Mails fallen.
    Dasselbe gilt beim erneuten Lauf für die Drossel SMTP_MAX_PER_MINUTE."""
    wurzel = pathlib.Path(__file__).resolve().parents[3]
    skript = (wurzel / "deploy" / "vm" / "deploy.sh").read_text("utf-8")
    # Nur der Rumpf des Heredocs wird zur .env der VM — dieselbe Zeile hinter dem
    # schließenden EOF setzte bloß eine Shell-Variable für diesen einen Lauf.
    env_der_vm = re.search(r"^ *cat > \.env <<EOF\n(.*?)^EOF$", skript, re.M | re.S)
    assert env_der_vm, "Heredoc, das die .env der VM schreibt, nicht gefunden"
    assert re.search(r"^SMTP_MAX_PER_DAY=\$\{SMTP_MAX_PER_DAY:-0\}$", env_der_vm.group(1), re.M)
    schluessel = re.search(r"^ *for key in ((?:.*\\\n)*.*); do$", skript, re.M)
    assert schluessel, "Schlüsselliste der Mailkonfiguration nicht gefunden"
    uebernommen = schluessel.group(1).replace("\\\n", " ").split()
    assert {"SMTP_MAX_PER_DAY", "SMTP_MAX_PER_MINUTE"} <= set(uebernommen)
    compose = (wurzel / "compose.public.yaml").read_text("utf-8")
    assert re.search(r"^ +SMTP_MAX_PER_DAY: \$\{SMTP_MAX_PER_DAY:-0\}$", compose, re.M)


async def _check_smtp(monkeypatch, capsys, *argumente, **einstellungen) -> tuple[list, list[str]]:
    """Lässt check_smtp.py laufen — weder mit der echten .env noch mit einem Server: Die
    Konfiguration kommt aus dem Test, die Verbindung ist eine Attrappe. Gibt zurück, was dem
    Server übergeben worden wäre, und die Zeilen der Ausgabe."""
    from app.mail.mailer import Mailer
    from scripts import check_smtp

    uebergeben: list = []

    async def verbindung(self):
        return object()

    async def senden(self, smtp, message):
        uebergeben.append(message)

    async def schliessen(self, smtp):
        pass

    monkeypatch.setattr(check_smtp, "_load_env", lambda: None)
    monkeypatch.setattr(Mailer, "open", verbindung)
    monkeypatch.setattr(Mailer, "send", senden)
    monkeypatch.setattr(Mailer, "close", schliessen)
    monkeypatch.setattr("sys.argv", ["check_smtp.py", *argumente])
    konfiguration = make_settings(mail_redirect_to="tester@x.de", **einstellungen)
    for feld, wert in konfiguration.model_dump(exclude_none=True).items():
        monkeypatch.setenv(feld.upper(), str(wert))

    assert await check_smtp.main() == 0
    return uebergeben, capsys.readouterr().out.splitlines()


@pytest.mark.parametrize(
    ("limit", "zeile"), [(5, "Tageslimit:  5 Mails in 24 Stunden"), (0, "Tageslimit:  keins")]
)
async def test_check_smtp_nennt_das_tageslimit(monkeypatch, capsys, limit, zeile):
    """check_smtp.py zeigt neben der Umleitung, welches Tageslimit die Konfiguration setzt —
    auch „keins“, damit ein still fehlendes Limit auffällt."""
    uebergeben, ausgabe = await _check_smtp(monkeypatch, capsys, smtp_max_per_day=limit)

    assert ausgabe[ausgabe.index("UMLEITUNG:   alle Mails an tester@x.de") + 1] == zeile
    assert uebergeben == []  # ohne --send-to bleibt es bei der Verbindungsprobe


async def test_check_smtp_sagt_dass_die_testmail_am_worker_vorbeigeht(monkeypatch, capsys):
    """Die Ausgabe nennt Umleitung und Tageslimit — für die Mail von --send-to gilt beides
    nicht: Sie geht an die angegebene Adresse und wird nirgends gezählt. Das muss dort stehen,
    wo man es vor einem Testversand liest."""
    uebergeben, ausgabe = await _check_smtp(
        monkeypatch, capsys, "--send-to", "probe@x.de", smtp_max_per_day=5
    )

    assert [mail["To"] for mail in uebergeben] == ["probe@x.de"]  # trotz MAIL_REDIRECT_TO
    assert ausgabe[ausgabe.index("[OK  ] Testmail an probe@x.de übergeben") + 1] == (
        "       Sie lief nicht über den Versand-Worker: nicht umgeleitet (MAIL_REDIRECT_TO), "
        "zählt nicht fürs Tageslimit."
    )


def test_check_smtp_laeuft_im_container_ohne_env_datei(tmp_path, monkeypatch):
    """Im api-Container gibt es keine .env — Compose hat die Werte schon in die Umgebung
    gelegt. Dort prüft RUNBOOK 1 den Relay mit diesem Skript; ohne Datei UND ohne Werte in der
    Umgebung bleibt es beim Abbruch."""
    from scripts.check_smtp import _load_env

    umgebung = {"SMTP_HOST": "relay.example.test"}
    monkeypatch.setattr("os.environ", umgebung)
    _load_env(tmp_path / "gibt-es-nicht.env")
    assert umgebung == {"SMTP_HOST": "relay.example.test"}

    monkeypatch.setattr("os.environ", {})
    with pytest.raises(SystemExit):
        _load_env(tmp_path / "gibt-es-nicht.env")
