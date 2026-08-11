"""Session-Cookie (BFF-Muster, ADR-003) und Identität.

Das Cookie ist ein Fernet-Token (AES + HMAC, aus SESSION_SECRET abgeleitet):
verschlüsselt UND signiert, kein Session-Store nötig. Tausch des Secrets
invalidiert sofort alle Sessions (Notfallhebel, RUNBOOK).
"""

import base64
import hashlib
import json
import time
from dataclasses import dataclass, field

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import Settings

SESSION_COOKIE = "session"
STATE_COOKIE = "oidc_state"
STATE_MAX_AGE = 600  # 10 min für den Login-Roundtrip


@dataclass(frozen=True)
class Identity:
    """Wer angemeldet ist — bewusst OHNE Berechtigungen. Adminrechte stehen in der
    Datenbank und werden bei jeder Anfrage dort geprüft (ADR-0022); eine Rolle im
    Cookie wäre eine zweite, nie widerrufbare Wahrheit."""

    sub: str
    email: str
    display_name: str | None = None
    roles: list[str] = field(default_factory=list)


def _fernet(secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)


def encode_payload(secret: str, payload: dict, max_age: int) -> str:
    data = dict(payload)
    data["exp"] = int(time.time()) + max_age
    return _fernet(secret).encrypt(json.dumps(data).encode()).decode()


def decode_payload(secret: str, token: str) -> dict | None:
    try:
        data = json.loads(_fernet(secret).decrypt(token.encode()))
    except (InvalidToken, ValueError):
        return None
    if not isinstance(data, dict) or data.get("exp", 0) < time.time():
        return None
    return data


def session_cookie_value(settings: Settings, identity: Identity) -> str:
    return encode_payload(
        settings.session_secret,
        {
            "sub": identity.sub,
            "email": identity.email,
            "name": identity.display_name,
            "roles": identity.roles,
        },
        settings.session_max_age,
    )


def read_session(settings: Settings, cookie: str | None) -> Identity | None:
    if not cookie:
        return None
    data = decode_payload(settings.session_secret, cookie)
    if data is None or "sub" not in data or "email" not in data:
        return None
    return Identity(
        sub=str(data["sub"]),
        email=str(data["email"]),
        display_name=data.get("name"),
        roles=list(data.get("roles", [])),
    )
