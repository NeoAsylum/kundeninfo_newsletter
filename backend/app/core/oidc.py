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
import re
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import JWKRegistry, KeySet
from joserfc.jws import JWSRegistry
from joserfc.jwt import JWTClaimsRegistry

from app.core.config import Settings
from app.core.security import Identity

log = logging.getLogger(__name__)


class OidcError(Exception):
    pass


# Genau EINE Adresse, wie sie in den To-Header darf: kein Leerraum, kein Steuerzeichen, kein
# Trenner, keine Klammern. „a@x.de, b@x.de“ würde als ein Empfänger gespeichert und beim
# Versand als zwei adressiert.
_ADRESSE = re.compile(r"""[^@\s\x00-\x1f\x7f,;<>()\[\]"\\]+@[^@\s\x00-\x1f\x7f,;<>()\[\]"\\]+""")


def claim_path(claims: dict, path: str) -> Any:
    """Löst Punktnotation auf ('realm_access.roles' → claims['realm_access']['roles'])."""
    current: Any = claims
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


class OidcClient:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._s = settings
        self._transport = transport  # Testnaht: IdP-Attrappe ohne Netz
        # Nur RS256 — und die Liste MUSS in der Registry stehen: Bekommt jwt.decode eine
        # Registry, ignoriert es sein algorithms-Argument; es gälten dann joserfcs
        # Vorgaben (auch HS256 und ES256). strict_check_header=False: unbekannte
        # Header-Parameter ignorieren (RFC 7515 §4); "crit" wird weiterhin geprüft.
        # Es gelten joserfcs Größengrenzen je Token-Teil (Base64-Zeichen): Header 512,
        # Payload 128 000, Signatur 1 024 — ein Header mit Zertifikatskette (x5c) oder
        # ein RSA-Schlüssel über 6 144 Bit fiele darunter.
        self._jws = JWSRegistry(algorithms=["RS256"], strict_check_header=False)
        # RFC 7797 ("b64": false, Payload unkodiert) bleibt abgelehnt.
        self._jws.header_registry.pop("b64", None)
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

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10, transport=self._transport)

    async def _fetch_json(self, url: str, was: str) -> dict:
        """GET mit JSON-Antwort. Netz-, Status- und Formatfehler werden zu OidcError,
        damit ein nicht erreichbarer IdP als 502 endet statt als unbehandelte Ausnahme."""
        try:
            async with self._http() as client:
                response = await client.get(url)
                response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, httpx.InvalidURL, ValueError, RecursionError) as exc:
            # InvalidURL ist KEIN HTTPError (kaputte URL aus der Discovery); RecursionError
            # wirft json bei extrem tief geschachtelten Antworten.
            raise OidcError(f"{was} nicht abrufbar: {exc}") from exc
        if not isinstance(data, dict):
            raise OidcError(f"{was}: unerwartetes Antwortformat")
        return data

    @staticmethod
    def _endpoint(metadata: dict, name: str) -> str:
        url = metadata.get(name)
        if not isinstance(url, str) or not url:
            raise OidcError(f"OIDC-Discovery enthält kein '{name}'")
        return url

    async def _get_metadata(self) -> dict:
        if self._metadata and time.time() - self._metadata_at < 3600:
            return self._metadata
        url = self._to_internal(self.issuer) + "/.well-known/openid-configuration"
        metadata = await self._fetch_json(url, "OIDC-Discovery")
        erhalten = metadata.get("issuer")
        # Bei manchen IdPs gehört ein abschließender "/" zum Issuer (Entra v1, Auth0).
        # Verglichen wird deshalb ohne ihn; für den iss-Claim gilt danach exakt die
        # Schreibweise des IdP aus der Discovery (validate_id_token).
        if erhalten not in (self.issuer, self.issuer + "/"):
            # gekürzt: Der Wert kommt vom IdP und landet im Log
            raise OidcError(
                f"Issuer-Mismatch: erwartet {self.issuer}, erhalten {str(erhalten)[:200]!r}"
            )
        self._metadata, self._metadata_at = metadata, time.time()
        return metadata

    async def _get_jwks(self, force_refresh: bool = False) -> KeySet:
        if self._jwks and not force_refresh and time.time() - self._jwks_at < 3600:
            return self._jwks
        metadata = await self._get_metadata()
        url = self._to_internal(self._endpoint(metadata, "jwks_uri"))
        eintraege = (await self._fetch_json(url, "JWKS")).get("keys")
        if not isinstance(eintraege, list):
            raise OidcError("JWKS nicht lesbar: 'keys' fehlt oder ist keine Liste")
        keys = []
        for jwk in eintraege:
            # RFC 7517 §5: Schlüssel, die wir nicht lesen können (fremder Typ, unbekannte
            # Kurve, unzulässiger Parameter), überspringen statt das ganze Set zu
            # verwerfen — sonst legte EIN solcher Eintrag beim IdP jede Anmeldung lahm.
            try:
                if not isinstance(jwk, dict):
                    raise TypeError("kein JSON-Objekt")
                keys.append(JWKRegistry.import_key(jwk))
            except (JoseError, ValueError, KeyError, TypeError) as exc:
                # Sichtbar machen: Trifft es den Signaturschlüssel, scheitert danach jede
                # Anmeldung an „No key for kid“ — das sähe sonst nach Schlüsselrotation aus.
                kid = jwk.get("kid") if isinstance(jwk, dict) else None
                log.warning("JWKS-Eintrag übersprungen (kid=%.80r): %s", kid, type(exc).__name__)
        if not keys:
            raise OidcError("JWKS enthält keinen lesbaren Schlüssel")
        self._jwks = KeySet(keys)
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
            "scope": self._s.oidc_scopes,
            "redirect_uri": self._s.callback_url,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        if prompt:
            params["prompt"] = prompt
        url = self._endpoint(metadata, "authorization_endpoint") + "?" + urlencode(params)
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
        token_url = self._to_internal(self._endpoint(metadata, "token_endpoint"))
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self._s.callback_url,
            "client_id": self._s.oidc_client_id,
            "client_secret": self._s.oidc_client_secret,
            "code_verifier": verifier,
        }
        try:
            async with self._http() as client:
                response = await client.post(token_url, data=data)
        except (httpx.HTTPError, httpx.InvalidURL) as exc:
            raise OidcError(f"Token-Endpoint nicht erreichbar: {exc}") from exc
        try:
            payload = response.json()
        except (ValueError, RecursionError):
            payload = None
        if response.status_code != 200:
            # Nur der kurze OAuth-Fehlercode (RFC 6749 §5.2), nie der Antworttext: Ein IdP
            # kann in error_description das Konto nennen — Adressen gehören nicht ins Log
            # (ADR-0014), und diese Meldung wird geloggt.
            fehler = payload.get("error") if isinstance(payload, dict) else None
            if not isinstance(fehler, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", fehler):
                fehler = "ohne Fehlercode"
            raise OidcError(f"Token-Endpoint lieferte {response.status_code}: {fehler}")
        if not isinstance(payload, dict):
            raise OidcError("Token-Antwort ist kein JSON-Objekt")
        id_token = payload.get("id_token")
        if not isinstance(id_token, str) or not id_token:
            raise OidcError("Token-Antwort enthält kein id_token")
        return await self.validate_id_token(id_token, nonce)

    async def validate_id_token(self, token: str, nonce: str | None) -> dict:
        # "essential" ist Pflicht: Ohne es prüft joserfc "value" nur, WENN der Claim da ist.
        # iss muss exakt dem Issuer aus der Discovery entsprechen (siehe _get_metadata).
        # nbf und iat prüft joserfc von sich aus mit, sobald das Token sie trägt.
        claims_registry = JWTClaimsRegistry(
            leeway=30,
            iss={"essential": True, "value": (await self._get_metadata())["issuer"]},
            aud={"essential": True, "value": self._s.oidc_client_id},
            exp={"essential": True},
            sub={"essential": True},
        )
        last_error: Exception | None = None
        claims = None
        # Zwei Versuche: bei unbekannter kid einmal JWKS neu laden (Key-Rotation, Plan 5.4)
        for force_refresh in (False, True):
            keys = await self._get_jwks(force_refresh=force_refresh)
            try:
                decoded = jwt.decode(token, keys, registry=self._jws)
                if not isinstance(decoded.claims, dict):
                    raise ValueError("Payload ist kein JSON-Objekt")
                claims_registry.validate(decoded.claims)
                claims = decoded.claims
                break
            except (JoseError, ValueError, TypeError, RecursionError) as exc:
                # JoseError deckt auch die unbekannte kid ab (InvalidKeyIdError) — genau der
                # Rotationsfall, für den der zweite Versuch da ist. Die übrigen reicht
                # joserfc bei kaputten Tokens ungefangen durch (z. B. "crit" ohne Liste,
                # Header kein JSON-Objekt, extrem tief geschachtelte Payload).
                last_error = exc
        if claims is None:
            raise OidcError(f"ID-Token-Validierung fehlgeschlagen: {last_error}")
        if nonce and claims.get("nonce") != nonce:
            raise OidcError("Nonce-Mismatch im ID-Token")
        return dict(claims)

    def identity_from_claims(self, claims: dict) -> Identity:
        email = claim_path(claims, self._s.oidc_email_claim)
        if email is None or email == "":
            raise OidcError(f"Claim '{self._s.oidc_email_claim}' fehlt im ID-Token")
        # Der Wert wird als Empfängeradresse gespeichert. Eine Liste (etwa ein Claim
        # `emails`) oder eine Zahl ergäbe per str() eine Scheinadresse statt eines
        # Anmeldefehlers. Der Wert selbst bleibt aus der Meldung heraus — sie wird geloggt.
        email = email.strip() if isinstance(email, str) else ""
        if len(email) > 320 or not _ADRESSE.fullmatch(email):  # 320: Länge von users.email
            raise OidcError(f"Claim '{self._s.oidc_email_claim}' ist keine E-Mail-Adresse")
        if not claims.get("sub"):
            raise OidcError("Claim 'sub' fehlt im ID-Token")
        # Rollen kommen NICHT mehr aus dem Token: Adminrechte führt das Portal
        # (users.is_admin, ADR-0022). Das Cookie trägt nur noch die Basisrolle, damit
        # keine Berechtigung an einer Stelle entsteht, die niemand mehr prüft.
        roles = ["employee"]
        # Der Name-Claim wird bewusst NICHT gelesen (ADR-0025) — das Portal zeigt
        # keine Personennamen an, also gibt es keinen Grund, sie zu übernehmen.
        return Identity(
            sub=str(claims["sub"]),
            email=email.lower(),
            roles=roles,
        )
