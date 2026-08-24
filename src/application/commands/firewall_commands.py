from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Union

RuleValue = Union[str, int]
RuleMode = str


@dataclass(frozen=True)
class RuleInput:
    mode: RuleMode
    value: RuleValue
    active: bool = True


@dataclass(frozen=True)
class AddRulesCommand:
    rule_type: str
    mode: RuleMode
    rules: List[RuleInput] = field(default_factory=list)
    idempotency_key: Optional[str] = None

    @property
    def action(self) -> str:
        return "add"


@dataclass(frozen=True)
class DeleteRulesCommand:
    ids: List[int] = field(default_factory=list)
    idempotency_key: Optional[str] = None

    @property
    def action(self) -> str:
        return "delete"


@dataclass(frozen=True)
class UpdateRulesStatusCommand:
    ids: List[int] = field(default_factory=list)
    active: bool = True
    idempotency_key: Optional[str] = None

    @property
    def action(self) -> str:
        return "update_status"


FirewallCommand = Union[
    AddRulesCommand,
    DeleteRulesCommand,
    UpdateRulesStatusCommand,
]
