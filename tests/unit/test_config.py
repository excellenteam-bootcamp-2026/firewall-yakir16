"""Configuration is validated once, at import.

Two things make this file fiddly, and both are worth knowing about.

`settings` is built the moment `src.main.config` is first imported and then
cached, so every case needs a fresh module registry.

And pydantic-settings falls back to the `.env` file when a variable is absent
from the environment. That is correct behaviour — it is how the service is
configured in the first place — but it means "delete a variable and expect a
failure" proves nothing while a real `.env.dev` sits in the project root. The
tests below pass `_env_file=None` so `os.environ` is the only source, which
makes a removed variable actually removed.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterator

import pytest
from pydantic import ValidationError

BASE_ENVIRONMENT: Dict[str, str] = {
    "ENV": "dev",
    "DB_CONNECTION_INTERVAL": "5000",
    "RABBITMQ_HOST": "localhost",
    "RABBITMQ_PORT": "5672",
    "RABBITMQ_USERNAME": "guest",
    "RABBITMQ_PASSWORD": "guest",
    "RABBITMQ_VHOST": "test",
    "RABBITMQ_QUEUE": "firewall-rules-queue-test",
    "DATABASE_HOST": "localhost",
    "DATABASE_PORT": "5432",
    "DATABASE_USERNAME": "test",
    "DATABASE_PASSWORD": "s3cr#t/p@ss",
    "DATABASE_NAME": "test",
}

MANAGED_PREFIXES = ("ENV", "DB_", "RABBITMQ_", "DATABASE_", "LOG_")


def _apply_environment(
    monkeypatch: pytest.MonkeyPatch, overrides: Dict[str, Any]
) -> None:
    for key in list(os.environ):
        if key.startswith(MANAGED_PREFIXES):
            monkeypatch.delenv(key, raising=False)

    for key, value in {**BASE_ENVIRONMENT, **overrides}.items():
        if value is None:
            continue
        monkeypatch.setenv(key, str(value))


@pytest.fixture
def load(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    """Reloads the configuration module with a chosen environment.

    Only for the few tests that need the module itself. The environment passed
    in must be valid: the module's last line calls load_settings(), so a bad
    one raises during the import rather than where the test can see it.
    """

    def _load(**overrides: Any) -> Any:
        _apply_environment(monkeypatch, overrides)
        sys.modules.pop("src.main.config", None)
        return importlib.import_module("src.main.config")

    yield _load

    sys.modules.pop("src.main.config", None)


@pytest.fixture
def settings_from(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Builds AppSettings from os.environ alone, ignoring any .env file.

    The module is imported once with a valid environment and then left alone;
    each call only changes the environment and constructs the settings class
    again. Re-importing with a broken environment would blow up on the
    module's own `settings = load_settings()` line before the assertion ran —
    which is what happens inside the container, where .dockerignore keeps the
    .env files out of the image and nothing fills the gap.

    `_env_file=None` detaches pydantic-settings from the dotenv files, so a
    deleted variable really is deleted.
    """
    _apply_environment(monkeypatch, {})
    module = importlib.import_module("src.main.config")

    def _build(**overrides: Any) -> Any:
        _apply_environment(monkeypatch, overrides)
        return module.AppSettings(_env_file=None)

    return _build


class TestAValidEnvironment:
    def test_produces_a_settings_object(self, load: Any) -> None:
        settings = load().settings

        assert settings.env == "dev"
        assert settings.rabbitmq_queue == "firewall-rules-queue-test"

    def test_converts_strings_into_typed_values(self, settings_from: Any) -> None:
        settings = settings_from(DATABASE_PORT="6543", DB_CONNECTION_INTERVAL="1500")

        assert settings.database_port == 6543
        assert settings.db_connection_interval == 1500

    def test_builds_the_database_uri_from_its_parts(self, settings_from: Any) -> None:
        uri = settings_from().database_uri

        assert uri.startswith("postgresql://test:")
        assert "@localhost:5432/test" in uri

    def test_url_encodes_the_password_rather_than_trusting_the_env_file(
        self, settings_from: Any
    ) -> None:
        # A raw '#', '/' or '@' in the password would otherwise truncate the URI.
        uri = settings_from().database_uri

        assert "s3cr#t/p@ss" not in uri
        assert "s3cr%23t%2Fp%40ss" in uri

    def test_a_supplied_uri_takes_priority_over_the_parts(
        self, settings_from: Any
    ) -> None:
        settings = settings_from(DATABASE_URI="postgresql://a:b@elsewhere:5432/other")

        assert settings.database_uri == "postgresql://a:b@elsewhere:5432/other"

    def test_a_uri_alone_is_enough(self, settings_from: Any) -> None:
        settings = settings_from(
            DATABASE_URI="postgresql://a:b@elsewhere:5432/other",
            DATABASE_HOST=None,
            DATABASE_PORT=None,
            DATABASE_USERNAME=None,
            DATABASE_PASSWORD=None,
            DATABASE_NAME=None,
        )

        assert settings.database_uri.endswith("/other")

    def test_selects_tls_for_the_broker_when_asked(self, settings_from: Any) -> None:
        assert settings_from(RABBITMQ_USE_TLS="true").rabbitmq_uri.startswith("amqps://")
        assert settings_from(RABBITMQ_USE_TLS="false").rabbitmq_uri.startswith("amqp://")

    def test_url_encodes_the_broker_credentials_too(self, settings_from: Any) -> None:
        settings = settings_from(RABBITMQ_PASSWORD="p@ss/word", RABBITMQ_VHOST="a/b")

        assert "p%40ss%2Fword" in settings.rabbitmq_uri
        assert settings.rabbitmq_uri.endswith("a%2Fb")

    def test_is_loaded_once_and_cached(self, load: Any) -> None:
        module = load()

        assert module.load_settings() is module.load_settings()
        assert module.settings is module.load_settings()


class TestTheLogLevel:
    @pytest.mark.parametrize(
        "level", ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    )
    def test_accepts_every_standard_level(
        self, settings_from: Any, level: str
    ) -> None:
        assert settings_from(LOG_LEVEL=level).effective_log_level == level

    def test_defaults_to_debug_in_dev(self, settings_from: Any) -> None:
        assert settings_from(ENV="dev").effective_log_level == "DEBUG"

    def test_defaults_to_info_in_production(self, settings_from: Any) -> None:
        assert settings_from(ENV="production").effective_log_level == "INFO"

    @pytest.mark.parametrize("level", ["VERBOSE", "debug", "TRACE", "warn"])
    def test_refuses_a_level_that_is_not_a_real_one(
        self, settings_from: Any, level: str
    ) -> None:
        with pytest.raises(ValidationError):
            settings_from(LOG_LEVEL=level)


class TestAnInvalidEnvironmentPreventsStartup:
    @pytest.mark.parametrize(
        "missing",
        [
            "RABBITMQ_HOST",
            "RABBITMQ_USERNAME",
            "RABBITMQ_PASSWORD",
            "RABBITMQ_VHOST",
            "RABBITMQ_QUEUE",
        ],
    )
    def test_refuses_when_a_required_variable_is_missing(
        self, settings_from: Any, missing: str
    ) -> None:
        with pytest.raises(ValidationError) as raised:
            settings_from(**{missing: None})

        assert missing in str(raised.value)

    def test_refuses_when_the_database_is_described_neither_way(
        self, settings_from: Any
    ) -> None:
        with pytest.raises(ValidationError) as raised:
            settings_from(
                DATABASE_HOST=None,
                DATABASE_PORT=None,
                DATABASE_USERNAME=None,
                DATABASE_PASSWORD=None,
                DATABASE_NAME=None,
            )

        assert "DATABASE_URI" in str(raised.value)

    def test_lists_every_missing_part_rather_than_only_the_first(
        self, settings_from: Any
    ) -> None:
        with pytest.raises(ValidationError) as raised:
            settings_from(DATABASE_HOST=None, DATABASE_PORT=None, DATABASE_NAME=None)

        message = str(raised.value)
        assert "DATABASE_HOST" in message
        assert "DATABASE_PORT" in message
        assert "DATABASE_NAME" in message

    @pytest.mark.parametrize(
        "key,value",
        [
            ("ENV", "staging"),
            ("ENV", "prod"),
            ("DATABASE_PORT", "70000"),
            ("DATABASE_PORT", "0"),
            ("RABBITMQ_PORT", "-1"),
            ("DB_CONNECTION_INTERVAL", "10"),
        ],
    )
    def test_refuses_a_value_outside_its_allowed_range(
        self, settings_from: Any, key: str, value: str
    ) -> None:
        with pytest.raises(ValidationError):
            settings_from(**{key: value})

    def test_load_settings_reports_the_failure_as_a_configuration_error(
        self, load: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        module = load()

        # Detach the settings class from the .env file, then ask the loader to
        # build again: this is the path the entry point takes on a bad deploy.
        monkeypatch.setitem(module.AppSettings.model_config, "env_file", None)
        monkeypatch.delenv("RABBITMQ_QUEUE", raising=False)
        module.load_settings.cache_clear()

        with pytest.raises(module.ConfigurationError) as raised:
            module.load_settings()

        assert "Invalid environment configuration" in str(raised.value)

    def test_raises_rather_than_killing_the_process(
        self, load: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # sys.exit here would take the test runner down with it, and would put
        # the decision to halt inside a module that every test imports.
        module = load()

        monkeypatch.setitem(module.AppSettings.model_config, "env_file", None)
        monkeypatch.delenv("RABBITMQ_QUEUE", raising=False)
        module.load_settings.cache_clear()

        with pytest.raises(Exception) as raised:
            module.load_settings()

        assert not isinstance(raised.value, SystemExit)


class TestEnvironmentSelectsTheCorrectDatabase:
    """Development must never reach production data."""

    def test_the_two_environments_resolve_to_different_databases(
        self, settings_from: Any
    ) -> None:
        dev = settings_from(
            ENV="dev", DATABASE_URI="postgresql://u:p@dev-host:5432/postgres"
        ).database_uri
        prod = settings_from(
            ENV="production",
            DATABASE_URI="postgresql://u:p@prod-host:5432/postgres",
        ).database_uri

        assert dev != prod
        assert "dev-host" in dev
        assert "prod-host" in prod

    def test_the_table_names_match_because_the_databases_differ(
        self, settings_from: Any
    ) -> None:
        dev = settings_from(ENV="dev")
        prod = settings_from(ENV="production")

        assert dev.firewall_rules_table_name == prod.firewall_rules_table_name
        assert dev.processed_messages_table_name == prod.processed_messages_table_name

    def test_the_real_env_files_point_at_different_hosts(self) -> None:
        """The one check that reads the deployed configuration itself.

        Skipped inside the container, where .dockerignore keeps the env files
        out of the image on purpose.
        """
        root = Path(__file__).resolve().parents[2]
        dev_file = root / ".env.dev"
        prod_file = root / ".env.prod"

        if not (dev_file.exists() and prod_file.exists()):
            pytest.skip("the environment files are not present in this checkout")

        def host_of(path: Path) -> str:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_HOST="):
                    return line.split("=", 1)[1].strip()
            return ""

        assert host_of(dev_file)
        assert host_of(dev_file) != host_of(prod_file)