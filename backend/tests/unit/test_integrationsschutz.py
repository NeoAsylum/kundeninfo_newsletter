"""Der Session-Guard der Integrationstests (tests/integration/conftest.py) liest die .env und
bricht ab, wenn der Stack so nicht getestet werden darf oder kann. Hier steht nur seine
Entscheidung — sie braucht keinen laufenden Stack."""

import pytest

from tests.integration.conftest import hindernisse_in_der_env

MAILPIT = ["# SMTP_HOST=smtp.gmail.com", "SMTP_HOST=mailpit", "SMTP_PORT=1025"]


@pytest.mark.parametrize(
    "zeilen",
    [
        MAILPIT,
        [*MAILPIT, "MAIL_REDIRECT_TO=", "SMTP_MAX_PER_DAY=0"],
        # deploy.sh schreibt Werte in Anführungszeichen; leer bleibt leer
        [*MAILPIT, 'MAIL_REDIRECT_TO=""', 'SMTP_MAX_PER_DAY="0"', "SMTP_MAX_PER_DAY="],
        [*MAILPIT, "# MAIL_REDIRECT_TO=tester@x.de", "#SMTP_MAX_PER_DAY=5"],
        ["SMTP_HOST=", 'SMTP_HOST="mailpit"'],
    ],
)
def test_mailpit_ohne_umleitung_und_tageslimit_darf_laufen(zeilen):
    assert hindernisse_in_der_env(zeilen) == []


@pytest.mark.parametrize(
    ("zeile", "beginn"),
    [
        ("SMTP_HOST=smtp.gmail.com", "SMTP_HOST='smtp.gmail.com' — "),
        ("MAIL_REDIRECT_TO=tester@x.de", "MAIL_REDIRECT_TO ist gesetzt — "),
        ('MAIL_REDIRECT_TO="tester@x.de"', "MAIL_REDIRECT_TO ist gesetzt — "),
        ("SMTP_MAX_PER_DAY=5", "SMTP_MAX_PER_DAY=5 — "),
        ('SMTP_MAX_PER_DAY="1"', "SMTP_MAX_PER_DAY=1 — "),
    ],
)
def test_echter_server_umleitung_und_tageslimit_brechen_mit_dem_namen_der_variable_ab(
    zeile, beginn
):
    """Mit echtem SMTP-Server gingen Mails nach außen. Mit Umleitung oder Tageslimit
    scheiterten die Tests auch an Mailpit — an fehlenden Empfängern oder abgeschriebenen
    Versänden —, ohne dass ihre Fehlermeldung die Einstellung nennt."""
    (hindernis,) = hindernisse_in_der_env([*MAILPIT, zeile])

    assert hindernis.startswith(beginn)
    assert "tester@x.de" not in hindernis  # die Umleitungsadresse gehört nicht in die Ausgabe


def test_alle_hindernisse_werden_auf_einmal_genannt():
    """Sonst bräuchte es nach dem Testbetrieb (RUNBOOK 3b) drei Anläufe, bis die .env passt."""
    zeilen = ["SMTP_HOST=smtp.gmail.com", "MAIL_REDIRECT_TO=tester@x.de", "SMTP_MAX_PER_DAY=5"]

    assert [h.split(" ")[0] for h in hindernisse_in_der_env(zeilen)] == [
        "SMTP_HOST='smtp.gmail.com'",
        "MAIL_REDIRECT_TO",
        "SMTP_MAX_PER_DAY=5",
    ]
