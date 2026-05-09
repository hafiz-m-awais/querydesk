"""
backend/config.py
Application settings loaded from environment / .env file.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────
    database_url: str

    # ── JWT ───────────────────────────────────────────────────
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 480   # 8 h

    # ── OTP ───────────────────────────────────────────────────
    otp_ttl_minutes: int = 10
    otp_length: int = 6

    # ── Email (SMTP) ───────────────────────────────────────────
    smtp_host: str = "smtp.resend.com"
    smtp_port: int = 465
    smtp_user: str = "resend"
    smtp_password: str = ""
    email_from: str = "noreply@querydesk.app"

    # ── App ────────────────────────────────────────────────────
    cors_origins: str = "http://localhost:5500"
    app_env: str = "development"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
