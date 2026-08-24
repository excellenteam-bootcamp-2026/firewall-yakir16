from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_firewall_rules"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES: tuple[str, ...] = ("firewall_rules",)

RULE_TYPES: tuple[str, ...] = ("ip", "domain", "port")
RULE_MODES: tuple[str, ...] = ("blacklist", "whitelist")


def upgrade() -> None:
    bind = op.get_bind()

    postgresql.ENUM(*RULE_TYPES, name="rule_type_enum").create(bind, checkfirst=True)
    postgresql.ENUM(*RULE_MODES, name="rule_mode_enum").create(bind, checkfirst=True)

    for table_name in TABLES:
        op.create_table(
            table_name,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column(
                "type",
                postgresql.ENUM(
                    *RULE_TYPES, name="rule_type_enum", create_type=False
                ),
                nullable=False,
            ),
            sa.Column(
                "mode",
                postgresql.ENUM(
                    *RULE_MODES, name="rule_mode_enum", create_type=False
                ),
                nullable=False,
            ),
            sa.Column("value", sa.String(length=255), nullable=False),
            sa.Column(
                "active",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id", name=f"pk_{table_name}"),
            sa.UniqueConstraint(
                "type", "value", name=f"uix_{table_name}_type_value"
            ),
        )


def downgrade() -> None:
    for table_name in reversed(TABLES):
        op.drop_table(table_name)

    bind = op.get_bind()
    postgresql.ENUM(name="rule_mode_enum").drop(bind, checkfirst=True)
    postgresql.ENUM(name="rule_type_enum").drop(bind, checkfirst=True)
