from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote_plus

from pydantic import Field, SecretStr, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]

current_env = os.getenv("ENV", "dev")

ENV_FILE_FALLBACK = PROJECT_ROOT / ".env"
ENV_FILE_SPECIFIC = PROJECT_ROOT / f".env.{current_env}"

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
Environment = Literal["dev", "production"]


class ConfigurationError(RuntimeError):
    """Raised when the environment cannot produce a valid configuration."""


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ENV_FILE_FALLBACK, ENV_FILE_SPECIFIC)
        if ENV_FILE_SPECIFIC.exists()
        else ENV_FILE_FALLBACK,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    env: Environment = Field(alias="ENV", default="dev")
    db_connection_interval: int = Field(
        default=5000, alias="DB_CONNECTION_INTERVAL", ge=100
    )

    # Optional: when absent the level follows the environment. Declaring it as
    # a Literal means a typo like "VERBOSE" stops startup rather than silently
    # falling back.
    log_level: Optional[LogLevel] = Field(default=None, alias="LOG_LEVEL")

    rabbitmq_host: str = Field(alias="RABBITMQ_HOST", min_length=1)
    rabbitmq_port: int = Field(alias="RABBITMQ_PORT", ge=1, le=65535)
    rabbitmq_username: str = Field(alias="RABBITMQ_USERNAME", min_length=1)
    rabbitmq_password: SecretStr = Field(alias="RABBITMQ_PASSWORD")
    rabbitmq_vhost: str = Field(alias="RABBITMQ_VHOST", min_length=1)
    rabbitmq_queue: str = Field(alias="RABBITMQ_QUEUE", min_length=1)
    rabbitmq_use_tls: bool = Field(default=False, alias="RABBITMQ_USE_TLS")

    # The database can be given either as one connection string or as its
    # parts. The parts are preferred in this project because the password is
    # then URL-encoded here rather than by hand in the env file, but a plain
    # DATABASE_URI is accepted so the service can be pointed at any Postgres
    # without rewriting the file.
    database_uri_override: Optional[str] = Field(default=None, alias="DATABASE_URI")
    database_host: Optional[str] = Field(default=None, alias="DATABASE_HOST")
    database_port: Optional[int] = Field(
        default=None, alias="DATABASE_PORT", ge=1, le=65535
    )
    database_username: Optional[str] = Field(default=None, alias="DATABASE_USERNAME")
    database_password: Optional[SecretStr] = Field(
        default=None, alias="DATABASE_PASSWORD"
    )
    database_name: Optional[str] = Field(default=None, alias="DATABASE_NAME")

    @model_validator(mode="after")
    def _require_a_usable_database(self) -> "AppSettings":
        if self.database_uri_override:
            return self

        missing = [
            name
            for name, value in (
                ("DATABASE_HOST", self.database_host),
                ("DATABASE_PORT", self.database_port),
                ("DATABASE_USERNAME", self.database_username),
                ("DATABASE_PASSWORD", self.database_password),
                ("DATABASE_NAME", self.database_name),
            )
            if value in (None, "")
        ]

        if missing:
            raise ValueError(
                "Set DATABASE_URI, or all of: " + ", ".join(missing)
            )

        return self

    @property
    def effective_log_level(self) -> LogLevel:
        """LOG_LEVEL when given, otherwise a sensible default per environment."""
        if self.log_level is not None:
            return self.log_level

        return "DEBUG" if self.env == "dev" else "INFO"

    @property
    def rabbitmq_uri(self) -> str:
        scheme = "amqps" if self.rabbitmq_use_tls else "amqp"
        username = quote_plus(self.rabbitmq_username)
        password = quote_plus(self.rabbitmq_password.get_secret_value())
        vhost = quote_plus(self.rabbitmq_vhost)
        return (
            f"{scheme}://{username}:{password}"
            f"@{self.rabbitmq_host}:{self.rabbitmq_port}/{vhost}"
        )

    @property
    def database_uri(self) -> str:
        if self.database_uri_override:
            return self.database_uri_override

        assert self.database_password is not None  # guaranteed by the validator
        username = quote_plus(str(self.database_username))
        password = quote_plus(self.database_password.get_secret_value())
        return (
            f"postgresql://{username}:{password}"
            f"@{self.database_host}:{self.database_port}/{self.database_name}"
        )

    # Each environment has its own database, so the table names are the same
    # in both. Keeping them behind a property means a rename touches one place.
    @property
    def firewall_rules_table_name(self) -> str:
        return "firewall_rules"

    @property
    def processed_messages_table_name(self) -> str:
        return "processed_messages"


@lru_cache(maxsize=1)
def load_settings() -> AppSettings:
    """Validate the environment once.

    Raises rather than exiting: halting the process is the entry point's
    decision, not this module's. Every test imports this file, and an exit
    here would kill the test runner with no readable output.
    """
    try:
        return AppSettings()
    except ValidationError as exc:
        raise ConfigurationError(
            f"Invalid environment configuration:\n{exc}"
        ) from exc


settings = load_settings()