"""Eingabevalidierung für alles, was im Mail-Betreff landet (Titel, Verteilername)."""

import sys

import pytest
from pydantic import ValidationError

from app.api.schemas import DispatchDraft, TopicCreate, TopicPatch
from app.db.models import Severity
from app.mail.mailer import Mailer
from app.mail.render import build_subject

# Alles, woran EmailMessage einen Betreff als mehrzeilig ablehnt, plus übrige Steuerzeichen
UMBRUCH_UND_STEUERZEICHEN = ["\n", "\r", "\t", "\x00", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e"]
UMBRUCH_UND_STEUERZEICHEN += ["\x7f", "\x85", "\u2028", "\u2029"]


def _draft(title: str) -> DispatchDraft:
    return DispatchDraft(topic_id="kap", severity="stoerung", title=title, body="Text")


@pytest.mark.parametrize("zeichen", UMBRUCH_UND_STEUERZEICHEN, ids=ascii)
def test_titel_ohne_umbruch_und_steuerzeichen(zeichen):
    with pytest.raises(ValidationError):
        _draft(f"Login{zeichen}klemmt")


@pytest.mark.parametrize("zeichen", UMBRUCH_UND_STEUERZEICHEN, ids=ascii)
def test_verteilername_ohne_umbruch_und_steuerzeichen(zeichen):
    """Regression: Nur der Titel war geprüft. Ein Verteilername mit Zeilenumbruch ließ
    sich anlegen — und jede Mail jedes Versands über diesen Verteiler scheiterte danach
    im Worker am Betreff."""
    with pytest.raises(ValidationError):
        TopicCreate(id="test", name=f"Zeile{zeichen}Zwei")
    with pytest.raises(ValidationError):
        TopicPatch(name=f"Zeile{zeichen}Zwei")


def test_jedes_zeichen_an_dem_splitlines_trennt_ist_im_titel_verboten():
    """EmailMessage lehnt einen Betreff ab, sobald str.splitlines() ihn teilt. Statt einer
    Liste von Hand: jedes Unicode-Zeichen durchprobieren."""
    trenner = [chr(cp) for cp in range(sys.maxunicode + 1) if len(f"a{chr(cp)}b".splitlines()) > 1]
    assert len(trenner) >= 10  # \n \r \v \f FS GS RS NEL LS PS
    for zeichen in trenner:
        with pytest.raises(ValidationError):
            _draft(f"Login{zeichen}klemmt")


def test_gueltige_eingaben_bleiben_unveraendert():
    assert (
        _draft("Störung: Login klemmt – seit 9 Uhr").title == "Störung: Login klemmt – seit 9 Uhr"
    )
    assert TopicCreate(id="kap-2", name="KAP Störungsmeldungen (Süd)").name.endswith("(Süd)")
    assert TopicPatch().name is None
    assert TopicPatch(description="Zeile 1\nZeile 2").description == "Zeile 1\nZeile 2"


def test_titel_laengengrenzen():
    assert _draft("x" * 150).title
    for titel in ("", "x" * 151):
        with pytest.raises(ValidationError):
            _draft(titel)


def test_was_die_validierung_durchlaesst_ergibt_einen_baubaren_betreff(settings):
    """Die Gegenprobe zur Verbotsliste: Was Titel und Name passieren darf, muss sich
    als Mail bauen lassen — sonst fiele es erst im Worker auf."""
    name = TopicCreate(id="test", name="Ünïcode ✓ „Name“").name
    titel = _draft("Ausfall – 50 % der Logins; Details folgen …").title
    subject = build_subject(Severity.stoerung, name, titel)
    message = Mailer(settings).build_message("a@example.corp", subject, "<p>x</p>", "x")
    assert message["Subject"] == subject
