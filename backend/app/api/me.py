from fastapi import APIRouter

from app.api.deps import IdentityDep
from app.api.schemas import MeOut

router = APIRouter()


@router.get("/me", response_model=MeOut)
async def me(identity: IdentityDep) -> MeOut:
    return MeOut(email=identity.email, display_name=identity.display_name, roles=identity.roles)
