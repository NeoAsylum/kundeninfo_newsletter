"""JIT-Provisioning inkl. E-Mail-Kollisionsbehandlung (Plan 4.3, ADR-010)."""

from sqlalchemy import select

from app.core.security import Identity
from app.db.models import User
from app.domain.users import jit_upsert


async def _all_users(app) -> list[User]:
    async with app.state.sessionmaker() as session:
        return list((await session.execute(select(User).order_by(User.id))).scalars())


async def _login(app, sub: str, email: str) -> None:
    async with app.state.sessionmaker() as session:
        await jit_upsert(session, Identity(sub=sub, email=email))
        await session.commit()


async def test_erster_login_legt_user_an(app):
    await _login(app, "sub-a", "mia@example.corp")
    users = await _all_users(app)
    assert len(users) == 1
    assert users[0].oidc_sub == "sub-a"
    assert users[0].email == "mia@example.corp"
    assert users[0].is_active is True
    assert users[0].last_login_at is not None


async def test_erneuter_login_aktualisiert(app):
    await _login(app, "sub-a", "mia@example.corp")
    await _login(app, "sub-a", "mia.neu@example.corp")
    users = await _all_users(app)
    assert len(users) == 1
    assert users[0].email == "mia.neu@example.corp"


async def test_email_kollision_archiviert_altzeile(app):
    """Recycelte Adresse an Alt-Zeile mit anderem sub → kein Constraint-Crash beim Login."""
    await _login(app, "sub-alt", "mia@example.corp")
    await _login(app, "sub-neu", "mia@example.corp")

    users = await _all_users(app)
    assert len(users) == 2
    alt, neu = users
    assert alt.oidc_sub == "sub-alt"
    assert alt.is_active is False
    assert alt.email == f"user-{alt.id}@invalid.archiviert"
    assert neu.oidc_sub == "sub-neu"
    assert neu.email == "mia@example.corp"
    assert neu.is_active is True


async def test_email_wechsel_auf_kollidierende_adresse(app):
    await _login(app, "sub-a", "a@example.corp")
    await _login(app, "sub-b", "b@example.corp")
    # User b bekommt die Adresse von a zugewiesen (Namenswechsel im AD)
    await _login(app, "sub-b", "a@example.corp")

    users = {u.oidc_sub: u for u in await _all_users(app)}
    assert users["sub-a"].is_active is False
    assert users["sub-a"].email.endswith("@invalid.archiviert")
    assert users["sub-b"].email == "a@example.corp"


async def test_login_reaktiviert_deaktivierten_user(app, make_user):
    await make_user(sub="sub-a", email="mia@example.corp", active=False)
    await _login(app, "sub-a", "mia@example.corp")
    users = await _all_users(app)
    assert users[0].is_active is True
