import asyncio
from typing import Optional
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy import text
from src.main.config import settings
from src.main.logger import logger


class DatabaseService:
    _instance: Optional["DatabaseService"] = None

    def __init__(self) -> None:
        self.engine: Optional[AsyncEngine] = None
        self.session_factory: Optional[async_sessionmaker[AsyncSession]] = None

    @classmethod
    def get_instance(cls) -> "DatabaseService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def connect_with_retry(self, max_retries: int = 5) -> None:

        db_url = settings.database_uri
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)


        self.engine = create_async_engine(
            db_url,
            echo=False,
            pool_pre_ping=True,
            connect_args={"statement_cache_size": 0},
        )


        self.session_factory = async_sessionmaker(
            bind=self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

        attempt = 1

        initial_interval_ms = getattr(settings, "db_connection_interval", 1000)
        current_interval_seconds = initial_interval_ms / 1000.0

        while attempt <= max_retries:
            try:

                async with self.engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))

                logger.info(
                    "database_connected_successfully",
                    attempt=attempt,
                    env=settings.env,
                )
                return

            except Exception as exc:
                logger.error(
                    "database_connection_failed",
                    attempt=attempt,
                    max_retries=max_retries,
                    error=str(exc),
                )

                if attempt == max_retries:
                    logger.critical("database_max_retries_reached_halting")

                    raise SystemExit(1)

                logger.info(
                    "database_waiting_for_retry",
                    wait_seconds=current_interval_seconds,
                )
                await asyncio.sleep(current_interval_seconds)


                current_interval_seconds *= 2
                attempt += 1

    async def close(self) -> None:

        if self.engine:
            await self.engine.dispose()
            logger.info("database_connection_closed")



database_service = DatabaseService.get_instance()