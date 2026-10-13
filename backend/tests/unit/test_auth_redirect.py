import pytest

from app.api.auth import _safe_next


@pytest.mark.parametrize("ziel", ["/abos.html", "/versand.html", "/meldungen.html?x=1"])
def test_relative_pfade_bleiben(ziel):
    assert _safe_next(ziel) == ziel


@pytest.mark.parametrize(
    "ziel",
    [
        None,
        "",
        "abos.html",
        "https://evil.example/",
        "//evil.example",
        "/\\evil.example",  # Browser lesen \ wie /
        "/\\/evil.example",
        "/\t/evil.example",  # Browser streichen Tab und Zeilenumbruch aus URLs
        "/\n/evil.example",
        "/pfad\r\nSet-Cookie: x=1",
        "javascript:alert(1)",
    ],
)
def test_alles_andere_faellt_auf_die_abo_maske_zurueck(ziel):
    assert _safe_next(ziel) == "/abos.html"
