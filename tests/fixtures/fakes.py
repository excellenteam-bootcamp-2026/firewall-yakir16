from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.application.ports.RuleRepository import RuleRepository
from src.domain.Rule import Rule


class UniqueConstraintViolation(Exception):
    pass

class FakeRuleRepository(RuleRepository):
    def __init__(self, rules: Optional[List[Rule]] = None) -> None:
        self._rules: Dict[int, Rule] = {}
        self._processed: Dict[str, List[Dict[str, Any]]] = {}
        self._next_id = 1

        for rule in rules or []:
            self._insert(rule)


    @property
    def stored(self) -> List[Rule]:
        return list(self._rules.values())

    def count(self) -> int:
        return len(self._rules)

    def processed_keys(self) -> List[str]:
        return list(self._processed)


    def _insert(self, rule: Rule) -> Rule:
        key = (rule.type.value, str(rule.value))

        for existing in self._rules.values():
            if (existing.type.value, str(existing.value)) == key:
                raise UniqueConstraintViolation(
                    f"({key[0]}, {key[1]}) already exists"
                )

        rule_id = rule.id if rule.id is not None else self._next_id
        self._next_id = max(self._next_id, rule_id) + 1

        stored = Rule.create(
            rule_type=rule.type,
            mode=rule.mode,
            raw_value=rule.value,
            active=rule.active,
            rule_id=rule_id,
        ).unwrap()

        self._rules[rule_id] = stored
        return stored

    def _record(
        self, idempotency_key: Optional[str], rules: List[Rule]
    ) -> None:
        if idempotency_key:
            self._processed[idempotency_key] = [rule.to_json() for rule in rules]


    async def find_processed_result(
        self, idempotency_key: str
    ) -> Optional[List[Dict[str, Any]]]:
        return self._processed.get(idempotency_key)

    async def save_all_new(
        self, rules: List[Rule], idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        saved = [self._insert(rule) for rule in rules]
        self._record(idempotency_key, saved)
        return saved

    async def update_status(
        self, ids: List[int], active: bool, idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        updated: List[Rule] = []

        for rule_id in ids:
            rule = self._rules.get(rule_id)
            if rule is None:
                continue

            refreshed = Rule.create(
                rule_type=rule.type,
                mode=rule.mode,
                raw_value=rule.value,
                active=active,
                rule_id=rule_id,
            ).unwrap()

            self._rules[rule_id] = refreshed
            updated.append(refreshed)

        self._record(idempotency_key, updated)
        return updated

    async def delete(
        self, ids: List[int], idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        removed = [self._rules.pop(rule_id) for rule_id in ids if rule_id in self._rules]
        self._record(idempotency_key, removed)
        return removed

    async def get_all(self) -> List[Rule]:
        return list(self._rules.values())

    async def find_by_ids(self, ids: List[int]) -> List[Rule]:
        return [self._rules[rule_id] for rule_id in ids if rule_id in self._rules]

    async def find_by_type_and_values(
        self, rule_type: str, values: List[str]
    ) -> List[Rule]:
        wanted = {str(value) for value in values}
        return [
            rule
            for rule in self._rules.values()
            if rule.type.value == rule_type and str(rule.value) in wanted
        ]