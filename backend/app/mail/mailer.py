"""Schmale SMTP-Abstraktion (Plan 6.2, ADR-012).

DEV = Mailpit, PROD = Konzern-Exchange-Relay — nur Konfiguration. Auth-Modi:
none | login; 'kerberos' ist ein reservierter, bewusst nicht gebauter
Erweiterungspunkt (wird nur nach Bestätigung durch das Exchange-Team gebaut).
"""

import contextlib
from email.message import EmailMessage
from email.utils import formataddr

import aiosmtplib

from app.core.config import Settings


class Mailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def build_message(self, to: str, subject: str, html: str, text: str) -> EmailMessage:
        message = EmailMessage()
        message["From"] = formataddr((self._s.mail_from_name, self._s.mail_from))
        message["To"] = to
        message["Subject"] = subject  # Nicht-ASCII wird RFC-2047-konform encodiert
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
        if self._s.smtp_auth_mode == "login":
            await smtp.login(self._s.smtp_user, self._s.smtp_password)
        return smtp

    async def send(self, smtp: aiosmtplib.SMTP, message: EmailMessage) -> None:
        await smtp.send_message(message)

    async def close(self, smtp: aiosmtplib.SMTP) -> None:
        # Verbindung ist ohnehin am Ende — Fehler beim Quit sind egal
        with contextlib.suppress(Exception):
            await smtp.quit()
