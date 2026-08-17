

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import sys
from typing import Any

import structlog


from src.main.config import settings


class AppLogger:


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



        log_level = logging.DEBUG if settings.env == "dev" else logging.INFO

        handlers: list[logging.Handler] = []


        if settings.env == "dev":

            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(log_level)
            handlers.append(console_handler)
            renderer = structlog.dev.ConsoleRenderer(colors=True)
        else:

            try:
                log_dir = Path("logs")
                log_dir.mkdir(parents=True, exist_ok=True)
                file_path = log_dir / "app.log"


                file_handler = RotatingFileHandler(
                    file_path, maxBytes=10_000_000, backupCount=5, encoding="utf-8"
                )
                file_handler.setLevel(log_level)
                handlers.append(file_handler)
            except (PermissionError, OSError) as e:

                print(f" WARNING: Failed to initialize file logger ({e}). Falling back to stdout.", file=sys.stderr)
                fallback_handler = logging.StreamHandler(sys.stderr)
                fallback_handler.setLevel(log_level)
                handlers.append(fallback_handler)


            renderer = structlog.processors.JSONRenderer()


        root_logger = logging.getLogger()
        root_logger.setLevel(log_level)
        root_logger.handlers = handlers


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


        class PrintToLogger:
            def __init__(self, level_func: Any) -> None:
                self.level_func = level_func

            def write(self, message: str) -> None:
                cleaned = message.strip()
                if cleaned:
                    self.level_func(cleaned, source="redirected_print")

            def flush(self) -> None:
                pass

        log = structlog.get_logger()
        sys.stdout = PrintToLogger(log.info)



_logger_instance = AppLogger()
logger = structlog.get_logger()