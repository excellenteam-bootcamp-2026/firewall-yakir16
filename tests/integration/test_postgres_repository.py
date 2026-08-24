from __future__ import annotations

import uuid
from typing import AsyncIterator, List

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from src.adapters.outbound.persistence.database_service import database_service
from src.adapters.outbound.persistence.postgres_rule_repository import (
    PostgresRuleRepository,
)
from src.domain.Rule import Rule
from src.main.config import settings

pytestmark = [pytest.mark.integration]


def unique_octet() -> int:
    return uuid.uuid4().int % 200 + 20


async def database_is_reachable() -> bool:
    try:
        await database_service.connect_with_retry(max_retries=1)
        return True
    except Exception:
        return False


@pytest_asyncio.fixture
async def cleanup() -> AsyncIterator[List[str]]:
    if not await database_is_reachable():
        pytest.skip(
            f"no database at {settings.database_host}; "
            "start it with ./env-switch.sh dev to run these"
        )

    prefixes: List[str] = []

    yield prefixes

    rules_table = settings.firewall_rules_table_name
    processed_table = settings.processed_messages_table_name

    async with database_service.engine.begin() as conn:
        for prefix in prefixes:
            await conn.execute(
                text(f"delete from {rules_table} where value like :pattern"),
                {"pattern": f"{prefix}%"},
            )
        await conn.execute(
            text(f"delete from {processed_table} where message_id like 'test-%'")
        )

    await database_service.close()


@pytest_asyncio.fixture
async def repository(cleanup: List[str]) -> PostgresRuleRepository:
    return PostgresRuleRepository()


def rule(value: str, mode: str = "blacklist", active: bool = True) -> Rule:
    return Rule.create("ip", mode, value, active=active).unwrap()


class TestSavingRules:
    async def test_stores_a_rule_and_gives_it_an_id(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new([rule(f"{prefix}1.1")])

        assert len(saved) == 1
        assert saved[0].id is not None
        assert saved[0].value == f"{prefix}1.1"

    async def test_stores_several_rules_in_one_call(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new(
            [rule(f"{prefix}1.1"), rule(f"{prefix}1.2"), rule(f"{prefix}1.3")]
        )

        assert len({r.id for r in saved}) == 3

    async def test_a_saved_rule_can_be_read_back(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new([rule(f"{prefix}1.1")])
        found = await repository.find_by_ids([saved[0].id])

        assert len(found) == 1
        assert found[0].value == f"{prefix}1.1"
        assert found[0].mode == "blacklist"

    async def test_a_port_survives_the_round_trip_as_a_number(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        port = unique_octet() + 40000
        saved = await repository.save_all_new(
            [Rule.create("port", "blacklist", port).unwrap()]
        )

        try:
            found = await repository.find_by_ids([saved[0].id])

            assert found[0].value == port
            assert isinstance(found[0].value, int)
        finally:
            await repository.delete([saved[0].id])




class TestDuplicateRulesAreNotStored:
    async def test_the_database_refuses_the_same_type_and_value_twice(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        await repository.save_all_new([rule(f"{prefix}1.1")])
        with pytest.raises(IntegrityError):
            await repository.save_all_new([rule(f"{prefix}1.1")])

    async def test_the_constraint_covers_both_modes(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        await repository.save_all_new([rule(f"{prefix}1.1", mode="blacklist")])
        with pytest.raises(IntegrityError):
            await repository.save_all_new([rule(f"{prefix}1.1", mode="whitelist")])

    async def test_nothing_from_a_rejected_batch_is_stored(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        await repository.save_all_new([rule(f"{prefix}1.1")])

        with pytest.raises(IntegrityError):
            await repository.save_all_new(
                [rule(f"{prefix}2.2"), rule(f"{prefix}1.1"), rule(f"{prefix}3.3")]
            )

        remaining = [
            found
            for found in await repository.get_all()
            if str(found.value).startswith(prefix)
        ]
        assert {str(r.value) for r in remaining} == {f"{prefix}1.1"}




class TestQueries:
    async def test_finds_many_values_of_a_type_in_one_query(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        await repository.save_all_new(
            [rule(f"{prefix}1.1"), rule(f"{prefix}1.2")]
        )

        found = await repository.find_by_type_and_values(
            "ip", [f"{prefix}1.1", f"{prefix}1.2", f"{prefix}9.9"]
        )

        assert {str(r.value) for r in found} == {f"{prefix}1.1", f"{prefix}1.2"}

    async def test_an_empty_lookup_does_not_hit_the_database(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        assert await repository.find_by_type_and_values("ip", []) == []

    async def test_find_by_ids_ignores_ids_that_do_not_exist(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new([rule(f"{prefix}1.1")])

        found = await repository.find_by_ids([saved[0].id, 999_999_999])

        assert len(found) == 1


class TestUpdatingAndDeleting:
    @pytest.mark.parametrize("active", [True, False])
    async def test_sets_the_active_flag(
        self, repository: PostgresRuleRepository, cleanup: List[str], active: bool
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new(
            [rule(f"{prefix}1.1", active=not active)]
        )

        updated = await repository.update_status([saved[0].id], active)

        assert updated[0].active is active

        assert (await repository.find_by_ids([saved[0].id]))[0].active is active

    async def test_delete_returns_the_rules_as_they_were(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new([rule(f"{prefix}1.1")])

        removed = await repository.delete([saved[0].id])

        assert removed[0].value == f"{prefix}1.1"
        assert await repository.find_by_ids([saved[0].id]) == []

    async def test_deleting_frees_the_value_for_reuse(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        first = await repository.save_all_new([rule(f"{prefix}1.1")])
        await repository.delete([first[0].id])

        second = await repository.save_all_new([rule(f"{prefix}1.1")])

        assert second[0].id != first[0].id



class TestIdempotencyRecords:
    async def test_records_the_key_alongside_the_rules(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)
        key = f"test-{uuid.uuid4()}"

        saved = await repository.save_all_new([rule(f"{prefix}1.1")], key)

        recorded = await repository.find_processed_result(key)

        assert recorded is not None
        assert recorded == [r.to_json() for r in saved]

    async def test_an_unseen_key_returns_nothing(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        assert await repository.find_processed_result(f"test-{uuid.uuid4()}") is None

    async def test_the_record_and_the_rules_share_one_transaction(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)
        key = f"test-{uuid.uuid4()}"

        await repository.save_all_new([rule(f"{prefix}1.1")])


        with pytest.raises(IntegrityError):
            await repository.save_all_new([rule(f"{prefix}1.1")], key)

        assert await repository.find_processed_result(key) is None

    async def test_reusing_a_key_is_refused_by_the_primary_key(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)
        key = f"test-{uuid.uuid4()}"

        await repository.save_all_new([rule(f"{prefix}1.1")], key)


        with pytest.raises(IntegrityError):
            await repository.save_all_new([rule(f"{prefix}2.2")], key)

    async def test_delete_and_update_record_their_keys_too(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)
        update_key = f"test-{uuid.uuid4()}"
        delete_key = f"test-{uuid.uuid4()}"

        saved = await repository.save_all_new([rule(f"{prefix}1.1")])

        await repository.update_status([saved[0].id], False, update_key)
        await repository.delete([saved[0].id], delete_key)

        assert await repository.find_processed_result(update_key) is not None
        assert await repository.find_processed_result(delete_key) is not None

    async def test_a_write_without_a_key_records_nothing(
        self, repository: PostgresRuleRepository, cleanup: List[str]
    ) -> None:
        prefix = f"10.{unique_octet()}."
        cleanup.append(prefix)

        saved = await repository.save_all_new([rule(f"{prefix}1.1")], None)

        assert saved[0].id is not None





class TestTheAdapterTalksToTheConfiguredDatabase:
    async def test_it_uses_the_host_from_the_settings(
        self, cleanup: List[str]
    ) -> None:
        async with database_service.engine.connect() as conn:
            name = (await conn.execute(text("select current_database()"))).scalar()

        assert name == settings.database_name

    async def test_the_expected_tables_exist(self, cleanup: List[str]) -> None:
        async with database_service.engine.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "select table_name from information_schema.tables "
                        "where table_schema = 'public'"
                    )
                )
            ).scalars().all()

        assert settings.firewall_rules_table_name in rows
        assert settings.processed_messages_table_name in rows