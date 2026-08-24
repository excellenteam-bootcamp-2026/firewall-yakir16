from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.main.config import settings

RULES_TABLE_NAME = settings.firewall_rules_table_name
PROCESSED_TABLE_NAME = settings.processed_messages_table_name


class Base(DeclarativeBase):
    pass


class RuleModel(Base):
    __tablename__ = RULES_TABLE_NAME

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    type: Mapped[str] = mapped_column(
        Enum("ip", "domain", "port", name="rule_type_enum", create_type=False),
        nullable=False,
    )

    mode: Mapped[str] = mapped_column(
        Enum("blacklist", "whitelist", name="rule_mode_enum", create_type=False),
        nullable=False,
    )

    value: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        UniqueConstraint("type", "value", name=f"uix_{RULES_TABLE_NAME}_type_value"),
    )


class ProcessedMessageModel(Base):
    __tablename__ = PROCESSED_TABLE_NAME

    message_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    result: Mapped[list] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
