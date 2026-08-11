"""Zentrale Konfiguration (12-Factor, Plan 3.4).

Jedes Feld MUSS in .env.example dokumentiert sein — das prüft scripts/check_env_example.py
als CI-Gate. Fehlende Pflichtvariablen führen zu einem lauten Startfehler.
"""

from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

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
    oidc_roles_claim: str = "realm_access.roles"
    admin_role_value: str = "stoerungsinfo-admin"

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
    # Testbetrieb: leitet ALLE ausgehenden Mails an diese Adresse um (leer = aus).
    # Originalempfänger stehen im Header X-Original-Recipient und in der Historie.
    mail_redirect_to: str = ""
    smtp_max_per_minute: int = 0
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

    @field_validator("session_secret")
    @classmethod
    def _session_secret_strength(cls, v: str) -> str:
        if len(v) < 24:
            raise ValueError("SESSION_SECRET muss mindestens 24 Zeichen lang sein")
        return v

    @model_validator(mode="after")
    def _smtp_auth_needs_credentials(self) -> "Settings":
        if self.smtp_auth_mode == "login" and not (self.smtp_user and self.smtp_password):
            raise ValueError("SMTP_AUTH_MODE=login erfordert SMTP_USER und SMTP_PASSWORD")
        return self

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
