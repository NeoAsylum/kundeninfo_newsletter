from fastapi import APIRouter

from app.api.deps import CurrentUserDep, IdentityDep, is_admin
from app.api.schemas import MeOut

router = APIRouter()


@router.get("/me", response_model=MeOut)
async def me(identity: IdentityDep, user: CurrentUserDep) -> MeOut:
    """Liefert die WIRKSAMEN Rollen. Das Frontend blendet seine Admin-Navigation daran
    auf — stimmten sie nicht mit der Autorisierung überein, sähe der Nutzer Menüpunkte,
    die in 403 laufen (oder umgekehrt keine, obwohl die API ihn durchlässt).

    Bewusst ABGELEITET und nicht aus dem Cookie gelesen: `deps.is_admin` ist die
    einzige Stelle, die über Adminschaft entscheidet, und sie fragt die Datenbank
    (ADR-0022). Eine Rolle aus dem Cookie hier durchzureichen würde Rechte anzeigen,
    die die API nicht gewährt. `employee` gilt für jeden angemeldeten DB-Nutzer.
    """
    roles = ["employee"]
    if is_admin(user):
        roles.append("admin")
    return MeOut(email=identity.email, display_name=identity.display_name, roles=roles)
