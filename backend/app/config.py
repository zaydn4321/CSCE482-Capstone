import os
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEVELOPMENT_JWT_SECRET = "dev-only-secret-change-me-before-any-deployment-0123456789"


class Settings(BaseSettings):
    """Runtime configuration. Every field can be set with an ORBIT_* environment variable."""

    model_config = SettingsConfigDict(env_prefix="ORBIT_", env_file=".env", extra="ignore")

    # SQLite keeps local development dependency-free; production uses PostgreSQL + PostGIS
    # via docker-compose (postgresql+psycopg://orbit:orbit@localhost:5432/orbit).
    environment: Literal["development", "production"] = "development"
    # Replit provides DATABASE_URL in both environments. ORBIT_DATABASE_URL,
    # when explicitly set, takes precedence for other hosting providers.
    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./orbit-dev.db"))
    jwt_secret: str = DEVELOPMENT_JWT_SECRET
    jwt_ttl_seconds: int = 60 * 60 * 24 * 30
    max_batch_size: int = 5000
    cors_origins: list[str] = ["*"]

    # Place resolution: candidates within this radius of a visit's centroid are ranked,
    # and the best one is assigned only if its confidence clears the threshold.
    place_search_radius_m: float = 50
    place_min_confidence: float = 0.35
    # Opening hours are local time; one zone is enough until users travel (Part 2: per-visit zone).
    place_timezone: str = "America/Chicago"

    # Recommendations: with no explicit centre, look this far around the middle of the
    # user's resolved visits, and rank at most this many candidates.
    recommend_home_radius_m: float = 15000
    recommend_max_candidates: int = 300

    @model_validator(mode="after")
    def validate_production(self) -> "Settings":
        if self.environment == "production":
            if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://", "postgres://")):
                raise ValueError("Production requires a PostgreSQL database URL; SQLite is not persistent enough.")
            if self.jwt_secret == DEVELOPMENT_JWT_SECRET or len(self.jwt_secret) < 32:
                raise ValueError("Production requires a unique ORBIT_JWT_SECRET of at least 32 characters.")
            if "*" in self.cors_origins:
                raise ValueError("Production must not allow wildcard CORS; set ORBIT_CORS_ORIGINS to [] for a native-only API.")
        return self


settings = Settings()
