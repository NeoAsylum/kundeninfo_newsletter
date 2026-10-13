"""Die SQL-Blöcke der Betriebsdoku laufen auf der echten Datenbank.

Beim Wechsel auf PostgreSQL waren sie im MariaDB-Dialekt stehen geblieben: Der dokumentierte
Ausweg aus einer Aussperrung (RUNBOOK 6b), die Notfall-Empfängerliste und die Prozeduren
für Auskunft und Löschung scheiterten an `is_admin = 1`, GROUP_CONCAT und JSON_EXTRACT.
"""

import pathlib
import re
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.core.clock import utcnow
from app.db.models import (
    AuditLog,
    Dispatch,
    DispatchRecipient,
    DispatchStatus,
    RecipientStatus,
    Severity,
    Subscription,
    User,
)
from app.mail.worker import OutboxWorker

DOCS = pathlib.Path(__file__).resolve().parents[3] / "docs"
BETROFFEN = "betroffener@example.corp"


def _anweisungen(datei: str) -> list[str]:
    inhalt = (DOCS / datei).read_text("utf-8")
    anweisungen = []
    for block in re.findall(r"^[ \t]*```sql\n(.*?)^[ \t]*```", inhalt, re.M | re.S):
        for anweisung in re.sub(r"--[^\n]*", "", block).split(";"):
            if anweisung.strip():
                anweisungen.append(" ".join(anweisung.split()))
    return anweisungen


@pytest.mark.parametrize("datei", ["RUNBOOK.md", "dsgvo-operations.md"])
async def test_sql_der_betriebsdoku_laeuft_auf_postgresql(app, datei):
    anweisungen = _anweisungen(datei)
    assert len(anweisungen) >= 8, "SQL-Blöcke nicht gefunden — hat sich das Format geändert?"
    async with app.state.sessionmaker() as session:
        # Zeilen, die die Anweisungen treffen — sonst bliebe etwa ein UPDATE ohne Wirkung
        person = User(oidc_sub="s-betroffen", email=BETROFFEN, is_admin=True)
        session.add(person)
        await session.flush()
        session.add(Subscription(user_id=person.id, topic_id="kap"))
        session.add(
            AuditLog(
                action="admin_granted", actor_email="chef@example.corp", detail={"email": BETROFFEN}
            )
        )
        await session.flush()
        try:
            for anweisung in anweisungen:
                await session.execute(text(anweisung))
        finally:
            await session.rollback()


async def test_auskunft_findet_abos_und_audit_eintraege(app):
    """Nicht nur lauffähig: Die Art.-15-Abfragen liefern, was sie versprechen — auch die
    Admin-Eingriffe, die das Konto nur über detail.user_id nennen."""
    auskunft, _, audit = _anweisungen("dsgvo-operations.md")[:3]
    async with app.state.sessionmaker() as session:
        person = User(oidc_sub="s-betroffen", email=BETROFFEN)
        session.add(person)
        await session.flush()
        session.add_all([Subscription(user_id=person.id, topic_id=t) for t in ("kap", "aap")])
        chef = "chef@example.corp"
        session.add_all(
            [
                AuditLog(action="admin_granted", actor_email=chef, detail={"email": BETROFFEN}),
                # So protokolliert die API Abo-Pflege und Deaktivierung durch einen Admin
                AuditLog(
                    action="admin_subscribe",
                    actor_email=chef,
                    detail={"user_id": person.id, "topic_id": "kap"},
                ),
                AuditLog(
                    action="user_deactivated", actor_email=chef, detail={"user_id": person.id}
                ),
                # … und das hier betrifft jemand anderen
                AuditLog(action="user_deactivated", actor_email=chef, detail={"user_id": -1}),
            ]
        )
        await session.flush()
        try:
            zeile = (await session.execute(text(auskunft))).mappings().one()
            assert sorted(zeile["active_subscriptions"].split(",")) == ["aap", "kap"]
            aktionen = sorted(e.action for e in await session.execute(text(audit)))
            assert aktionen == ["admin_granted", "admin_subscribe", "user_deactivated"]
        finally:
            await session.rollback()


@pytest.mark.parametrize("zeitzone", ["Europe/Berlin", "America/Los_Angeles"])
async def test_zaehlung_im_runbook_zaehlt_was_der_worker_zaehlt(app, zeitzone):
    """RUNBOOK 3b nennt die Abfrage, mit der der Betrieb den Stand des Tageslimits sieht
    (ADR-0032) — sein einziger Blick auf den Zähler. Sie muss ergeben, was der Worker zählt:
    nur 'sent', nur die letzten 24 Stunden, und das auch in einer Sitzung, deren Zeitzone
    nicht UTC ist (sent_at ist UTC ohne Zeitzone; östlich von UTC fiele sonst zu viel
    heraus, westlich zählte zu viel mit)."""
    (zaehlung,) = [a for a in _anweisungen("RUNBOOK.md") if "interval '24 hours'" in a]
    jetzt = utcnow()
    # Eine halbe Stunde Abstand zur Grenze: Die Abfrage rechnet mit der Uhr des
    # Datenbankservers, der Worker mit der des Testprozesses.
    zeilen = [
        (RecipientStatus.sent, timedelta(minutes=1)),
        (RecipientStatus.sent, timedelta(hours=23, minutes=30)),
        (RecipientStatus.sent, timedelta(hours=24, minutes=30)),
        (RecipientStatus.failed, timedelta(minutes=1)),
        (RecipientStatus.pending, None),
    ]
    async with app.state.sessionmaker() as session:
        person = User(oidc_sub="s-zaehlung", email="absender@example.corp")
        session.add(person)
        await session.flush()
        versand = Dispatch(
            topic_id="kap",
            severity=Severity.stoerung,
            subject="[STÖRUNG] Zählung",
            body="Testinhalt",
            status=DispatchStatus.completed,
            recipient_count=len(zeilen),
            created_by_user_id=person.id,
        )
        session.add(versand)
        await session.flush()
        session.add_all(
            DispatchRecipient(
                dispatch_id=versand.id,
                email=f"e{nr}@x.de",
                status=status,
                sent_at=jetzt - alter if alter else None,
            )
            for nr, (status, alter) in enumerate(zeilen)
        )
        await session.commit()  # der Worker liest über eine eigene Verbindung

        # Gilt bis zum Ende der Transaktion; das Rollback beim Schließen nimmt es zurück.
        await session.execute(text(f"SET TIME ZONE '{zeitzone}'"))
        assert (await session.execute(text("SHOW TIME ZONE"))).scalar_one() == zeitzone
        laut_runbook = (await session.execute(text(zaehlung))).scalar_one()

    worker = OutboxWorker(app.state.sessionmaker, app.state.settings)
    assert laut_runbook == await worker._sent_last_24h() == 2
