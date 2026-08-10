"""Kanonischer Demo-Seed (Plan 8.6): python -m app.seed (make seed).

Topics entstehen bereits per Migration 0002. Hier kommen Demo-User mit Abos
dazu, damit recipient-count und Versand vor dem ersten echten Login demofähig
sind. Idempotent; E-Mails kollidieren bewusst NICHT mit den Keycloak-Usern.
"""

import asyncio

from sqlalchemy import select

from app.core.config import Settings
from app.db.base import make_engine, make_sessionmaker
from app.db.models import Subscription, User

DEMO_USERS = [
    ("seed-demo-1", "demo1@example.corp", "Demo Eins", ["kap", "interflex"]),
    ("seed-demo-2", "demo2@example.corp", "Demo Zwei", ["kap"]),
    ("seed-demo-3", "demo3@example.corp", "Demo Drei", []),
]


async def seed() -> None:
    settings = Settings()  # type: ignore[call-arg]  # Pflichtfelder aus der Umgebung
    engine = make_engine(settings.database_url)
    sessionmaker = make_sessionmaker(engine)
    async with sessionmaker() as session:
        for sub, email, name, topic_ids in DEMO_USERS:
            user = (
                await session.execute(select(User).where(User.oidc_sub == sub))
            ).scalar_one_or_none()
            if user is None:
                user = User(oidc_sub=sub, email=email, display_name=name, is_active=True)
                session.add(user)
                await session.flush()
            for topic_id in topic_ids:
                existing = (
                    await session.execute(
                        select(Subscription).where(
                            Subscription.user_id == user.id, Subscription.topic_id == topic_id
                        )
                    )
                ).scalar_one_or_none()
                if existing is None:
                    session.add(Subscription(user_id=user.id, topic_id=topic_id))
        await session.commit()
    await engine.dispose()
    print("Seed abgeschlossen: 3 Demo-User (demo1..3@example.corp) mit Abos angelegt.")


if __name__ == "__main__":
    asyncio.run(seed())
