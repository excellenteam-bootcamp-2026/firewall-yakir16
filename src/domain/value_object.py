import ipaddress
import re
from dataclasses import dataclass
from typing import Union

from option import Err, Ok, Result

from src.domain.application_error import DomainError

MAX_VALUE_LENGTH = 255

_DOMAIN_LABEL = r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
_DOMAIN_PATTERN = re.compile(rf"^(?:{_DOMAIN_LABEL}\.)+[a-zA-Z]{{2,63}}$")


@dataclass(frozen=True)
class IPAddressVO:
    value: str

    @classmethod
    def create(cls, value: str) -> Result["IPAddressVO", DomainError]:
        if not isinstance(value, str):
            return Err(
                DomainError(
                    code="INVALID_IP",
                    message="IP address must be a string.",
                )
            )

        try:
            ipaddress.IPv4Address(value)
        except ValueError:
            return Err(
                DomainError(
                    code="INVALID_IP",
                    message=f"Invalid IPv4 address format: '{value}'.",
                )
            )

        return Ok(cls(value))


@dataclass(frozen=True)
class DomainNameVO:
    value: str

    @classmethod
    def create(cls, value: str) -> Result["DomainNameVO", DomainError]:
        if not isinstance(value, str):
            return Err(
                DomainError(
                    code="INVALID_DOMAIN",
                    message="Domain must be a string.",
                )
            )

        if len(value) > MAX_VALUE_LENGTH:
            return Err(
                DomainError(
                    code="INVALID_DOMAIN",
                    message=(
                        f"Domain must be {MAX_VALUE_LENGTH} characters or fewer."
                    ),
                )
            )

        if "://" in value or "/" in value or ":" in value:
            return Err(
                DomainError(
                    code="INVALID_DOMAIN",
                    message=(
                        "Invalid domain format. "
                        "Must not include protocol, path, or port."
                    ),
                )
            )

        if not _DOMAIN_PATTERN.match(value):
            return Err(
                DomainError(
                    code="INVALID_DOMAIN",
                    message=f"Invalid domain format: '{value}'.",
                )
            )

        return Ok(cls(value))


@dataclass(frozen=True)
class PortNumberVO:
    value: int

    @classmethod
    def create(cls, value: int) -> Result["PortNumberVO", DomainError]:
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not (1 <= value <= 65535)
        ):
            return Err(
                DomainError(
                    code="INVALID_PORT",
                    message=(
                        f"Ports must be integers between 1 and 65535. Got: {value}"
                    ),
                )
            )

        return Ok(cls(value))


RuleValueType = Union[IPAddressVO, DomainNameVO, PortNumberVO]
