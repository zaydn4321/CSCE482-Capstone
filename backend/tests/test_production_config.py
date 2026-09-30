import pytest
from pydantic import ValidationError

from app.config import Settings
from app.db import compatible_database_url


def test_production_refuses_dev_defaults(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ORBIT_DATABASE_URL", raising=False)
    monkeypatch.setenv("ORBIT_ENVIRONMENT", "production")
    with pytest.raises(ValidationError, match="PostgreSQL"):
        Settings(_env_file=None)


def test_production_requires_secret_and_restricted_cors(monkeypatch):
    monkeypatch.setenv("ORBIT_ENVIRONMENT", "production")
    monkeypatch.setenv("ORBIT_DATABASE_URL", "postgresql://localhost/orbit")
    with pytest.raises(ValidationError, match="ORBIT_JWT_SECRET"):
        Settings(_env_file=None)
    monkeypatch.setenv("ORBIT_JWT_SECRET", "a-unique-development-test-secret-1234567890")
    with pytest.raises(ValidationError, match="wildcard CORS"):
        Settings(_env_file=None)
    monkeypatch.setenv("ORBIT_CORS_ORIGINS", "[]")
    assert Settings(_env_file=None).environment == "production"


def test_replit_database_url_uses_installed_driver(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/orbit")
    monkeypatch.delenv("ORBIT_DATABASE_URL", raising=False)
    assert Settings(_env_file=None).database_url == "postgresql://localhost/orbit"
    assert compatible_database_url("postgresql://localhost/orbit") == "postgresql+psycopg://localhost/orbit"
    assert compatible_database_url("postgres://localhost/orbit") == "postgresql+psycopg://localhost/orbit"
    assert compatible_database_url("postgresql+psycopg://localhost/orbit") == "postgresql+psycopg://localhost/orbit"