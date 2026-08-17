from enum import Enum
from typing import Any, Dict, Literal, Optional, Union
from option import Result, Ok, Err
from src.domain.application_error import DomainError

from src.domain.value_object import IPAddressVO, DomainNameVO, PortNumberVO, RuleValueType


class RuleType(str, Enum):
    IP = "ip"
    DOMAIN = "domain"
    PORT = "port"


RuleMode = Literal["blacklist", "whitelist"]


class Rule:
    def __init__(
            self,
            rule_type: RuleType,
            mode: RuleMode,
            rule_value: RuleValueType,
            active: bool,
            rule_id: Optional[int] = None,
    ) -> None:
        self.id = rule_id
        self.type = rule_type
        self.mode = mode
        self._rule_value = rule_value
        self._active = active

    @property
    def value(self) -> Union[str, int]:

        return self._rule_value.value

    @property
    def active(self) -> bool:
        return self._active

    def update_status(self, is_active: bool) -> None:
        self._active = is_active

    @classmethod
    def create(
            cls,
            rule_type: Union[RuleType, str],
            mode: RuleMode,
            raw_value: Union[str, int],
            active: bool = True,
            rule_id: Optional[int] = None,
    ) -> Result['Rule', DomainError]:

        try:
            r_type = RuleType(rule_type)
        except ValueError:
            return Err(DomainError("INVALID_RULE_TYPE", f"Unsupported rule type: '{rule_type}'."))


        if r_type == RuleType.IP:
            vo_result = IPAddressVO.create(raw_value)
        elif r_type == RuleType.DOMAIN:
            vo_result = DomainNameVO.create(raw_value)
        elif r_type == RuleType.PORT:
            vo_result = PortNumberVO.create(raw_value)
        else:
            return Err(DomainError("UNKNOWN_ERROR", "Unknown rule type logic."))


        if vo_result.is_err:
            return Err(vo_result.unwrap_err())


        valid_vo = vo_result.unwrap()

        return Ok(cls(
            rule_type=r_type,
            mode=mode,
            rule_value=valid_vo,
            active=active,
            rule_id=rule_id
        ))

    def to_json(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "mode": self.mode,
            "value": self.value,
            "active": self._active,
        }