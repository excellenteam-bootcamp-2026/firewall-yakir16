import asyncio
from typing import Dict
from option import Result, Ok, Err
from src.domain.application_error import ApplicationError
from src.domain.Rule import Rule, RuleType
from src.application.ports.RuleRepository import RuleRepository

from src.adapters.inbound.consumer import AddRuleMessage, DeleteRuleMessage, UpdateStatusMessage


class FirewallService:

    def __init__(self, rule_repository: RuleRepository) -> None:
        self.rule_repository = rule_repository

    async def add_rules(self, command: AddRuleMessage) -> Result[None, ApplicationError]:
        rule_type = command.rule_type
        print(f"🔍 [DEBUG] Starting add_rules for type: {rule_type}")

        rules_to_save = []
        seen_in_payload: Dict[str, str] = {}

        for rule_item in command.payload.rules:
            value = str(rule_item.value)
            mode = rule_item.mode

            if value in seen_in_payload:
                existing_mode = seen_in_payload[value]
                if existing_mode != mode:
                    print(f" [DEBUG] Intra-payload conflict for value: {value}")
                    return Err(ApplicationError(
                        code="RULE_CONFLICT",
                        message=f"Conflict in payload: Rule '{value}' appears in both '{existing_mode}' and '{mode}' modes."
                    ))
                print(f" [DEBUG] Duplicate value in payload: {value}")
                return Err(ApplicationError(
                    code="RULE_ALREADY_EXISTS",
                    message=f"Duplicate rule '{value}' provided in the same request payload."
                ))

            seen_in_payload[value] = mode


            print(f" [DEBUG] Checking database for existing rule: {value}")
            existing_rule = await self.rule_repository.find_by_type_and_value(rule_type, value)

            if existing_rule:
                if existing_rule.mode != mode:
                    print(f" [DEBUG] Rule conflict detected in DB for value: {value}")
                    return Err(ApplicationError(
                        code="RULE_CONFLICT",
                        message=f"Conflict: Rule '{value}' already exists in '{existing_rule.mode}' mode."
                    ))
                print(f" [DEBUG] Rule already exists in DB: {value}")
                return Err(ApplicationError(
                    code="RULE_ALREADY_EXISTS",
                    message=f"Rule '{value}' already exists for type '{rule_type}'."
                ))


            print(f" [DEBUG] Creating domain rule for: {value}")
            rule_creation_result = Rule.create(
                rule_type=rule_type,
                mode=mode,
                raw_value=value,
                active=rule_item.active
            )

            if rule_creation_result.is_err:
                domain_err = rule_creation_result.unwrap_err()
                print(f" [DEBUG] Domain creation error: {domain_err.code} - {domain_err.message}")
                return Err(ApplicationError(
                    code=domain_err.code,
                    message=domain_err.message
                ))

            new_rule = rule_creation_result.unwrap()
            rules_to_save.append(new_rule)


        print(f" [DEBUG] Saving {len(rules_to_save)} rules to database...")
        for rule in rules_to_save:
            await self.rule_repository.save(rule)

        print(f" [DEBUG] Save completed successfully!")
        return Ok(None)

    async def delete_rules(self, command: DeleteRuleMessage) -> Result[None, ApplicationError]:
        ids = command.ids

        existing = await self.rule_repository.find_by_ids(ids)
        if len(existing) != len(ids):
            return Err(ApplicationError(
                code="RULE_NOT_FOUND",
                message="Cannot delete. Some rules were not found in the database."
            ))

        await self.rule_repository.delete(ids)
        return Ok(None)

    async def update_rules_status(self, command: UpdateStatusMessage) -> Result[None, ApplicationError]:
        ids = command.ids
        active = command.active

        existing_rules = await self.rule_repository.find_by_ids(ids)
        if len(existing_rules) != len(ids):
            return Err(ApplicationError(
                code="RULE_NOT_FOUND",
                message="Cannot update status. Some rules were not found."
            ))


        for rule_model in existing_rules:
            rule_model.active = active

        await self.rule_repository.save_all(existing_rules)
        return Ok(None)