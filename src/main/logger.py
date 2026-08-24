from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, TextIO

import structlog

from src.main.config import settings


class PrintToLogger:
    """A stdout/stderr replacement that forwards writes to structlog.

    Implements enough of the file protocol that libraries probing `isatty`,
    `encoding` or `fileno` do not blow up. The reentrancy guard matters:
    logging reports its own failures on stderr, and without it a failing
    handler would recurse forever.
    """

    def __init__(self, level_func: Any, fallback: TextIO) -> None:
        self._level_func = level_func
        self._fallback = fallback
        self._in_write = False
        self.encoding = "utf-8"

    def write(self, message: str) -> int:
        if self._in_write:
            return self._fallback.write(message)

        cleaned = message.strip()
        if not cleaned:
            return len(message)

        self._in_write = True
        try:
            self._level_func(cleaned, source="redirected_print")
        except Exception:
            self._fallback.write(message)
        finally:
            self._in_write = False

        return len(message)

    def flush(self) -> None:
        self._fallback.flush()

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        return self._fallback.fileno()


class AppLogger:
    """Singleton logger.

    dev writes human-readable colour to the console; production writes JSON.
    Production also keeps a console stream alongside the rotating file: in a
    container stdout is what the platform collects, so a file-only logger
    leaves `docker logs` blind. The file remains the durable record.
    """

    _instance: AppLogger | None = None
    _initialized: bool = False

    def __new__(cls) -> AppLogger:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self._configure_logger()
        self._override_standard_outputs()
        AppLogger._initialized = True

    def _configure_logger(self) -> None:
        is_dev = settings.env == "dev"

        # The level comes from the validated configuration rather than being
        # derived here, so it can be raised or lowered per deployment without
        # a code change. When LOG_LEVEL is unset it falls back to DEBUG in dev
        # and INFO in production.
        log_level = getattr(logging, settings.effective_log_level)

        handlers: list[logging.Handler] = []

        if is_dev:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(log_level)
            handlers.append(console_handler)
            renderer: Any = structlog.dev.ConsoleRenderer(colors=True)
        else:
            try:
                log_dir = Path("logs")
                log_dir.mkdir(parents=True, exist_ok=True)

                file_handler = RotatingFileHandler(
                    log_dir / "app.log",
                    maxBytes=10_000_000,
                    backupCount=5,
                    encoding="utf-8",
                )
                file_handler.setLevel(log_level)
                handlers.append(file_handler)
            except (PermissionError, OSError) as exc:
                print(
                    f"WARNING: Failed to initialize the file logger ({exc}). "
                    "Falling back to stdout.",
                    file=sys.stderr,
                )

            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(log_level)
            handlers.append(console_handler)

            renderer = structlog.processors.JSONRenderer()

        root_logger = logging.getLogger()
        root_logger.setLevel(log_level)
        root_logger.handlers = handlers

        # Third-party libraries are far too chatty at DEBUG.
        for noisy in ("aio_pika", "aiormq", "asyncio", "sqlalchemy.engine"):
            logging.getLogger(noisy).setLevel(logging.INFO)

        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                structlog.stdlib.add_log_level,
                structlog.processors.StackInfoRenderer(),
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
            ],
            logger_factory=structlog.stdlib.LoggerFactory(),
            wrapper_class=structlog.stdlib.BoundLogger,
            cache_logger_on_first_use=True,
        )

        formatter = structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=[
                structlog.stdlib.add_log_level,
                structlog.processors.TimeStamper(fmt="iso"),
            ],
            processor=renderer,
        )

        for handler in root_logger.handlers:
            handler.setFormatter(formatter)

    def _override_standard_outputs(self) -> None:
        log = structlog.get_logger()
        sys.stdout = PrintToLogger(log.info, sys.__stdout__)
        sys.stderr = PrintToLogger(log.error, sys.__stderr__)


_logger_instance = AppLogger()
logger = structlog.get_logger()