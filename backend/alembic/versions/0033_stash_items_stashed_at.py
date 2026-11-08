"""Add stash_items.stashed_at (BL-344 R1-16: the Stashes page's "Recently
stashed" sort)

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-08

When copies of a printing last went INTO a stash: set when the row is
created and whenever its quantity rises (a card-detail split, an Undo
restore); kept when the quantity falls (a return) or a split rewrite leaves
it unchanged (app/repositories/stashes.py). Rows that exist before this
migration take the migration time: their real stash time was never stored.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stash_items",
        sa.Column(
            "stashed_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("stash_items", "stashed_at")
