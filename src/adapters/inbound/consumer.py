from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Literal, Union

from aio_pika import IncomingMessage, Message, RobustQueue
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from src.adapters.outbound.queue.rabbitmq import RabbitMQConnection, rabbitmq_connection
from src.application.commands.firewall_commands import (
    AddRulesCommand,
    DeleteRulesCommand,
    RuleInput,
    UpdateRulesStatusCommand,
)
from src.main.config import settings
from src.main.logger import logger

if TYPE_CHECKING:
    from src.application.use_cases.FirewallService import FirewallService


class RuleItem(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    id: int | None = None
    type: str = Field(min_length=1)
    mode: Literal["blacklist", "whitelist"]
    value: str | int
    active: bool


class CreateRulePayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    type: str = Field(min_length=1)
    mode: Literal["blacklist", "whitelist"]
    rules: list[RuleItem] = Field(min_length=1)


class AddRuleMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, populate_by_name=True)
    event: Literal["CREATE_RULE"] = Field(alias="eventType")
    timestamp: str
    payload: CreateRulePayload

    def to_command(self, idempotency_key: str | None) -> AddRulesCommand:
        return AddRulesCommand(
            rule_type=self.payload.type,
            mode=self.payload.mode,
            rules=[
                RuleInput(mode=item.mode, value=item.value, active=item.active)
                for item in self.payload.rules
            ],
            idempotency_key=idempotency_key,
        )


class DeleteRulePayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    ids: list[int] = Field(min_length=1)


class DeleteRuleMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, populate_by_name=True)
    event: Literal["DELETE_RULE"] = Field(alias="eventType")
    timestamp: str
    payload: DeleteRulePayload

    def to_command(self, idempotency_key: str | None) -> DeleteRulesCommand:
        return DeleteRulesCommand(
            ids=self.payload.ids,
            idempotency_key=idempotency_key,
        )


class UpdateStatusPayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    ids: list[int] = Field(min_length=1)
    active: bool


class UpdateStatusMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, populate_by_name=True)
    event: Literal["UPDATE_RULE"] = Field(alias="eventType")
    timestamp: str
    payload: UpdateStatusPayload

    def to_command(self, idempotency_key: str | None) -> UpdateRulesStatusCommand:
        return UpdateRulesStatusCommand(
            ids=self.payload.ids,
            active=self.payload.active,
            idempotency_key=idempotency_key,
        )


FirewallMessage = Union[AddRuleMessage, DeleteRuleMessage, UpdateStatusMessage]
MessageAdapter = TypeAdapter(FirewallMessage)


class FirewallRuleConsumer:
    def __init__(
        self,
        firewall_service: FirewallService,
        connection: RabbitMQConnection | None = None,
        queue_name: str | None = None,
    ) -> None:
        self._firewall_service = firewall_service
        self._connection = connection or rabbitmq_connection
        self._queue_name = queue_name or settings.rabbitmq_queue
        self._ready_event = asyncio.Event()
        self._stopped_event = asyncio.Event()
        self._queue: RobustQueue | None = None
        self._consumer_tag: str | None = None
        self._channel = None

    @property
    def ready_event(self) -> asyncio.Event:
        return self._ready_event

    async def start(self) -> None:
        connection = await self._connection.connect()
        self._channel = await connection.channel()
        await self._channel.set_qos(prefetch_count=1)

        self._queue = await self._channel.declare_queue(self._queue_name, durable=True)
        self._consumer_tag = await self._queue.consume(self._handle_message)
        self._ready_event.set()

        await self._stopped_event.wait()

    async def stop(self) -> None:
        self._stopped_event.set()
        if self._queue and self._consumer_tag:
            await self._queue.cancel(self._consumer_tag)
        await self._connection.close()

    async def _handle_message(self, message: IncomingMessage) -> None:
        async with message.process(requeue=False):
            logger.info(
                "message_received",
                queue=self._queue_name,
                message_id=message.message_id,
                redelivered=message.redelivered,
            )

            response = await self._process(message)
            await self._reply(message, response)

    async def _process(self, message: IncomingMessage) -> dict:
        try:
            parsed = MessageAdapter.validate_json(message.body)
        except ValidationError as exc:
            logger.error("invalid_message_format", error=str(exc))
            return {
                "status": "error",
                "code": "VALIDATION_ERROR",
                "message": str(exc),
            }

        idempotency_key = message.message_id or message.correlation_id
        command = parsed.to_command(idempotency_key)

        if idempotency_key:
            try:
                previous = await self._firewall_service.find_previous_result(
                    idempotency_key
                )
            except Exception:
                logger.exception("idempotency_lookup_failed", message_id=idempotency_key)
                previous = None

            if previous is not None:
                logger.info(
                    "replaying_recorded_result",
                    message_id=idempotency_key,
                    action=command.action,
                    count=len(previous),
                )
                return {"status": "success", "rules": previous}

        try:
            if isinstance(command, AddRulesCommand):
                result = await self._firewall_service.add_rules(command)
            elif isinstance(command, DeleteRulesCommand):
                result = await self._firewall_service.delete_rules(command)
            else:
                result = await self._firewall_service.update_rules_status(command)

        except IntegrityError as exc:
            logger.error(
                "integrity_error",
                action=command.action,
                message_id=idempotency_key,
                error=str(exc.orig),
            )
            return {
                "status": "error",
                "code": "RULE_ALREADY_EXISTS",
                "message": "The rule already exists in the database.",
            }

        except Exception as exc:
            logger.exception(
                "unexpected_error_processing_message",
                action=command.action,
                message_id=idempotency_key,
                error=str(exc),
            )
            return {
                "status": "error",
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred while processing the command.",
            }

        if result.is_err:
            error = result.unwrap_err()
            logger.error(
                "business_logic_error",
                action=command.action,
                error_code=error.code,
                message=error.message,
            )
            return {
                "status": "error",
                "code": error.code,
                "message": error.message,
            }

        rules = result.unwrap()
        logger.info("command_processed", action=command.action, count=len(rules))
        return {
            "status": "success",
            "rules": [rule.to_json() for rule in rules],
        }

    async def _reply(self, message: IncomingMessage, payload: dict) -> None:
        if not (message.reply_to and message.correlation_id and self._channel):
            return

        try:
            reply = Message(
                body=json.dumps(payload).encode("utf-8"),
                correlation_id=message.correlation_id,
                content_type="application/json",
            )
            await self._channel.default_exchange.publish(
                reply, routing_key=message.reply_to
            )
        except Exception as exc:
            logger.error("failed_to_send_rpc_reply", error=str(exc))
