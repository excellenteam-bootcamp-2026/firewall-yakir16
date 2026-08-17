import ipaddress
import re
from dataclasses import dataclass
from typing import Union
from option import Result, Ok, Err
from src.domain.application_error import DomainError
import src.domain.application_error


@dataclass(frozen=True)
class IPAddressVO:
    value: str

    @classmethod
    def create(cls, value: str) -> Result['IPAddressVO', DomainError]:
        if not isinstance(value, str):
            return Err(DomainError(code="INVALID_IP", message="IP address must be a string."))
        try:
            ipaddress.IPv4Address(value)
            return Ok(cls(value))
        except ValueError:
            return Err(DomainError(code="INVALID_IP", message=f"Invalid IPv4 address format: '{value}'."))


@dataclass(frozen=True)
class DomainNameVO:
    value: str

    @classmethod
    def create(cls, value: str) -> Result['DomainNameVO', DomainError]:
        if not isinstance(value, str):
            return Err(DomainError(code="INVALID_DOMAIN", message="Domain must be a string."))

        domain_regex = r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
        if not re.match(domain_regex, value) or "://" in value or "/" in value:
            return Err(DomainError(code="INVALID_DOMAIN", message=f"Invalid domain format: '{value}'."))

        return Ok(cls(value))


@dataclass(frozen=True)
class PortNumberVO:
    value: int

    @classmethod
    def create(cls, value: int) -> Result['PortNumberVO', DomainError]:
        if isinstance(value, bool) or not isinstance(value, int) or not (1 <= value <= 65535):
            return Err(
                DomainError(code="INVALID_PORT", message=f"Ports must be integers between 1 and 65535. Got: {value}"))
        return Ok(cls(value))



RuleValueType = Union[IPAddressVO, DomainNameVO, PortNumberVO]