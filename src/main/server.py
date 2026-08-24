from __future__ import annotations

import asyncio
import signal
import sys

from src.adapters.inbound.consumer import FirewallRuleConsumer
from src.adapters.outbound.persistence.database_service import database_service
from src.adapters.outbound.persistence.postgres_rule_repository import PostgresRuleRepository
from src.application.use_cases.FirewallService import FirewallService
from src.main.logger import logger


async def bootstrap() -> None:
    await database_service.connect_with_retry()

    rule_repository = PostgresRuleRepository()
    firewall_service = FirewallService(rule_repository)
    consumer = FirewallRuleConsumer(firewall_service=firewall_service)

    consumer_task = asyncio.create_task(consumer.start())
    ready_task = asyncio.create_task(consumer.ready_event.wait())

    # If start() raises, ready_event is never set. Waiting on it alone would
    # hang forever: no crash, no log, and no restart, because Docker sees a
    # healthy container. Racing the two tasks surfaces the failure instead.
    done, _ = await asyncio.wait(
        {consumer_task, ready_task},
        return_when=asyncio.FIRST_COMPLETED,
    )

    if consumer_task in done:
        ready_task.cancel()
        await database_service.close()
        consumer_task.result()  # re-raises the startup failure
        raise RuntimeError("The consumer stopped before it became ready.")

    logger.info("Server is running and listening for RabbitMQ messages...")

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)

    await stop_event.wait()

    logger.info("Shutting down server...")
    await consumer.stop()
    await consumer_task
    await database_service.close()
    logger.info("Server stopped successfully.")


def main() -> None:
    try:
        asyncio.run(bootstrap())
    except Exception as exc:
        # The logger may not exist yet if configuration failed, so write to the
        # real stderr rather than through structlog.
        sys.__stderr__.write(f"CRITICAL: the server could not start: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
