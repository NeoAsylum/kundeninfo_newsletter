"""Schmale SMTP-Abstraktion (ADR-0012).

DEV = Mailpit, Pilot = Gmail-Relay, PROD = Konzern-Relay — nur Konfiguration.
Auth-Modi: none (interner Relay mit IP-Allowlist) | login (SMTP AUTH). Verlangt
der Konzern-Relay Modern Auth/OAuth2, ist das Nacharbeit (offene Frage B2).
"""

import contextlib
import logging
from email.message import EmailMessage
from email.utils import formataddr, formatdate

import aiosmtplib

from app.core.config import Settings

log = logging.getLogger(__name__)


class Mailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def build_message(self, to: str, subject: str, html: str, text: str) -> EmailMessage:
        message = EmailMessage()
        message["From"] = formataddr((self._s.mail_from_name, self._s.mail_from))
        message["To"] = to
        message["Subject"] = subject  # Nicht-ASCII wird RFC-2047-konform encodiert
        # Pflicht-Header nach RFC 5322 — weder EmailMessage noch aiosmtplib setzen ihn,
        # und nicht jeder Relay trägt ihn nach.
        message["Date"] = formatdate(localtime=True)
        message.set_content(text)
        message.add_alternative(html, subtype="html")
        return message

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
            if self._s.smtp_auth_mode == "login":
                await smtp.login(self._s.smtp_user, self._s.smtp_password)
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
