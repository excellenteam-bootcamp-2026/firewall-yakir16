from typing import Any, Dict, List, Optional

from option import Err, Ok, Result

from src.application.commands.firewall_commands import (
    AddRulesCommand,
    DeleteRulesCommand,
    UpdateRulesStatusCommand,
)
from src.application.ports.RuleRepository import RuleRepository
from src.domain.Rule import Rule
from src.domain.application_error import ApplicationError
from src.main.logger import logger


class FirewallService:
    """Depends only on the domain, the repository port, and command objects."""

    def __init__(self, rule_repository: RuleRepository) -> None:
        self._rule_repository = rule_repository

    async def find_previous_result(
        self, idempotency_key: str
    ) -> Optional[List[Dict[str, Any]]]:
        """Return the result recorded for a key, or None if it is unseen.

        Exposed here so inbound adapters never have to reach through the
        service into the repository port.
        """
        return await self._rule_repository.find_processed_result(idempotency_key)

    async def add_rules(
        self, command: AddRulesCommand
    ) -> Result[List[Rule], ApplicationError]:
        rule_type = command.rule_type
        rules_to_save: List[Rule] = []
        seen_in_payload: Dict[str, str] = {}

        lookup_values = [str(item.value) for item in command.rules]
        existing_rules = await self._rule_repository.find_by_type_and_values(
            rule_type, lookup_values
        )
        existing_by_value = {str(rule.value): rule for rule in existing_rules}

        for rule_item in command.rules:
            raw_value = rule_item.value
            lookup_value = str(raw_value)
            mode = rule_item.mode

            if lookup_value in seen_in_payload:
                existing_mode = seen_in_payload[lookup_value]
                if existing_mode != mode:
                    return Err(
                        ApplicationError(
                            code="RULE_CONFLICT",
                            message=(
                                f"Conflict in payload: rule '{lookup_value}' appears "
                                f"in both '{existing_mode}' and '{mode}' modes."
                            ),
                        )
                    )
                return Err(
                    ApplicationError(
                        code="RULE_ALREADY_EXISTS",
                        message=(
                            f"Duplicate rule '{lookup_value}' provided in the "
                            "same request payload."
                        ),
                    )
                )

            seen_in_payload[lookup_value] = mode

            existing_rule = existing_by_value.get(lookup_value)
            if existing_rule is not None:
                if existing_rule.mode != mode:
                    return Err(
                        ApplicationError(
                            code="RULE_CONFLICT",
                            message=(
                                f"Conflict: rule '{lookup_value}' already exists "
                                f"in '{existing_rule.mode}' mode."
                            ),
                        )
                    )
                return Err(
                    ApplicationError(
                        code="RULE_ALREADY_EXISTS",
                        message=(
                            f"Rule '{lookup_value}' already exists for type "
                            f"'{rule_type}'."
                        ),
                    )
                )

            creation = Rule.create(
                rule_type=rule_type,
                mode=mode,
                raw_value=raw_value,
                active=rule_item.active,
            )

            if creation.is_err:
                domain_error = creation.unwrap_err()
                return Err(
                    ApplicationError(
                        code=domain_error.code,
                        message=domain_error.message,
                    )
                )

            rules_to_save.append(creation.unwrap())

        created = await self._rule_repository.save_all_new(
            rules_to_save, command.idempotency_key
        )
        logger.info("rules_created", rule_type=rule_type, count=len(created))
        return Ok(created)

    async def delete_rules(
        self, command: DeleteRulesCommand
    ) -> Result[List[Rule], ApplicationError]:
        existing = await self._rule_repository.find_by_ids(command.ids)
        if len(existing) != len(command.ids):
            return Err(
                ApplicationError(
                    code="RULE_NOT_FOUND",
                    message="Cannot delete. Some rules were not found in the database.",
                )
            )

        removed = await self._rule_repository.delete(
            command.ids, command.idempotency_key
        )
        logger.info("rules_deleted", count=len(removed))
        return Ok(removed)

    async def update_rules_status(
        self, command: UpdateRulesStatusCommand
    ) -> Result[List[Rule], ApplicationError]:
        existing = await self._rule_repository.find_by_ids(command.ids)
        if len(existing) != len(command.ids):
            return Err(
                ApplicationError(
                    code="RULE_NOT_FOUND",
                    message="Cannot update status. Some rules were not found.",
                )
            )

        updated = await self._rule_repository.update_status(
            command.ids, command.active, command.idempotency_key
        )
        logger.info(
            "rules_status_updated", count=len(updated), active=command.active
        )
        return Ok(updated)
