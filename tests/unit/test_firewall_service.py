"""The use case, driven entirely through the repository port.

No database, no queue, no pydantic — the service only ever sees command
objects and a port. That is the point of the layering, and these tests would
stop compiling the moment it stopped being true.
"""

from __future__ import annotations

import pytest

from src.application.use_cases.FirewallService import FirewallService
from tests.fixtures.fakes import FakeRuleRepository
from tests.fixtures.rules import (
    INVALID_IPS,
    INVALID_PORTS,
    add_command,
    delete_command,
    make_rule,
    update_command,
)


@pytest.fixture
def service(repository: FakeRuleRepository) -> FirewallService:
    return FirewallService(repository)


# ------------------------------------------------------------ storing rules


class TestAddRules:
    async def test_stores_a_valid_rule_through_the_port(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        result = await service.add_rules(add_command(["1.1.1.1"]))

        assert result.is_ok
        assert repository.count() == 1

        stored = repository.stored[0]
        assert stored.value == "1.1.1.1"
        assert stored.id is not None

    @pytest.mark.parametrize(
        "rule_type,values",
        [
            ("ip", ["1.1.1.1"]),
            ("ip", ["1.1.1.1", "2.2.2.2"]),
            ("ip", ["8.8.8.8", "8.8.4.4", "9.9.9.9"]),
            ("domain", ["example.com", "malware.net"]),
            ("port", [22, 443, 8080]),
        ],
    )
    async def test_stores_every_value_it_was_given(
        self,
        service: FirewallService,
        repository: FakeRuleRepository,
        rule_type: str,
        values: list,
    ) -> None:
        result = await service.add_rules(add_command(values, rule_type=rule_type))

        assert result.is_ok
        assert len(result.unwrap()) == len(values)
        assert repository.count() == len(values)

    async def test_returns_the_rules_with_the_ids_the_repository_generated(
        self, service: FirewallService
    ) -> None:
        created = (await service.add_rules(add_command(["1.1.1.1", "2.2.2.2"]))).unwrap()

        # Without these the orchestrator cannot answer the client at all.
        assert [rule.id for rule in created] == [1, 2]

    @pytest.mark.parametrize("mode", ["blacklist", "whitelist"])
    async def test_keeps_the_mode(
        self, service: FirewallService, mode: str
    ) -> None:
        created = (await service.add_rules(add_command(["1.1.1.1"], mode=mode))).unwrap()

        assert created[0].mode == mode


class TestInvalidRulesAreRejected:
    @pytest.mark.parametrize("value", INVALID_IPS)
    async def test_refuses_an_invalid_address(
        self, service: FirewallService, repository: FakeRuleRepository, value: object
    ) -> None:
        result = await service.add_rules(add_command([value]))

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_IP"
        assert repository.count() == 0

    @pytest.mark.parametrize("value", INVALID_PORTS)
    async def test_refuses_an_invalid_port(
        self, service: FirewallService, repository: FakeRuleRepository, value: object
    ) -> None:
        result = await service.add_rules(add_command([value], rule_type="port"))

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_PORT"
        assert repository.count() == 0

    async def test_refuses_an_unknown_rule_type(
        self, service: FirewallService
    ) -> None:
        result = await service.add_rules(add_command(["1.1.1.1"], rule_type="mac"))

        assert result.is_err
        assert result.unwrap_err().code == "INVALID_RULE_TYPE"

    async def test_stores_nothing_when_one_value_in_the_batch_is_invalid(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        result = await service.add_rules(
            add_command(["1.1.1.1", "2.2.2.2", "999.999.999.999"])
        )

        assert result.is_err
        # All or nothing: a partially applied batch would leave the caller
        # unable to tell what happened.
        assert repository.count() == 0


class TestEmptyCommandsAreRejected:
    async def test_an_empty_add_stores_nothing(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        result = await service.add_rules(add_command([]))

        assert result.is_ok
        assert result.unwrap() == []
        assert repository.count() == 0

    async def test_an_empty_delete_removes_nothing(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        repository._insert(make_rule(value="1.1.1.1"))

        result = await service.delete_rules(delete_command([]))

        assert result.is_ok
        assert repository.count() == 1

    async def test_an_empty_update_changes_nothing(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        repository._insert(make_rule(value="1.1.1.1"))

        result = await service.update_rules_status(update_command([], active=False))

        assert result.is_ok
        assert repository.stored[0].active is True


class TestDuplicateRulesAreNotStored:
    async def test_refuses_a_value_already_in_the_database(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        await service.add_rules(add_command(["1.1.1.1"]))

        result = await service.add_rules(add_command(["1.1.1.1"]))

        assert result.is_err
        assert result.unwrap_err().code == "RULE_ALREADY_EXISTS"
        assert repository.count() == 1

    async def test_refuses_a_value_repeated_inside_one_command(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        result = await service.add_rules(add_command(["1.1.1.1", "1.1.1.1"]))

        assert result.is_err
        assert result.unwrap_err().code == "RULE_ALREADY_EXISTS"
        assert repository.count() == 0

    async def test_names_the_offending_value(
        self, service: FirewallService
    ) -> None:
        await service.add_rules(add_command(["1.1.1.1"]))

        message = (await service.add_rules(add_command(["1.1.1.1"]))).unwrap_err().message

        assert "1.1.1.1" in message

    async def test_the_same_value_under_a_different_type_is_not_a_duplicate(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        # The constraint is on (type, value): port 80 and a domain "80" would
        # collide if it were on value alone.
        await service.add_rules(add_command([80], rule_type="port"))
        result = await service.add_rules(add_command(["a80.example.com"], rule_type="domain"))

        assert result.is_ok
        assert repository.count() == 2


class TestConflictingRulesAreRejected:
    async def test_refuses_the_opposite_mode_of_a_stored_rule(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        await service.add_rules(add_command(["1.1.1.1"], mode="blacklist"))

        result = await service.add_rules(add_command(["1.1.1.1"], mode="whitelist"))

        assert result.is_err
        assert result.unwrap_err().code == "RULE_CONFLICT"
        assert repository.count() == 1

    async def test_names_the_mode_the_rule_already_belongs_to(
        self, service: FirewallService
    ) -> None:
        await service.add_rules(add_command(["1.1.1.1"], mode="blacklist"))

        message = (
            await service.add_rules(add_command(["1.1.1.1"], mode="whitelist"))
        ).unwrap_err().message

        assert "blacklist" in message

    async def test_refuses_a_command_that_contradicts_itself(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        from src.application.commands.firewall_commands import (
            AddRulesCommand,
            RuleInput,
        )

        command = AddRulesCommand(
            rule_type="ip",
            mode="blacklist",
            rules=[
                RuleInput(mode="blacklist", value="1.1.1.1", active=True),
                RuleInput(mode="whitelist", value="1.1.1.1", active=True),
            ],
        )

        result = await service.add_rules(command)

        assert result.is_err
        assert result.unwrap_err().code == "RULE_CONFLICT"
        assert repository.count() == 0


# --------------------------------------------------------------- removing


class TestDeleteRules:
    async def test_removes_the_rules_and_returns_them_as_they_were(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        created = (await service.add_rules(add_command(["1.1.1.1", "2.2.2.2"]))).unwrap()
        ids = [rule.id for rule in created]

        result = await service.delete_rules(delete_command(ids))

        assert result.is_ok
        assert {rule.value for rule in result.unwrap()} == {"1.1.1.1", "2.2.2.2"}
        assert repository.count() == 0

    async def test_refuses_when_an_id_does_not_exist(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        created = (await service.add_rules(add_command(["1.1.1.1"]))).unwrap()

        result = await service.delete_rules(delete_command([created[0].id, 999]))

        assert result.is_err
        assert result.unwrap_err().code == "RULE_NOT_FOUND"
        # Nothing is removed when part of the request is unsatisfiable.
        assert repository.count() == 1


class TestUpdateRulesStatus:
    @pytest.mark.parametrize("active", [True, False])
    async def test_sets_the_flag_and_returns_the_updated_rules(
        self, service: FirewallService, repository: FakeRuleRepository, active: bool
    ) -> None:
        created = (
            await service.add_rules(add_command(["1.1.1.1"], active=not active))
        ).unwrap()

        result = await service.update_rules_status(
            update_command([created[0].id], active=active)
        )

        assert result.is_ok
        assert result.unwrap()[0].active is active
        assert repository.stored[0].active is active

    async def test_refuses_when_an_id_does_not_exist(
        self, service: FirewallService
    ) -> None:
        result = await service.update_rules_status(update_command([999]))

        assert result.is_err
        assert result.unwrap_err().code == "RULE_NOT_FOUND"


# ------------------------------------------------------------ idempotency


class TestARedeliveredMessageDoesNotCreateASecondEffect:
    """RabbitMQ is at-least-once, so the same command can arrive twice.

    The key is recorded in the same transaction as the write, and the consumer
    replays the recorded result instead of applying the command again.
    """

    async def test_the_key_is_recorded_with_the_write(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        await service.add_rules(add_command(["1.1.1.1"], idempotency_key="msg-1"))

        assert repository.processed_keys() == ["msg-1"]

    async def test_the_recorded_result_is_the_rules_that_were_written(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        created = (
            await service.add_rules(add_command(["1.1.1.1"], idempotency_key="msg-1"))
        ).unwrap()

        replayed = await service.find_previous_result("msg-1")

        assert replayed == [rule.to_json() for rule in created]

    async def test_an_unseen_key_has_nothing_recorded(
        self, service: FirewallService
    ) -> None:
        assert await service.find_previous_result("never-seen") is None

    async def test_replaying_returns_the_same_ids_rather_than_new_rules(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        first = (
            await service.add_rules(add_command(["1.1.1.1"], idempotency_key="msg-1"))
        ).unwrap()

        # What the consumer does on a redelivery: it looks the key up and
        # returns the recorded result without touching the use case again.
        replayed = await service.find_previous_result("msg-1")

        assert replayed is not None
        assert replayed[0]["id"] == first[0].id
        assert repository.count() == 1

    async def test_delete_and_update_record_their_keys_too(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        created = (await service.add_rules(add_command(["1.1.1.1"]))).unwrap()
        rule_id = created[0].id

        await service.update_rules_status(
            update_command([rule_id], active=False, idempotency_key="msg-update")
        )
        await service.delete_rules(
            delete_command([rule_id], idempotency_key="msg-delete")
        )

        assert set(repository.processed_keys()) == {"msg-update", "msg-delete"}

    async def test_a_command_without_a_key_records_nothing(
        self, service: FirewallService, repository: FakeRuleRepository
    ) -> None:
        await service.add_rules(add_command(["1.1.1.1"]))

        assert repository.processed_keys() == []


# --------------------------------------------------------- error structure


class TestErrorsAreStructured:
    @pytest.mark.parametrize(
        "code,build",
        [
            ("INVALID_IP", lambda: add_command(["999.1.1.1"])),
            ("INVALID_PORT", lambda: add_command([70000], rule_type="port")),
            ("INVALID_RULE_TYPE", lambda: add_command(["1.1.1.1"], rule_type="mac")),
        ],
    )
    async def test_every_failure_carries_a_stable_code_and_a_message(
        self, service: FirewallService, code: str, build
    ) -> None:
        error = (await service.add_rules(build())).unwrap_err()

        assert error.code == code
        assert isinstance(error.message, str)
        assert error.message

    async def test_serialises_to_the_documented_shape(
        self, service: FirewallService
    ) -> None:
        error = (await service.add_rules(add_command(["999.1.1.1"]))).unwrap_err()

        assert error.to_dict() == {
            "status": "error",
            "code": "INVALID_IP",
            "message": error.message,
        }