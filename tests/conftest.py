
from __future__ import annotations

import os

import pytest

from tests.fixtures.fakes import FakeRuleRepository

_TEST_ENVIRONMENT = {
    "ENV": "dev",
    "DB_CONNECTION_INTERVAL": "5000",
    "RABBITMQ_HOST": "localhost",
    "RABBITMQ_PORT": "5672",
    "RABBITMQ_USERNAME": "guest",
    "RABBITMQ_PASSWORD": "guest",
    "RABBITMQ_VHOST": "test",
    "RABBITMQ_QUEUE": "firewall-rules-queue-test",
    "RABBITMQ_USE_TLS": "false",
    "DATABASE_HOST": "localhost",
    "DATABASE_PORT": "5432",
    "DATABASE_USERNAME": "test",
    "DATABASE_PASSWORD": "test",
    "DATABASE_NAME": "test",
}

for key, value in _TEST_ENVIRONMENT.items():
    os.environ[key] = value



@pytest.fixture
def repository() -> FakeRuleRepository:
    return FakeRuleRepository()