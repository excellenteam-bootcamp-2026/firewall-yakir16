from sqlalchemy import Boolean, Integer, String, UniqueConstraint, Enum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.main.config import settings
from src.domain.Rule import RuleType
import src.main.config
import uuid

class Base(DeclarativeBase):
    pass


class RuleModel(Base):
    __tablename__ = settings.firewall_rules_table_name

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)


    type: Mapped[str] = mapped_column(
        Enum("ip", "domain", "port", name="rule_type_enum", create_type=False),
        nullable=False
    )


    mode: Mapped[str] = mapped_column(
        Enum("blacklist", "whitelist", name="rule_mode_enum", create_type=False),
        nullable=False
    )

    value: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        UniqueConstraint('type', 'value', name='uix_type_value'),
    )