"""IdP-Attrappe für die OIDC-Tests: Discovery, JWKS und Token-Endpunkt ohne Netz.

Hängt als httpx-Transport im OidcClient (`OidcClient(settings, transport=idp.transport)`).
Signiert echte RS256-Tokens, damit die Validierung des Clients tatsächlich läuft und
nicht weggemockt wird.
"""

import base64
import hashlib
import json
import time
from collections.abc import Callable
from urllib.parse import parse_qs

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from joserfc import jwt
from joserfc.jwk import RSAKey

from app.core.config import Settings


def neuer_schluessel(kid: str) -> RSAKey:
    return RSAKey.generate_key(2048, parameters={"kid": kid})


def _b64url(roh: bytes) -> str:
    return base64.urlsafe_b64encode(roh).rstrip(b"=").decode()


# Schlüsselerzeugung ist der teure Teil — einmal pro Testlauf genügt.
SCHLUESSEL_A = neuer_schluessel("key-a")
SCHLUESSEL_B = neuer_schluessel("key-b")
# Trägt die kid von A, ist aber ein anderer Schlüssel — für gefälschte Signaturen.
SCHLUESSEL_A_GEFAELSCHT = neuer_schluessel("key-a")


class FakeIdp:
    def __init__(self, settings: Settings, host: str | None = None) -> None:
        self.issuer = settings.oidc_issuer_url.rstrip("/")
        self.client_id = settings.oidc_client_id
        self.client_secret = settings.oidc_client_secret
        # host: unter welchem Origin die Attrappe Backend-Aufrufe erwartet (Split-Horizon)
        self.base = host.rstrip("/") + httpx.URL(self.issuer).path if host else self.issuer
        self.signing_key = SCHLUESSEL_A
        self.published_keys = [SCHLUESSEL_A]
        self.claims: dict = {"sub": "idp-sub-1", "email": "Mia@Example.Corp"}
        self.metadata_extra: dict = {}
        self.down = False
        self.token_status = 200
        self.token_body: dict | None = None  # überschreibt die Token-Antwort komplett
        # Pfad-Endung → Fabrik für eine beliebige Antwort (kaputtes JSON, HTML, 503 …)
        self.antworten: dict[str, Callable[[], httpx.Response]] = {}
        self.nonce: str | None = None
        self.code_challenge: str | None = None
        self.redirect_uri: str | None = None
        self.code = "code-1"  # den hätte der IdP beim Redirect zurück ausgestellt
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(self._handle)

    def erwarte(self, authorize_url: str) -> dict[str, str]:
        """Übernimmt nonce, PKCE-Challenge und redirect_uri aus der Authorize-URL — so wie
        der echte IdP sie beim Browser-Redirect zu sehen bekäme. Liefert die Query-Parameter."""
        params = {k: v[0] for k, v in parse_qs(httpx.URL(authorize_url).query.decode()).items()}
        self.nonce = params.get("nonce")
        self.code_challenge = params.get("code_challenge")
        self.redirect_uri = params.get("redirect_uri")
        return params

    def token(self, key: RSAKey | None = None, **overrides) -> str:
        key = key or self.signing_key
        claims = {
            "iss": self.issuer,
            "aud": self.client_id,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "nonce": self.nonce,
            **self.claims,
            **overrides,
        }
        claims = {k: v for k, v in claims.items() if v is not None}
        header = {"alg": "RS256", "kid": key.kid}
        return jwt.encode(header, claims, key)

    def roh_token(self, header, payload) -> str:
        """Beliebiger Header/Payload mit GÜLTIGER RS256-Signatur — für Tokens, die
        jwt.encode gar nicht erst erzeugt (Header kein Objekt, Payload keine Claims).
        bytes werden unverändert übernommen, alles andere als JSON."""
        teile = [
            _b64url(teil if isinstance(teil, bytes) else json.dumps(teil).encode())
            for teil in (header, payload)
        ]
        signatur = self.signing_key.private_key.sign(
            ".".join(teile).encode(), padding.PKCS1v15(), hashes.SHA256()
        )
        return ".".join([*teile, _b64url(signatur)])

    def aufrufe(self, endung: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path.endswith(endung)]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("Verbindung abgelehnt", request=request)
        for endung, antwort in self.antworten.items():
            if request.url.path.endswith(endung):
                return antwort()
        url = str(request.url)
        if url == self.base + "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": self.issuer,
                    "authorization_endpoint": self.issuer + "/auth",
                    "token_endpoint": self.issuer + "/token",
                    "jwks_uri": self.issuer + "/certs",
                    "end_session_endpoint": self.issuer + "/logout",
                }
                | self.metadata_extra,
            )
        if url == self.base + "/certs":
            keys = [k.as_dict(private=False) for k in self.published_keys]
            return httpx.Response(200, json={"keys": keys})
        if url == self.base + "/token" and request.method == "POST":
            return self._token_endpoint(request)
        return httpx.Response(404, json={"error": "not_found"})

    def _token_endpoint(self, request: httpx.Request) -> httpx.Response:
        if self.token_status != 200:
            return httpx.Response(self.token_status, json={"error": "invalid_grant"})
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        # Wie ein echter IdP: Client, Grant, Code und redirect_uri müssen zum Login passen —
        # sonst bliebe ein Client grün, dessen Token-Anfrage an Keycloak scheitern würde.
        if (form.get("client_id"), form.get("client_secret")) != (
            self.client_id,
            self.client_secret,
        ):
            return httpx.Response(401, json={"error": "invalid_client"})
        if (form.get("grant_type"), form.get("code"), form.get("redirect_uri")) != (
            "authorization_code",
            self.code,
            self.redirect_uri,
        ):
            return httpx.Response(400, json={"error": "invalid_grant"})
        # PKCE wie ein echter IdP prüfen: Der Verifier muss zur Challenge passen.
        challenge = _b64url(hashlib.sha256(form.get("code_verifier", "").encode()).digest())
        if challenge != self.code_challenge:
            return httpx.Response(400, json={"error": "invalid_grant", "detail": "pkce"})
        body = self.token_body if self.token_body is not None else {"id_token": self.token()}
        return httpx.Response(200, json=body)
