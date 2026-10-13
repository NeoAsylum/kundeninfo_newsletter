"""Zentrale Konfiguration (12-Factor, Plan 3.4).

Jedes Feld MUSS in .env.example dokumentiert sein — das prüft scripts/check_env_example.py
als CI-Gate. Fehlende Pflichtvariablen führen zu einem lauten Startfehler.
"""

import re
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Genau EINE Adresse — dasselbe Muster wie beim Login (app.core.oidc._ADRESSE). Von dort
# importieren geht nicht: oidc importiert dieses Modul. Ein Test hält beide zusammen.
_ADRESSE = re.compile(r"""[^@\s\x00-\x1f\x7f,;<>()\[\]"\\]+@[^@\s\x00-\x1f\x7f,;<>()\[\]"\\]+""")


class Settings(BaseSettings):
    # Ohne den abgewiesenen Wert in der Fehlermeldung: Ein Startfehler landet im Log des
    # Containers — sonst stünde dort ein zu kurzes SESSION_SECRET oder eine Adresse (ADR-0014).
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)

    app_env: Literal["dev", "prod"] = "dev"
    public_base_url: str
    log_level: str = "INFO"

    database_url: str

    oidc_issuer_url: str
    # Nur DEV (Split-Horizon, Plan 5.5): Basis-URL, unter der das Backend den IdP
    # erreicht. Leer = Issuer-URL wird auch backendseitig genutzt.
    oidc_internal_base_url: str = ""
    oidc_client_id: str
    oidc_client_secret: str
    oidc_email_claim: str = "email"
    # Bewusst ohne `profile`: Das Portal verarbeitet keine Namen, also fragt es auch
    # keine an (ADR-0028). Nur erweitern, wenn der IdP den E-Mail-Claim sonst nicht
    # liefert — er schickt dann auch Namens-Claims mit, die das Portal ignoriert.
    oidc_scopes: str = "openid email"

    # Notnagel für den ersten Admin: Adressen (kommagetrennt), die beim Login das
    # Adminrecht bekommen — aber NUR, solange es keinen aktiven Admin gibt (ADR-0022).
    # Damit ist die Liste im Normalbetrieb wirkungslos und taugt nicht als Hintertür.
    admin_bootstrap_emails: str = ""

    session_secret: str
    session_max_age: int = 28800

    smtp_host: str
    smtp_port: int = 25
    smtp_security: Literal["none", "starttls", "ssl"] = "none"
    smtp_auth_mode: Literal["none", "login"] = "none"
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str
    mail_from_name: str = "Zentrales Problemmanagement"
    # Testbetrieb: leitet ALLE ausgehenden Mails an diese EINE Adresse um (leer = aus).
    # Originalempfänger stehen im Header X-Original-Recipient und in der Historie.
    mail_redirect_to: str = ""
    smtp_max_per_minute: int = 0
    # Testbetrieb über ein privates Postfach (ADR-0032): Obergrenze der Mails, die der
    # Outbox-Worker binnen 24 Stunden an den SMTP-Server übergibt (0 = kein Limit).
    # Empfänger über dem Limit werden nicht nachgeholt, sondern enden als 'failed'.
    smtp_max_per_day: int = 0
    smtp_batch_size: int = 100
    smtp_timeout_s: int = 10

    worker_enabled: bool = True
    worker_poll_interval_s: float = 5.0
    worker_stale_after_s: int = 600
    worker_retry_backoff_s: str = "60,300,900"

    retention_days_recipients: int | None = None
    retention_days_audit: int | None = None
    audit_subscriptions: bool = False

    @field_validator("retention_days_recipients", "retention_days_audit", mode="before")
    @classmethod
    def _empty_string_is_none(cls, v: object) -> object:
        return None if v == "" else v

    @field_validator("oidc_scopes")
    @classmethod
    def _scopes_brauchen_openid(cls, v: str) -> str:
        scopes = v.split()
        if "openid" not in scopes:
            raise ValueError("OIDC_SCOPES muss 'openid' enthalten — ohne gibt es kein ID-Token")
        return " ".join(scopes)

    @field_validator("session_secret")
    @classmethod
    def _session_secret_strength(cls, v: str) -> str:
        if len(v) < 24:
            raise ValueError("SESSION_SECRET muss mindestens 24 Zeichen lang sein")
        return v

    @field_validator("mail_redirect_to")
    @classmethod
    def _umleitung_ist_eine_adresse(cls, v: str) -> str:
        # Das Tageslimit zählt Mails, nicht Zustellungen: Mit zwei Adressen in der Umleitung
        # ginge jede gezählte Mail an beide.
        v = v.strip()
        if v and not _ADRESSE.fullmatch(v):
            raise ValueError(
                "MAIL_REDIRECT_TO muss leer sein oder genau EINE E-Mail-Adresse enthalten "
                "(keine Liste, kein Name davor)"
            )
        return v

    @field_validator("smtp_max_per_day")
    @classmethod
    def _tageslimit_nicht_negativ(cls, v: int) -> int:
        # Ein Tippfehler wie -5 soll nicht still "kein Limit" bedeuten.
        if v < 0:
            raise ValueError("SMTP_MAX_PER_DAY darf nicht negativ sein (0 = kein Limit)")
        return v

    @model_validator(mode="after")
    def _smtp_auth_needs_credentials(self) -> "Settings":
        if self.smtp_auth_mode == "login" and not (self.smtp_user and self.smtp_password):
            raise ValueError("SMTP_AUTH_MODE=login erfordert SMTP_USER und SMTP_PASSWORD")
        return self

    @property
    def admin_bootstrap_set(self) -> set[str]:
        """Normalisiert (klein, getrimmt) — E-Mails aus Claims kommen kleingeschrieben an."""
        return {
            adresse.strip().lower()
            for adresse in self.admin_bootstrap_emails.split(",")
            if adresse.strip()
        }

    @property
    def is_dev(self) -> bool:
        return self.app_env == "dev"

    @property
    def callback_url(self) -> str:
        return self.public_base_url.rstrip("/") + "/auth/callback"

    @property
    def cookie_secure(self) -> bool:
        return self.public_base_url.startswith("https")

    @property
    def retry_backoff(self) -> list[int]:
        return [int(x) for x in self.worker_retry_backoff_s.split(",") if x.strip()]
