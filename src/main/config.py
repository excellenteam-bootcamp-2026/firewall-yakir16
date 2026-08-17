from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
import sys
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "PyRuleBuilder"
DEFAULT_TIMEOUT_SECONDS = 30

PROJECT_ROOT = Path(__file__).resolve().parents[1]

current_env = os.getenv("ENV", "dev")

ENV_FILE_FALLBACK = PROJECT_ROOT / ".env"
ENV_FILE_SPECIFIC = PROJECT_ROOT / f".env.{current_env}"


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ENV_FILE_FALLBACK, ENV_FILE_SPECIFIC) if ENV_FILE_SPECIFIC.exists() else ENV_FILE_FALLBACK,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    env: Literal["dev", "production"] = Field(alias="ENV", default="dev")
    port: int = Field(default=8000, alias="PORT", ge=1, le=65535)

    rabbitmq_host: str = Field(alias="RABBITMQ_HOST", min_length=1)
    rabbitmq_port: int = Field(alias="RABBITMQ_PORT", ge=1, le=65535)
    rabbitmq_username: str = Field(alias="RABBITMQ_USERNAME", min_length=1)
    rabbitmq_password: SecretStr = Field(alias="RABBITMQ_PASSWORD")
    rabbitmq_vhost: str = Field(alias="RABBITMQ_VHOST", min_length=1)
    rabbitmq_queue: str = Field(alias="RABBITMQ_QUEUE", min_length=1)

    database_host: str = Field(alias="DATABASE_HOST", min_length=1)
    database_port: int = Field(alias="DATABASE_PORT", ge=1, le=65535)
    database_username: str = Field(alias="DATABASE_USERNAME", min_length=1)
    database_password: SecretStr = Field(alias="DATABASE_PASSWORD")
    database_name: str = Field(alias="DATABASE_NAME", min_length=1)

    @property
    def rabbitmq_uri(self) -> str:
        username = quote_plus(self.rabbitmq_username)
        password = quote_plus(self.rabbitmq_password.get_secret_value())
        vhost = quote_plus(self.rabbitmq_vhost)
        return f"amqp://{username}:{password}@{self.rabbitmq_host}:{self.rabbitmq_port}/{vhost}"

    @property
    def database_uri(self) -> str:
        username = quote_plus(self.database_username)
        password = quote_plus(self.database_password.get_secret_value())
        host = self.database_host
        port = self.database_port
        db_name = self.database_name
        return f"postgresql://{username}:{password}@{host}:{port}/{db_name}"

    @property
    def firewall_rules_table_name(self) -> str:
        return "firewall_rules_dev" if self.env == "dev" else "firewall_rules"


@lru_cache(maxsize=1)
def load_settings() -> AppSettings:
    try:
        return AppSettings()
    except ValidationError as e:
        print(" CRITICAL: Environment configuration error! Server halting.", file=sys.stderr)
        print(e, file=sys.stderr)
        sys.exit(1)


settings = load_settings()