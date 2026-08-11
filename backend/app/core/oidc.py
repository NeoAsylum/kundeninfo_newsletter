"""OIDC-Client für das BFF-Muster (Plan 5, ADR-002/003).

Der IdP ist reine Konfiguration: DEV = Keycloak-Container, PROD = Konzern-IdP.
Split-Horizon (Plan 5.5): Browser-URLs kommen unverändert aus der Discovery
(KC_HOSTNAME=localhost), Backend-Aufrufe (Discovery/Token/JWKS) werden auf
OIDC_INTERNAL_BASE_URL umgeschrieben. httpx respektiert HTTPS_PROXY/NO_PROXY/
SSL_CERT_FILE aus der Umgebung (Konzern-Proxy/CA, Plan 10.2).
"""

import base64
import hashlib
import logging
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from authlib.jose import JsonWebKey, JsonWebToken, KeySet  # type: ignore[import-untyped]
from authlib.jose.errors import JoseError  # type: ignore[import-untyped]

from app.core.config import Settings
from app.core.security import Identity

log = logging.getLogger(__name__)

SCOPES = "openid profile email"


class OidcError(Exception):
    pass


def claim_path(claims: dict, path: str) -> Any:
    """Löst Punktnotation auf ('realm_access.roles' → claims['realm_access']['roles'])."""
    current: Any = claims
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


class OidcClient:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._jwt = JsonWebToken(["RS256"])
        self._metadata: dict | None = None
        self._metadata_at = 0.0
        self._jwks: KeySet | None = None
        self._jwks_at = 0.0

    @property
    def issuer(self) -> str:
        return self._s.oidc_issuer_url.rstrip("/")

    def _to_internal(self, url: str) -> str:
        internal = self._s.oidc_internal_base_url.rstrip("/")
        if not internal:
            return url
        # Es wird ausschließlich der Origin ersetzt. Ein versehentlich
        # mitkonfigurierter Pfad (z. B. http://keycloak:8081/idp bei einem Issuer
        # .../idp/realms/dev) würde den Pfad verdoppeln → 404. Deshalb abschneiden.
        internal_parts = urlparse(internal)
        if internal_parts.scheme and internal_parts.netloc:
            if internal_parts.path.strip("/"):
                log.warning(
                    "OIDC_INTERNAL_BASE_URL enthält den Pfad '%s' — ignoriert; der Pfad "
                    "kommt aus OIDC_ISSUER_URL, es wird nur der Origin verwendet",
                    internal_parts.path,
                )
            internal = f"{internal_parts.scheme}://{internal_parts.netloc}"
        public = urlparse(self.issuer)
        public_origin = f"{public.scheme}://{public.netloc}"
        if url.startswith(public_origin):
            return internal + url[len(public_origin) :]
        return url

    async def _get_metadata(self) -> dict:
        if self._metadata and time.time() - self._metadata_at < 3600:
            return self._metadata
        url = self._to_internal(self.issuer) + "/.well-known/openid-configuration"
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url)
            response.raise_for_status()
        metadata = response.json()
        if metadata.get("issuer") != self.issuer:
            raise OidcError(
                f"Issuer-Mismatch: erwartet {self.issuer}, erhalten {metadata.get('issuer')}"
            )
        self._metadata, self._metadata_at = metadata, time.time()
        return metadata

    async def _get_jwks(self, force_refresh: bool = False) -> KeySet:
        if self._jwks and not force_refresh and time.time() - self._jwks_at < 3600:
            return self._jwks
        metadata = await self._get_metadata()
        url = self._to_internal(metadata["jwks_uri"])
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url)
            response.raise_for_status()
        self._jwks = JsonWebKey.import_key_set(response.json())
        self._jwks_at = time.time()
        return self._jwks

    async def build_authorize_redirect(self, prompt: str | None = None) -> tuple[str, dict]:
        """Liefert (Authorize-URL fürs Browser-Redirect, State-Payload fürs State-Cookie)."""
        metadata = await self._get_metadata()
        state = secrets.token_urlsafe(24)
        nonce = secrets.token_urlsafe(24)
        verifier = secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        params = {
            "client_id": self._s.oidc_client_id,
            "response_type": "code",
            "scope": SCOPES,
            "redirect_uri": self._s.callback_url,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        if prompt:
            params["prompt"] = prompt
        url = metadata["authorization_endpoint"] + "?" + urlencode(params)
        return url, {"state": state, "nonce": nonce, "verifier": verifier}

    async def build_end_session_url(
        self, post_logout_redirect_uri: str | None = None
    ) -> str | None:
        """Erzeugt die IdP-Logout-URL (end_session_endpoint) für vollständigen SSO-Logout."""
        metadata = await self._get_metadata()
        end_session = metadata.get("end_session_endpoint")
        if not end_session:
            return None
        params = {"client_id": self._s.oidc_client_id}
        if post_logout_redirect_uri:
            params["post_logout_redirect_uri"] = post_logout_redirect_uri
        return end_session + "?" + urlencode(params)

    async def exchange_code(self, code: str, verifier: str, nonce: str) -> dict:
        metadata = await self._get_metadata()
        token_url = self._to_internal(metadata["token_endpoint"])
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self._s.callback_url,
            "client_id": self._s.oidc_client_id,
            "client_secret": self._s.oidc_client_secret,
            "code_verifier": verifier,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(token_url, data=data)
        if response.status_code != 200:
            raise OidcError(
                f"Token-Endpoint lieferte {response.status_code}: {response.text[:300]}"
            )
        id_token = response.json().get("id_token")
        if not id_token:
            raise OidcError("Token-Antwort enthält kein id_token")
        return await self.validate_id_token(id_token, nonce)

    async def validate_id_token(self, token: str, nonce: str | None) -> dict:
        claims_options = {
            "iss": {"essential": True, "value": self.issuer},
            "aud": {"essential": True, "value": self._s.oidc_client_id},
            "exp": {"essential": True},
        }
        last_error: Exception | None = None
        claims = None
        # Zwei Versuche: bei unbekannter kid einmal JWKS neu laden (Key-Rotation, Plan 5.4)
        for force_refresh in (False, True):
            keys = await self._get_jwks(force_refresh=force_refresh)
            try:
                claims = self._jwt.decode(token, keys, claims_options=claims_options)
                claims.validate(leeway=30)
                break
            except JoseError as exc:
                last_error = exc
                claims = None
        if claims is None:
            raise OidcError(f"ID-Token-Validierung fehlgeschlagen: {last_error}")
        if nonce and claims.get("nonce") != nonce:
            raise OidcError("Nonce-Mismatch im ID-Token")
        return dict(claims)

    def identity_from_claims(self, claims: dict) -> Identity:
        email = claim_path(claims, self._s.oidc_email_claim)
        if not email:
            raise OidcError(f"Claim '{self._s.oidc_email_claim}' fehlt im ID-Token")
        # Rollen kommen NICHT mehr aus dem Token: Adminrechte führt das Portal
        # (users.is_admin, ADR-0022). Das Cookie trägt nur noch die Basisrolle, damit
        # keine Berechtigung an einer Stelle entsteht, die niemand mehr prüft.
        roles = ["employee"]
        display_name = claims.get("name") or claims.get("preferred_username")
        return Identity(
            sub=str(claims["sub"]),
            email=str(email).lower(),
            display_name=display_name,
            roles=roles,
        )
