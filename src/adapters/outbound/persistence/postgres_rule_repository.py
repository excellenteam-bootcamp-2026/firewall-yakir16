from typing import Any, Dict, List, Optional

from sqlalchemy import delete as sql_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.outbound.persistence.database_service import database_service
from src.adapters.outbound.persistence.schema import ProcessedMessageModel, RuleModel
from src.application.ports.RuleRepository import RuleRepository
from src.domain.Rule import Rule, RuleType


class PostgresRuleRepository(RuleRepository):

    def __init__(self) -> None:
        self._db_service = database_service

    @staticmethod
    def _to_domain(model: RuleModel) -> Rule:
        raw_value = (
            int(model.value) if model.type == RuleType.PORT.value else model.value
        )

        result = Rule.create(
            rule_type=model.type,
            mode=model.mode,
            raw_value=raw_value,
            active=model.active,
            rule_id=model.id,
        )

        if result.is_err:
            error = result.unwrap_err()
            raise ValueError(
                f"Stored rule {model.id} is not a valid domain rule: "
                f"{error.code} - {error.message}"
            )

        return result.unwrap()

    @staticmethod
    async def _record_processed(
        session: AsyncSession,
        idempotency_key: Optional[str],
        action: str,
        rules: List[Rule],
    ) -> None:
        if not idempotency_key:
            return

        session.add(
            ProcessedMessageModel(
                message_id=idempotency_key,
                action=action,
                result=[rule.to_json() for rule in rules],
            )
        )

    async def find_processed_result(
        self, idempotency_key: str
    ) -> Optional[List[Dict[str, Any]]]:
        async with self._db_service.session_factory() as session:
            stmt = select(ProcessedMessageModel).where(
                ProcessedMessageModel.message_id == idempotency_key
            )
            record = (await session.execute(stmt)).scalar_one_or_none()
            return list(record.result) if record is not None else None

    async def save_all_new(
        self, rules: List[Rule], idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        async with self._db_service.session_factory() as session:
            async with session.begin():
                models = [
                    RuleModel(
                        type=rule.type.value,
                        mode=rule.mode,
                        value=str(rule.value),
                        active=rule.active,
                    )
                    for rule in rules
                ]
                session.add_all(models)
                await session.flush()

                saved = [self._to_domain(model) for model in models]
                await self._record_processed(session, idempotency_key, "add", saved)
                return saved

    async def update_status(
        self, ids: List[int], active: bool, idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        async with self._db_service.session_factory() as session:
            async with session.begin():
                stmt = select(RuleModel).where(RuleModel.id.in_(ids))
                models = (await session.execute(stmt)).scalars().all()

                for model in models:
                    model.active = active

                await session.flush()

                updated = [self._to_domain(model) for model in models]
                await self._record_processed(
                    session, idempotency_key, "update_status", updated
                )
                return updated

    async def delete(
        self, ids: List[int], idempotency_key: Optional[str] = None
    ) -> List[Rule]:
        async with self._db_service.session_factory() as session:
            async with session.begin():
                stmt = select(RuleModel).where(RuleModel.id.in_(ids))
                models = (await session.execute(stmt)).scalars().all()
                removed = [self._to_domain(model) for model in models]

                await session.execute(
                    sql_delete(RuleModel).where(RuleModel.id.in_(ids))
                )
                await self._record_processed(
                    session, idempotency_key, "delete", removed
                )
                return removed

    async def find_by_ids(self, ids: List[int]) -> List[Rule]:
        async with self._db_service.session_factory() as session:
            stmt = select(RuleModel).where(RuleModel.id.in_(ids))
            models = (await session.execute(stmt)).scalars().all()
            return [self._to_domain(model) for model in models]

    async def get_all(self) -> List[Rule]:
        async with self._db_service.session_factory() as session:
            models = (await session.execute(select(RuleModel))).scalars().all()
            return [self._to_domain(model) for model in models]

    async def find_by_type_and_values(
        self, rule_type: str, values: List[str]
    ) -> List[Rule]:
        if not values:
            return []

        async with self._db_service.session_factory() as session:
            stmt = select(RuleModel).where(
                RuleModel.type == rule_type,
                RuleModel.value.in_([str(value) for value in values]),
            )
            models = (await session.execute(stmt)).scalars().all()
            return [self._to_domain(model) for model in models]
