from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_idempotency"
down_revision: Union[str, None] = "0001_firewall_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES: tuple[str, ...] = ("processed_messages",)


def upgrade() -> None:
    for table_name in TABLES:
        op.create_table(
            table_name,
            sa.Column("message_id", sa.String(length=64), nullable=False),
            sa.Column("action", sa.String(length=32), nullable=False),
            sa.Column("result", postgresql.JSONB(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("message_id", name=f"pk_{table_name}"),
        )

        op.create_index(
            f"ix_{table_name}_created_at",
            table_name,
            ["created_at"],
        )


def downgrade() -> None:
    for table_name in reversed(TABLES):
        op.drop_index(f"ix_{table_name}_created_at", table_name=table_name)
        op.drop_table(table_name)
