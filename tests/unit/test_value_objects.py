"""The value objects are the only place a raw value is checked.

Everything downstream may assume a constructed value object is valid, which
is why the boundary cases belong here rather than in the use case.
"""

from __future__ import annotations

import pytest

from src.domain.value_object import DomainNameVO, IPAddressVO, PortNumberVO
from tests.fixtures.rules import (
    INVALID_DOMAINS,
    INVALID_IPS,
    INVALID_PORTS,
    VALID_DOMAINS,
    VALID_IPS,
    VALID_PORTS,
)


class TestIPAddressVO:
    @pytest.mark.parametrize("value", VALID_IPS)
    def test_accepts_a_valid_address(self, value: str) -> None:
        result = IPAddressVO.create(value)

        assert result.is_ok
        assert result.unwrap().value == value

    @pytest.mark.parametrize("value", INVALID_IPS)
    def test_rejects_an_invalid_address(self, value: object) -> None:
        result = IPAddressVO.create(value)

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_IP"

    def test_explains_which_value_was_refused(self) -> None:
        error = IPAddressVO.create("999.1.1.1").unwrap_err()

        assert "999.1.1.1" in error.message


class TestPortNumberVO:
    @pytest.mark.parametrize("value", VALID_PORTS)
    def test_accepts_a_valid_port(self, value: int) -> None:
        result = PortNumberVO.create(value)

        assert result.is_ok
        assert result.unwrap().value == value

    @pytest.mark.parametrize("value", INVALID_PORTS)
    def test_rejects_an_invalid_port(self, value: object) -> None:
        result = PortNumberVO.create(value)

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_PORT"

    def test_rejects_a_boolean_even_though_bool_subclasses_int(self) -> None:
        # True == 1, so without an explicit check `True` would pass as port 1.
        assert PortNumberVO.create(True).is_err


class TestDomainNameVO:
    @pytest.mark.parametrize("value", VALID_DOMAINS)
    def test_accepts_a_valid_domain(self, value: str) -> None:
        result = DomainNameVO.create(value)

        assert result.is_ok
        assert result.unwrap().value == value

    @pytest.mark.parametrize("value", INVALID_DOMAINS)
    def test_rejects_an_invalid_domain(self, value: object) -> None:
        result = DomainNameVO.create(value)

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_DOMAIN"

    @pytest.mark.parametrize(
        "value",
        ["https://example.com", "example.com/admin", "example.com:8080"],
    )
    def test_names_protocol_path_and_port_as_the_reason(self, value: str) -> None:
        message = DomainNameVO.create(value).unwrap_err().message

        assert "protocol" in message or "format" in message

    def test_rejects_a_name_longer_than_the_column(self) -> None:
        too_long = f"{'a.' * 130}com"

        assert len(too_long) > 255
        assert DomainNameVO.create(too_long).is_err


class TestImmutability:
    """Value objects are frozen: once built, a value cannot drift."""

    def test_an_address_cannot_be_reassigned(self) -> None:
        address = IPAddressVO.create("1.1.1.1").unwrap()

        with pytest.raises(Exception):
            address.value = "2.2.2.2"  # type: ignore[misc]

    def test_two_objects_with_the_same_value_are_equal(self) -> None:
        assert IPAddressVO.create("1.1.1.1").unwrap() == IPAddressVO.create(
            "1.1.1.1"
        ).unwrap()