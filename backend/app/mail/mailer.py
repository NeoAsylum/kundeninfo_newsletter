"""Schmale SMTP-Abstraktion (Plan 6.2, ADR-0012).

DEV = Mailpit, PROD = Konzern-Exchange-Relay — nur Konfiguration. Auth-Modi:
none | login | oauth2 (Microsoft Modern Auth / XOAUTH2). 'kerberos' bleibt ein
reservierter, nicht gebauter Erweiterungspunkt.
"""

import base64
import contextlib
import logging
import time
from email.message import EmailMessage
from email.utils import formataddr

import aiosmtplib
import httpx

from app.core.config import Settings

log = logging.getLogger(__name__)

# Access-Token vorzeitig erneuern, damit er nicht mitten im Versand abläuft
_TOKEN_SAFETY_MARGIN_S = 120


class MailerAuthError(Exception):
    """Auth am SMTP-Server fehlgeschlagen (Token/Credentials/Policy)."""


class Mailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    def build_message(self, to: str, subject: str, html: str, text: str) -> EmailMessage:
        message = EmailMessage()
        message["From"] = formataddr((self._s.mail_from_name, self._s.mail_from))
        message["To"] = to
        message["Subject"] = subject  # Nicht-ASCII wird RFC-2047-konform encodiert
        message.set_content(text)
        message.add_alternative(html, subtype="html")
        return message

    async def _get_access_token(self) -> str:
        """Tauscht den Refresh-Token gegen einen Access-Token (im Prozess gecacht).

        Microsoft rotiert Refresh-Tokens: die Antwort enthält einen neuen. Wir
        verwenden weiter den konfigurierten (bleibt gültig, solange er regelmäßig
        genutzt wird) — bei längerer Pause muss er neu geholt werden (RUNBOOK 3b).
        """
        if self._access_token and time.time() < self._token_expires_at:
            return self._access_token

        data = {
            "client_id": self._s.smtp_oauth_client_id,
            "grant_type": "refresh_token",
            "refresh_token": self._s.smtp_oauth_refresh_token,
            "scope": self._s.smtp_oauth_scope,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(self._s.oauth_token_url, data=data)
        if response.status_code != 200:
            # Fehlertext enthält keinen Token, aber die Microsoft-Fehlernummer (AADSTS…)
            raise MailerAuthError(
                f"OAuth2-Token-Abruf fehlgeschlagen (HTTP {response.status_code}): "
                f"{response.text[:300]}"
            )
        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise MailerAuthError("OAuth2-Antwort enthält kein access_token")
        self._access_token = token
        self._token_expires_at = (
            time.time() + int(payload.get("expires_in", 3600)) - _TOKEN_SAFETY_MARGIN_S
        )
        log.info("OAuth2-Access-Token erneuert (gültig %ss)", payload.get("expires_in"))
        return token

    @staticmethod
    def xoauth2_string(user: str, access_token: str) -> str:
        """SASL-XOAUTH2: base64("user=<user>^Aauth=Bearer <token>^A^A")."""
        raw = f"user={user}\x01auth=Bearer {access_token}\x01\x01"
        return base64.b64encode(raw.encode()).decode()

    async def _authenticate(self, smtp: aiosmtplib.SMTP) -> None:
        if self._s.smtp_auth_mode == "login":
            await smtp.login(self._s.smtp_user, self._s.smtp_password)
        elif self._s.smtp_auth_mode == "oauth2":
            token = await self._get_access_token()
            payload = self.xoauth2_string(self._s.smtp_user, token)
            code, response = await smtp.execute_command(
                b"AUTH", b"XOAUTH2", payload.encode(), timeout=self._s.smtp_timeout_s
            )
            if code != 235:  # 235 = Authentication successful
                raise MailerAuthError(f"XOAUTH2 abgelehnt ({code}): {response}")

    async def open(self) -> aiosmtplib.SMTP:
        """Öffnet eine Verbindung (wird für SMTP_BATCH_SIZE Mails wiederverwendet)."""
        smtp = aiosmtplib.SMTP(
            hostname=self._s.smtp_host,
            port=self._s.smtp_port,
            timeout=self._s.smtp_timeout_s,
            use_tls=self._s.smtp_security == "ssl",
            start_tls=self._s.smtp_security == "starttls",
        )
        await smtp.connect()
        try:
            await self._authenticate(smtp)
        except Exception:
            await self.close(smtp)
            raise
        return smtp

    async def send(self, smtp: aiosmtplib.SMTP, message: EmailMessage) -> None:
        await smtp.send_message(message)

    async def close(self, smtp: aiosmtplib.SMTP) -> None:
        # Verbindung ist ohnehin am Ende — Fehler beim Quit sind egal
        with contextlib.suppress(Exception):
            await smtp.quit()
