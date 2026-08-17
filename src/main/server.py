import asyncio
import signal

from src.adapters.outbound.database_service import database_service
from src.adapters.outbound.postgres_rule_repository import PostgresRuleRepository
from src.application.use_cases.FirewallService import FirewallService
from src.adapters.inbound.consumer import FirewallRuleConsumer
from src.main.logger import logger


async def bootstrap() -> None:

    await database_service.connect_with_retry()

    rule_repository = PostgresRuleRepository()
    firewall_service = FirewallService(rule_repository)


    consumer = FirewallRuleConsumer(firewall_service=firewall_service)


    consumer_task = asyncio.create_task(consumer.start())
    await consumer.ready_event.wait()
    logger.info("Server is running and listening for RabbitMQ messages...")


    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)


    await stop_event.wait()


    logger.info("Shutting down server...")
    await consumer.stop()
    await consumer_task
    logger.info("Server stopped successfully.")


if __name__ == "__main__":
    asyncio.run(bootstrap())