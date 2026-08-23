

from __future__ import annotations

from aio_pika import RobustConnection, connect_robust

from src.main.config import settings
from src.main.logger import logger


class RabbitMQConnection:


    def __init__(self, connection_url: str | None = None) -> None:
        self._connection_url = connection_url or settings.rabbitmq_uri
        self._connection: RobustConnection | None = None

    @property
    def connection(self) -> RobustConnection | None:


        return self._connection

    async def connect(self) -> RobustConnection:


        if self._connection is not None and not self._connection.is_closed:
            return self._connection

        logger.info(
            "rabbitmq_connection_attempt",
            env=settings.env,
            host=settings.rabbitmq_host,
            port=settings.rabbitmq_port,
        )

        try:
            self._connection = await connect_robust(self._connection_url)
        except Exception:
            logger.exception(
                "rabbitmq_connection_failed",
                env=settings.env,
                host=settings.rabbitmq_host,
                port=settings.rabbitmq_port,
            )
            raise

        logger.info(
            "rabbitmq_connection_success",
            env=settings.env,
            host=settings.rabbitmq_host,
            port=settings.rabbitmq_port,
        )
        return self._connection

    async def close(self) -> None:


        if self._connection is None or self._connection.is_closed:
            return

        await self._connection.close()
        logger.info(
            "rabbitmq_connection_closed",
            env=settings.env,
            host=settings.rabbitmq_host,
            port=settings.rabbitmq_port,
        )
        self._connection = None


rabbitmq_connection = RabbitMQConnection()