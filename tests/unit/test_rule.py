"""The entity: it delegates validation to the value objects and refuses to
exist in an invalid state."""

from __future__ import annotations

import pytest

from src.domain.Rule import Rule, RuleType
from tests.fixtures.rules import (
    INVALID_IPS,
    VALID_DOMAINS,
    VALID_IPS,
    VALID_PORTS,
    make_rule,
)


class TestCreate:
    @pytest.mark.parametrize("value", VALID_IPS)
    def test_builds_an_ip_rule(self, value: str) -> None:
        rule = Rule.create("ip", "blacklist", value).unwrap()

        assert rule.type is RuleType.IP
        assert rule.value == value
        assert rule.active is True
        assert rule.id is None

    @pytest.mark.parametrize("value", VALID_DOMAINS)
    def test_builds_a_domain_rule(self, value: str) -> None:
        assert Rule.create("domain", "whitelist", value).unwrap().value == value

    @pytest.mark.parametrize("value", VALID_PORTS)
    def test_builds_a_port_rule(self, value: int) -> None:
        rule = Rule.create("port", "blacklist", value).unwrap()

        assert rule.value == value
        assert isinstance(rule.value, int)

    @pytest.mark.parametrize("value", INVALID_IPS)
    def test_refuses_an_invalid_value(self, value: object) -> None:
        result = Rule.create("ip", "blacklist", value)

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_IP"

    @pytest.mark.parametrize("rule_type", ["mac", "url", "", "IPV6"])
    def test_refuses_an_unknown_type(self, rule_type: str) -> None:
        result = Rule.create(rule_type, "blacklist", "1.1.1.1")

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_RULE_TYPE"

    def test_refuses_a_value_that_does_not_match_its_type(self) -> None:
        assert Rule.create("ip", "blacklist", 443).is_err
        assert Rule.create("port", "blacklist", "8.8.8.8").is_err

    def test_accepts_the_type_as_an_enum_or_a_string(self) -> None:
        from_string = Rule.create("ip", "blacklist", "1.1.1.1").unwrap()
        from_enum = Rule.create(RuleType.IP, "blacklist", "2.2.2.2").unwrap()

        assert from_string.type is from_enum.type

    def test_keeps_the_id_it_was_given(self) -> None:
        assert Rule.create("ip", "blacklist", "1.1.1.1", rule_id=42).unwrap().id == 42

    @pytest.mark.parametrize("active", [True, False])
    def test_keeps_the_active_flag(self, active: bool) -> None:
        assert Rule.create("ip", "blacklist", "1.1.1.1", active=active).unwrap().active is active

    @pytest.mark.parametrize("mode", ["blacklist", "whitelist"])
    def test_accepts_both_modes(self, mode: str) -> None:
        assert Rule.create("ip", mode, "1.1.1.1").unwrap().mode == mode


class TestToJson:
    def test_matches_the_documented_shape(self) -> None:
        rule = make_rule(rule_type="ip", mode="blacklist", value="1.1.1.1", rule_id=7)

        assert rule.to_json() == {
            "id": 7,
            "type": "ip",
            "mode": "blacklist",
            "value": "1.1.1.1",
            "active": True,
        }

    def test_serialises_the_type_as_a_plain_string(self) -> None:
        # The reply crosses a JSON boundary, so an enum would not survive.
        assert make_rule(rule_type="port", value=443).to_json()["type"] == "port"

    def test_keeps_a_port_numeric(self) -> None:
        assert make_rule(rule_type="port", value=443).to_json()["value"] == 443

    def test_leaves_the_id_absent_for_an_unsaved_rule(self) -> None:
        assert make_rule().to_json()["id"] is None