"""Add CHECK constraint: Showcase cards must always be foil

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-09

Showcase is a premium physical variant that is always a foil card.
This constraint formalises the domain invariant enforced by the ingestion
pipeline: if is_showcase = TRUE then is_foil must also be TRUE.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_cards_showcase_always_foil",
        "cards",
        "NOT is_showcase OR is_foil",
    )


def downgrade() -> None:
    op.drop_constraint("ck_cards_showcase_always_foil", "cards", type_="check")
