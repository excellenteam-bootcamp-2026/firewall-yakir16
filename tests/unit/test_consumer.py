"""The inbound adapter, without a broker.

The consumer is the boundary: bytes arrive, pydantic decides whether they are
a message at all, and what continues inward is a plain command object. These
tests drive `_process` directly with fabricated deliveries, which is enough to
cover every path a real message can take — parsing, idempotency, the use case,
and the translation of failures into the reply contract.

A real `FirewallService` backed by `FakeRuleRepository` is used rather than a
mocked service, so the assertions are about what ended up stored rather than
about which methods were called.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import pytest
from sqlalchemy.exc import IntegrityError

from src.adapters.inbound.consumer import FirewallRuleConsumer
from src.application.use_cases.FirewallService import FirewallService
from src.domain.Rule import Rule
from tests.fixtures.fakes import FakeRuleRepository
from tests.fixtures.rules import envelope

QUEUE = "firewall-rules-queue-test"


class FakeMessage:
    """Only the attributes the consumer actually reads."""

    def __init__(
        self,
        body: Any,
        message_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        reply_to: Optional[str] = None,
        redelivered: bool = False,
    ) -> None:
        if isinstance(body, bytes):
            self.body = body
        elif isinstance(body, str):
            self.body = body.encode("utf-8")
        else:
            self.body = json.dumps(body).encode("utf-8")

        self.message_id = message_id
        self.correlation_id = correlation_id
        self.reply_to = reply_to
        self.redelivered = redelivered


class FakeExchange:
    def __init__(self) -> None:
        self.published: List[Dict[str, Any]] = []

    async def publish(self, message: Any, routing_key: str) -> None:
        self.published.append(
            {
                "routing_key": routing_key,
                "correlation_id": message.correlation_id,
                "content_type": message.content_type,
                "body": json.loads(message.body.decode("utf-8")),
            }
        )


class FakeChannel:
    def __init__(self) -> None:
        self.default_exchange = FakeExchange()


class ExplodingRepository(FakeRuleRepository):
    """Raises what Postgres raises when the unique index is violated."""

    async def save_all_new(self, rules, idempotency_key=None):  # type: ignore[no-untyped-def]
        raise IntegrityError("insert", {}, Exception("duplicate key value"))


class BrokenRepository(FakeRuleRepository):
    """Stands in for an infrastructure failure nobody anticipated."""

    async def save_all_new(self, rules, idempotency_key=None):  # type: ignore[no-untyped-def]
        raise RuntimeError("the connection pool is on fire")


@pytest.fixture
def repository() -> FakeRuleRepository:
    return FakeRuleRepository()


@pytest.fixture
def consumer(repository: FakeRuleRepository) -> FirewallRuleConsumer:
    return FirewallRuleConsumer(
        firewall_service=FirewallService(repository),
        connection=object(),  # never touched: these tests do not connect
        queue_name=QUEUE,
    )


def add_message(
    values: List[Any],
    rule_type: str = "ip",
    mode: str = "blacklist",
    **message_kwargs: Any,
) -> FakeMessage:
    payload = {
        "type": rule_type,
        "mode": mode,
        "rules": [
            {"id": None, "type": rule_type, "mode": mode, "value": value, "active": True}
            for value in values
        ],
    }
    return FakeMessage(envelope("CREATE_RULE", payload), **message_kwargs)


# ------------------------------------------------------------- translation


class TestMessagesBecomeCommands:
    async def test_a_create_message_stores_the_rules(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        reply = await consumer._process(add_message(["1.1.1.1", "2.2.2.2"]))

        assert reply["status"] == "success"
        assert len(reply["rules"]) == 2
        assert repository.count() == 2

    async def test_the_reply_carries_the_documented_rule_shape(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        reply = await consumer._process(add_message(["1.1.1.1"]))

        assert set(reply["rules"][0]) == {"id", "type", "mode", "value", "active"}
        assert reply["rules"][0]["id"] is not None

    @pytest.mark.parametrize(
        "rule_type,value",
        [("ip", "8.8.8.8"), ("domain", "example.com"), ("port", 443)],
    )
    async def test_every_rule_type_survives_the_boundary(
        self, consumer: FirewallRuleConsumer, rule_type: str, value: Any
    ) -> None:
        reply = await consumer._process(add_message([value], rule_type=rule_type))

        assert reply["status"] == "success"
        assert reply["rules"][0]["value"] == value

    async def test_a_port_arrives_as_a_number_and_stays_one(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        # The orchestrator sends ports as JSON numbers. A model that only
        # accepted strings would reject every single one.
        reply = await consumer._process(add_message([22], rule_type="port"))

        assert reply["rules"][0]["value"] == 22
        assert isinstance(reply["rules"][0]["value"], int)

    async def test_a_delete_message_removes_the_rules(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        created = await consumer._process(add_message(["1.1.1.1"]))
        rule_id = created["rules"][0]["id"]

        reply = await consumer._process(
            FakeMessage(envelope("DELETE_RULE", {"ids": [rule_id]}))
        )

        assert reply["status"] == "success"
        assert repository.count() == 0

    async def test_an_update_message_changes_the_flag(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        created = await consumer._process(add_message(["1.1.1.1"]))
        rule_id = created["rules"][0]["id"]

        reply = await consumer._process(
            FakeMessage(envelope("UPDATE_RULE", {"ids": [rule_id], "active": False}))
        )

        assert reply["rules"][0]["active"] is False
        assert repository.stored[0].active is False


# -------------------------------------------------------------- bad input


class TestMalformedDeliveries:
    @pytest.mark.parametrize(
        "body",
        [
            "not json at all",
            "",
            "[]",
            '{"eventType": "SOMETHING_ELSE", "timestamp": "t", "payload": {}}',
            '{"timestamp": "t", "payload": {}}',
            '{"eventType": "CREATE_RULE", "payload": {}}',
        ],
    )
    async def test_rejects_anything_that_is_not_a_known_message(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository, body: str
    ) -> None:
        reply = await consumer._process(FakeMessage(body))

        assert reply["status"] == "error"
        assert reply["code"] == "VALIDATION_ERROR"
        assert repository.count() == 0

    @pytest.mark.parametrize(
        "payload",
        [
            {"type": "ip", "mode": "blacklist", "rules": []},
            {"type": "ip", "mode": "greylist", "rules": [{"id": None, "type": "ip", "mode": "greylist", "value": "1.1.1.1", "active": True}]},
            {"type": "ip", "rules": [{"id": None, "type": "ip", "mode": "blacklist", "value": "1.1.1.1", "active": True}]},
        ],
    )
    async def test_rejects_a_payload_that_breaks_its_own_contract(
        self, consumer: FirewallRuleConsumer, payload: Dict[str, Any]
    ) -> None:
        reply = await consumer._process(FakeMessage(envelope("CREATE_RULE", payload)))

        assert reply["code"] == "VALIDATION_ERROR"

    async def test_rejects_an_empty_id_list(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        reply = await consumer._process(FakeMessage(envelope("DELETE_RULE", {"ids": []})))

        assert reply["code"] == "VALIDATION_ERROR"

    async def test_a_domain_failure_keeps_its_own_code(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        # Parsing succeeded; the value is simply not a valid address. The
        # client needs to be told which of the two happened.
        reply = await consumer._process(add_message(["999.1.1.1"]))

        assert reply["status"] == "error"
        assert reply["code"] == "INVALID_IP"


# ------------------------------------------------------------ idempotency


class TestARedeliveredMessageDoesNotCreateASecondEffect:
    async def test_the_second_delivery_replays_instead_of_applying(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        first = await consumer._process(add_message(["1.1.1.1"], message_id="msg-1"))
        second = await consumer._process(add_message(["1.1.1.1"], message_id="msg-1"))

        assert second == first
        # Without the check the second delivery would hit the duplicate rule
        # and come back as a 409 for a command that had in fact succeeded.
        assert repository.count() == 1

    async def test_the_replay_returns_the_original_ids(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        first = await consumer._process(add_message(["1.1.1.1"], message_id="msg-1"))
        second = await consumer._process(add_message(["1.1.1.1"], message_id="msg-1"))

        assert second["rules"][0]["id"] == first["rules"][0]["id"]

    async def test_a_different_id_is_processed_normally(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        await consumer._process(add_message(["1.1.1.1"], message_id="msg-1"))
        reply = await consumer._process(add_message(["2.2.2.2"], message_id="msg-2"))

        assert reply["status"] == "success"
        assert repository.count() == 2

    async def test_falls_back_to_the_correlation_id(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        # Some publishers set only correlation_id. Either is a usable key.
        await consumer._process(add_message(["1.1.1.1"], correlation_id="corr-1"))
        await consumer._process(add_message(["1.1.1.1"], correlation_id="corr-1"))

        assert repository.count() == 1

    async def test_a_delivery_with_no_key_is_simply_processed(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        reply = await consumer._process(add_message(["1.1.1.1"]))

        assert reply["status"] == "success"
        assert repository.processed_keys() == []

    async def test_a_failed_command_records_nothing_to_replay(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        await consumer._process(add_message(["999.1.1.1"], message_id="msg-1"))

        # Nothing was applied, so a redelivery must be free to try again.
        assert repository.processed_keys() == []


# ---------------------------------------------------------- failure paths


class TestInfrastructureFailures:
    async def test_a_unique_violation_becomes_a_business_error(
        self, repository: FakeRuleRepository
    ) -> None:
        consumer = FirewallRuleConsumer(
            firewall_service=FirewallService(ExplodingRepository()),
            connection=object(),
            queue_name=QUEUE,
        )

        reply = await consumer._process(add_message(["1.1.1.1"]))

        # A redelivery that races the original would otherwise surface as a
        # 502 for a command that had already succeeded.
        assert reply["code"] == "RULE_ALREADY_EXISTS"

    async def test_an_unexpected_failure_is_reported_without_leaking_detail(
        self,
    ) -> None:
        consumer = FirewallRuleConsumer(
            firewall_service=FirewallService(BrokenRepository()),
            connection=object(),
            queue_name=QUEUE,
        )

        reply = await consumer._process(add_message(["1.1.1.1"]))

        assert reply["code"] == "INTERNAL_ERROR"
        assert "connection pool" not in reply["message"]

    async def test_every_reply_matches_the_error_contract(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        for message in [
            FakeMessage("not json"),
            add_message(["999.1.1.1"]),
        ]:
            reply = await consumer._process(message)

            assert set(reply) == {"status", "code", "message"}
            assert reply["status"] == "error"
            assert reply["code"]
            assert reply["message"]


# ----------------------------------------------------------------- replies


class TestSendingTheReply:
    async def test_publishes_to_reply_to_with_the_same_correlation_id(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        channel = FakeChannel()
        consumer._channel = channel
        message = FakeMessage(
            envelope("CREATE_RULE", {}),
            correlation_id="corr-1",
            reply_to="amq.gen-reply",
        )

        await consumer._reply(message, {"status": "success", "rules": []})

        assert len(channel.default_exchange.published) == 1
        sent = channel.default_exchange.published[0]
        assert sent["routing_key"] == "amq.gen-reply"
        assert sent["correlation_id"] == "corr-1"
        assert sent["content_type"] == "application/json"
        assert sent["body"] == {"status": "success", "rules": []}

    @pytest.mark.parametrize(
        "correlation_id,reply_to",
        [(None, "amq.gen-reply"), ("corr-1", None), (None, None)],
    )
    async def test_stays_quiet_when_there_is_nowhere_to_answer(
        self,
        consumer: FirewallRuleConsumer,
        correlation_id: Optional[str],
        reply_to: Optional[str],
    ) -> None:
        channel = FakeChannel()
        consumer._channel = channel

        await consumer._reply(
            FakeMessage(
                envelope("CREATE_RULE", {}),
                correlation_id=correlation_id,
                reply_to=reply_to,
            ),
            {"status": "success", "rules": []},
        )

        assert channel.default_exchange.published == []

    async def test_a_publish_failure_does_not_escape(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        class RefusingChannel:
            class default_exchange:  # noqa: N801
                @staticmethod
                async def publish(*_args: Any, **_kwargs: Any) -> None:
                    raise RuntimeError("channel closed")

        consumer._channel = RefusingChannel()

        # The message has already been processed. Raising here would abort the
        # ack and cause the whole command to be redelivered.
        await consumer._reply(
            FakeMessage(
                envelope("CREATE_RULE", {}),
                correlation_id="corr-1",
                reply_to="amq.gen-reply",
            ),
            {"status": "success", "rules": []},
        )


# ------------------------------------------------------------ dependencies


class TestTheAdapterDependsInward:
    def test_it_reaches_the_repository_through_the_service(
        self, consumer: FirewallRuleConsumer, repository: FakeRuleRepository
    ) -> None:
        # The consumer asks the use case for a previous result rather than
        # reaching through it into the port. If this attribute ever comes back,
        # the arrow has turned around again.
        service = consumer._firewall_service

        assert hasattr(service, "find_previous_result")
        assert not hasattr(service, "rule_repository")

    def test_it_uses_the_queue_it_was_given(
        self, consumer: FirewallRuleConsumer
    ) -> None:
        assert consumer._queue_name == QUEUE