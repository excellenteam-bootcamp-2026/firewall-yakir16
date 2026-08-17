from typing import List, Sequence, Union, Optional
from sqlalchemy import delete, select, exists
from src.adapters.outbound.database_service import database_service
from src.application.ports.RuleRepository import RuleRepository
from src.domain.Rule import Rule
from src.adapters.outbound.schema import RuleModel


class PostgresRuleRepository(RuleRepository):

    def __init__(self) -> None:
        self._db_service = database_service

    async def check_exists(self, rule_type: str, value: str) -> bool:
        async with self._db_service.session_factory() as session:
            stmt = select(exists().where(
                RuleModel.type == rule_type,
                RuleModel.value == str(value)
            ))
            result = await session.execute(stmt)
            return result.scalar()

    async def find_by_type_and_value(self, rule_type: str, value: str) -> Optional[RuleModel]:

        async with self._db_service.session_factory() as session:
            stmt = select(RuleModel).where(
                RuleModel.type == rule_type,
                RuleModel.value == str(value)
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def save(self, rule: Rule) -> None:
        async with self._db_service.session_factory() as session:
            async with session.begin():

                db_rule = RuleModel(
                    type=rule.type,
                    mode=rule.mode,
                    value=rule.value,
                    active=rule.active
                )
                session.add(db_rule)

    async def save_all(self, rules: Sequence[Union[Rule, RuleModel]]) -> None:
        async with self._db_service.session_factory() as session:
            async with session.begin():
                for rule in rules:

                    if isinstance(rule, Rule):
                        db_rule = RuleModel(
                            id=rule.id,
                            type=rule.type,
                            mode=rule.mode,
                            value=rule.value,
                            active=rule.active
                        )
                    else:
                        db_rule = rule


                    await session.merge(db_rule)

    async def find_by_ids(self, ids: list[int]) -> Sequence[RuleModel]:
        async with self._db_service.session_factory() as session:
            stmt = select(RuleModel).where(RuleModel.id.in_(ids))
            result = await session.execute(stmt)
            return result.scalars().all()

    async def delete(self, ids: list[int]) -> None:
        async with self._db_service.session_factory() as session:
            async with session.begin():
                stmt = delete(RuleModel).where(RuleModel.id.in_(ids))
                await session.execute(stmt)

    async def get_all(self) -> Sequence[RuleModel]:
        async with self._db_service.session_factory() as session:
            stmt = select(RuleModel)
            result = await session.execute(stmt)
            return result.scalars().all()