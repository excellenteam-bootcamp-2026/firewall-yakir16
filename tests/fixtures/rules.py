from __future__ import annotations

from typing import Any, Dict, List, Union

from src.application.commands.firewall_commands import (
    AddRulesCommand,
    DeleteRulesCommand,
    RuleInput,
    UpdateRulesStatusCommand,
)
from src.domain.Rule import Rule

RuleValue = Union[str, int]

VALID_IPS: List[str] = [
    "0.0.0.0",
    "255.255.255.255",
    "1.1.1.1",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "8.8.8.8",
    "100.64.0.1",
    "203.0.113.1",
]

INVALID_IPS: List[Any] = [
    "256.1.1.1",
    "999.1.1.1",
    "010.1.1.1",
    "1.1.1",
    "1.1.1.1.1",
    "1.1.1.",
    "1..1.1",
    "-1.1.1.1",
    "not.an.ip.addr",
    "",
    3232235777,
]

VALID_PORTS: List[int] = [1, 65535, 22, 80, 443, 1024, 3000, 5432, 5671, 6543]

INVALID_PORTS: List[Any] = [
    0,
    -1,
    65536,
    70000,
    443.5,
    "80",
    True,
    None,
]

VALID_DOMAINS: List[str] = [
    "a.io",
    "my-site.com",
    "a.b.c.d.example.com",
    "123numeric.example.org",
    f"{'x' * 63}.com",
    "example.technology",
    "sub.domain-with-hyphens.co.uk",
    "test123.example.net",
    "a1.b2.c3.example.io",
    "archive.example.museum",
]

INVALID_DOMAINS: List[Any] = [
    "https://example.com",
    "example.com/admin",
    "example.com:8080",
    "a..b.com",
    "-foo.com",
    "foo-.com",
    "example.c",
    "example.123",
    "localhost",
    "",
    f"{'a.' * 130}com",
    42,
]


def make_rule(
    rule_type: str = "ip",
    mode: str = "blacklist",
    value: RuleValue = "1.1.1.1",
    active: bool = True,
    rule_id: int | None = None,
) -> Rule:
    result = Rule.create(
        rule_type=rule_type,
        mode=mode,
        raw_value=value,
        active=active,
        rule_id=rule_id,
    )

    if result.is_err:
        error = result.unwrap_err()
        raise AssertionError(
            f"the factory was given invalid data: {error.code} - {error.message}"
        )

    return result.unwrap()


def make_rules(values: List[RuleValue], **kwargs: Any) -> List[Rule]:
    return [make_rule(value=value, **kwargs) for value in values]


def add_command(
    values: List[RuleValue],
    rule_type: str = "ip",
    mode: str = "blacklist",
    active: bool = True,
    idempotency_key: str | None = None,
) -> AddRulesCommand:
    return AddRulesCommand(
        rule_type=rule_type,
        mode=mode,
        rules=[RuleInput(mode=mode, value=value, active=active) for value in values],
        idempotency_key=idempotency_key,
    )


def delete_command(
    ids: List[int], idempotency_key: str | None = None
) -> DeleteRulesCommand:
    return DeleteRulesCommand(ids=ids, idempotency_key=idempotency_key)


def update_command(
    ids: List[int], active: bool = False, idempotency_key: str | None = None
) -> UpdateRulesStatusCommand:
    return UpdateRulesStatusCommand(
        ids=ids, active=active, idempotency_key=idempotency_key
    )


def envelope(
    event_type: str,
    payload: Dict[str, Any],
    timestamp: str = "2026-01-01T00:00:00.000Z",
) -> Dict[str, Any]:
    return {
        "eventType": event_type,
        "timestamp": timestamp,
        "payload": payload,
    }