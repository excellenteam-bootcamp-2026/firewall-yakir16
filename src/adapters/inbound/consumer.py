from __future__ import annotations
import asyncio
import json
from typing import Literal, Union, TYPE_CHECKING

from aio_pika import IncomingMessage, RobustQueue, Message
from pydantic import BaseModel, ConfigDict, Field, ValidationError, TypeAdapter
from src.adapters.queue.rabbitmq import RabbitMQConnection, rabbitmq_connection
from src.main.logger import logger
from src.main.config import settings

if TYPE_CHECKING:
    from src.application.use_cases.FirewallService import FirewallService


class RuleItem(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    id: int | None = None
    type: str = Field(min_length=1)
    mode: Literal["blacklist", "whitelist"]
    value: str = Field(min_length=1)
    active: bool


class CreateRulePayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    type: str = Field(min_length=1)
    mode: Literal["blacklist", "whitelist"]
    rules: list[RuleItem] = Field(min_length=1)


class AddRuleMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    event: Literal["CREATE_RULE"] = Field(alias="eventType")
    timestamp: str
    payload: CreateRulePayload

    @property
    def action(self) -> str:
        return "add"

    @property
    def rule_type(self) -> str:
        return self.payload.type


class DeleteRulePayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    ids: list[int] = Field(min_length=1)


class DeleteRuleMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    event: Literal["DELETE_RULE"] = Field(alias="eventType")
    timestamp: str
    payload: DeleteRulePayload

    @property
    def action(self) -> str:
        return "delete"

    @property
    def ids(self) -> list[int]:
        return self.payload.ids


class UpdateStatusPayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    ids: list[int] = Field(min_length=1)
    active: bool


class UpdateStatusMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    event: Literal["UPDATE_RULE"] = Field(alias="eventType")
    timestamp: str
    payload: UpdateStatusPayload

    @property
    def action(self) -> str:
        return "update_status"

    @property
    def ids(self) -> list[int]:
        return self.payload.ids

    @property
    def active(self) -> bool:
        return self.payload.active


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
            print(f" [DEBUG] Message received from queue: {self._queue_name}")
            print(f" [DEBUG] Raw payload body: {message.body.decode('utf-8')}")
            logger.info("message_received_from_queue", queue=self._queue_name)

            response_payload = {}
            has_error = False

            try:
                payload = MessageAdapter.validate_json(message.body)

                if isinstance(payload, AddRuleMessage):
                    result = await self._firewall_service.add_rules(payload)
                elif isinstance(payload, DeleteRuleMessage):
                    result = await self._firewall_service.delete_rules(payload)
                elif isinstance(payload, UpdateStatusMessage):
                    result = await self._firewall_service.update_rules_status(payload)
                else:
                    print(f" [DEBUG] Unknown action received!")
                    logger.warning("unknown_action_received", body=message.body.decode('utf-8'))
                    return

                if result.is_err:
                    has_error = True
                    error = result.unwrap_err()
                    response_payload = {
                        "status": "error",
                        "code": error.code,
                        "message": error.message
                    }
                    print(f" [BUSINESS ERROR] Code: {error.code} | Message: {error.message}")
                    logger.error(
                        "business_logic_error",
                        error_code=error.code,
                        message=error.message,
                        action=payload.action
                    )
                else:
                    data = result.unwrap() if hasattr(result, 'unwrap') else {}
                    response_payload = {
                        "status": "success",
                        "data": data
                    }
                    print(f" [SUCCESS] Rules successfully processed and saved to Supabase!")
                    logger.info("message_processed_and_saved_to_supabase_successfully", action=payload.action)

            except ValidationError as e:
                has_error = True
                response_payload = {
                    "status": "error",
                    "code": "VALIDATION_ERROR",
                    "message": str(e)
                }
                print(f" [VALIDATION ERROR] {str(e)}")
                logger.error("invalid_message_format", error=str(e), body=message.body.decode('utf-8'))

            except Exception as e:
                has_error = True
                response_payload = {
                    "status": "error",
                    "code": "INTERNAL_ERROR",
                    "message": str(e)
                }
                print(f" [UNEXPECTED ERROR] {str(e)}")
                logger.exception("unexpected_error_processing_message", error=str(e))


            if message.reply_to and message.correlation_id and self._channel:
                try:
                    reply_msg = Message(
                        body=json.dumps(response_payload).encode('utf-8'),
                        correlation_id=message.correlation_id,
                        content_type="application/json"
                    )
                    await self._channel.default_exchange.publish(
                        reply_msg,
                        routing_key=message.reply_to
                    )
                    print(f" [DEBUG] RPC Reply successfully sent back to queue: {message.reply_to}")
                except Exception as pub_err:
                    print(f" [RPC REPLY ERROR] Failed to send reply: {str(pub_err)}")
                    logger.error("failed_to_send_rpc_reply", error=str(pub_err))