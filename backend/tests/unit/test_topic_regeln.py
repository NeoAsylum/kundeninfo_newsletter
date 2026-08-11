"""Die Verteiler-Wächter aus app/domain/topics.py — reine Logik, ohne Datenbank.

TopicUsage trägt die gezählten Fakten, die Wächter nur die Entscheidung darüber.
Genau diese Trennung macht sie hier ohne Fixtures prüfbar: ein frei instanziiertes
Topic-Objekt reicht, weil die Wächter ausschließlich Attribute lesen.
"""

import pytest

from app.api.errors import ApiError
from app.db.models import Topic
from app.domain.topics import TopicUsage, guard_delete, guard_rename


def _topic(name: str = "KAP Störungsmeldungen") -> Topic:
    return Topic(id="kap", name=name)


def _usage(abos: int = 0, versaende: int = 0, offen: int = 0) -> TopicUsage:
    return TopicUsage(
        subscriber_count=abos,
        dispatch_count=versaende,
        open_dispatch_count=offen,
    )


def test_ohne_versandhistorie_loeschbar():
    """Abos hängen mit CASCADE am Verteiler und blockieren deshalb nichts."""
    assert _usage().deletable is True
    assert _usage(abos=4711).deletable is True


def test_mit_versandhistorie_nicht_loeschbar():
    assert _usage(versaende=1).deletable is False
    assert _usage(abos=3, versaende=7).deletable is False


def test_offener_versand_wird_erkannt():
    assert _usage(versaende=3).has_open_dispatch is False
    assert _usage(versaende=3, offen=1).has_open_dispatch is True


def test_gleicher_name_auch_mit_offenem_versand_erlaubt():
    """Ein PATCH aus dem Formular schickt den Namen immer mit — unverändert ist das
    kein Umbenennen und darf auch mitten im Versand nicht scheitern."""
    topic = _topic()
    guard_rename(topic, topic.name, _usage(versaende=2, offen=2))


def test_umbenennen_ohne_offenen_versand_erlaubt():
    guard_rename(_topic(), "KAP Meldungen", _usage(versaende=5))


def test_umbenennen_mit_offenem_versand_blockiert():
    with pytest.raises(ApiError) as exc:
        guard_rename(_topic(), "KAP Meldungen", _usage(versaende=5, offen=3))
    assert exc.value.status_code == 409
    assert exc.value.code == "TOPIC_RENAME_BLOCKED"
    # Die Zahl gehört in die Meldung: sie sagt dem Admin, worauf er wartet
    assert "3" in exc.value.detail


def test_loeschen_ohne_historie_still():
    guard_delete(_topic(), _usage(abos=12))


def test_loeschen_mit_historie_blockiert_und_nennt_ausweg():
    with pytest.raises(ApiError) as exc:
        guard_delete(_topic(), _usage(abos=12, versaende=1))
    assert exc.value.status_code == 409
    assert exc.value.code == "TOPIC_IN_USE"
    # Kein Wortlaut-Test, aber der Ausweg muss drinstehen — sonst wirkt es wie eine
    # Sackgasse und der Verteiler bleibt für immer in der Auswahl stehen
    assert "eaktivier" in exc.value.detail
