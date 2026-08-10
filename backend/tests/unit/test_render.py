"""Template-Tests (Plan 8.2) — inkl. des wichtigsten Sicherheitstests: HTML-Escaping."""

from app.db.models import Severity
from app.mail.render import SEVERITY_META, build_subject, render_mail


def test_betreff_praefixe():
    assert build_subject(Severity.stoerung, "KAP Störungsmeldungen", "Login klemmt") == (
        "[STÖRUNG] KAP Störungsmeldungen: Login klemmt"
    )
    assert build_subject(Severity.einschraenkung, "T", "x").startswith("[EINSCHRÄNKUNG]")
    assert build_subject(Severity.entwarnung, "T", "x").startswith("[ENTWARNUNG]")


def test_farbbalken_je_schweregrad(settings):
    for severity in Severity:
        html, _ = render_mail(settings, severity, "Topic", "Titel", "Text")
        assert SEVERITY_META[severity]["color"] in html


def test_nutzereingaben_werden_escaped(settings):
    """XSS-Versuch in Titel und Body darf nie als HTML ankommen."""
    evil = '<script>alert("xss")</script>'
    html, _ = render_mail(settings, Severity.stoerung, "Topic", evil, f"Hallo {evil}")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_zeilenumbrueche_werden_br(settings):
    html, text = render_mail(settings, Severity.stoerung, "T", "Titel", "Zeile 1\nZeile 2")
    assert "Zeile 1<br>" in html
    assert "Zeile 1\nZeile 2" in text


def test_footer_mit_abo_link_und_topic(settings):
    html, text = render_mail(settings, Severity.stoerung, "KAP Störungsmeldungen", "T", "B")
    assert "http://testserver/abos.html" in html
    assert "KAP Störungsmeldungen" in html
    assert "Einstellungen verwalten" in html
    assert "http://testserver/abos.html" in text
    assert "http://testserver/datenschutz.html" in html


def test_footer_ist_fuer_alle_identisch_kein_tracking(settings):
    """Null-Tracking (Plan 10.1): kein empfängerspezifischer Inhalt im Rendering."""
    html1, _ = render_mail(settings, Severity.stoerung, "T", "Titel", "Body")
    html2, _ = render_mail(settings, Severity.stoerung, "T", "Titel", "Body")
    assert html1 == html2
