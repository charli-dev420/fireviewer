from functools import lru_cache
from typing import Literal

from pydantic import Field, HttpUrl, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="FV_",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Fire-Viewer API"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "staging", "production"] = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./data/fire_viewer.db"
    log_level: str = "INFO"
    max_body_bytes: int = Field(default=1_048_576, ge=16_384, le=16_777_216)
    sqlite_busy_timeout_ms: int = Field(default=10_000, ge=1_000, le=120_000)
    cors_origins: list[str] = Field(default_factory=list)
    trusted_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])

    auth_mode: Literal["disabled", "jwt"] = "disabled"
    oidc_jwks_url: HttpUrl | None = None
    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_roles_claim: str = "roles"
    oidc_algorithms: list[str] = Field(default_factory=lambda: ["RS256", "ES256"])
    oidc_leeway_seconds: int = Field(default=30, ge=0, le=300)

    matching_policy_id: str = "g1-default-v1"
    matching_create_below: float = Field(default=0.45, ge=0.0, le=1.0)
    matching_auto_attach_above: float = Field(default=0.80, ge=0.0, le=1.0)
    matching_min_margin: float = Field(default=0.15, ge=0.0, le=1.0)
    matching_max_candidate_distance_m: float = Field(default=20_000.0, ge=500.0, le=100_000.0)
    matching_max_incident_uncertainty_m: float = Field(default=10_000.0, ge=100.0, le=100_000.0)
    matching_max_candidates: int = Field(default=50, ge=2, le=500)
    matching_distance_scale_m: float = Field(default=250.0, ge=1.0, le=10_000.0)
    matching_active_time_decay_hours: float = Field(default=72.0, ge=1.0, le=8_760.0)
    matching_closed_time_decay_hours: float = Field(default=168.0, ge=1.0, le=17_520.0)

    idempotency_retention_hours: int = Field(default=24 * 30, ge=24, le=24 * 365)
    max_clock_skew_seconds: int = Field(default=300, ge=0, le=3_600)
    public_notice: str = (
        "Terrain daté; positions et périmètres peuvent être estimés; "
        "ce service ne remplace pas les secours."
    )

    @model_validator(mode="after")
    def validate_security(self) -> "Settings":
        if self.environment in {"staging", "production"} and self.auth_mode == "disabled":
            raise ValueError("Authentication cannot be disabled outside development/test")
        if self.auth_mode == "jwt":
            missing = [
                name
                for name, value in (
                    ("oidc_jwks_url", self.oidc_jwks_url),
                    ("oidc_issuer", self.oidc_issuer),
                    ("oidc_audience", self.oidc_audience),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"Missing JWT settings: {', '.join(missing)}")
        if self.matching_create_below >= self.matching_auto_attach_above:
            raise ValueError("matching_create_below must be lower than auto-attach threshold")
        if self.environment == "production" and "*" in self.trusted_hosts:
            raise ValueError("Wildcard trusted host is forbidden in production")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
