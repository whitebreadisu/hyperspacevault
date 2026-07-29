"""Replace variant string column with boolean flags

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-08

Replaces the single `variant` string column with four independent boolean
flags (is_foil, is_hyperspace, is_prestige, is_showcase). This allows any
combination of card treatments to be represented without enumerating every
possible combination as a string value.

Also updates the UniqueConstraint and CheckConstraint accordingly.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_cards_set_card_number", "cards", type_="unique")
    op.drop_constraint("ck_cards_showcase_leader_only", "cards", type_="check")

    op.drop_column("cards", "variant")

    op.add_column("cards", sa.Column(
        "is_foil", sa.Boolean(), server_default=sa.text("false"), nullable=False
    ))
    op.add_column("cards", sa.Column(
        "is_hyperspace", sa.Boolean(), server_default=sa.text("false"), nullable=False
    ))
    op.add_column("cards", sa.Column(
        "is_prestige", sa.Boolean(), server_default=sa.text("false"), nullable=False
    ))
    op.add_column("cards", sa.Column(
        "is_showcase", sa.Boolean(), server_default=sa.text("false"), nullable=False
    ))

    op.create_unique_constraint(
        "uq_cards_set_card_number_foil",
        "cards",
        ["set_id", "card_number", "is_foil"],
    )
    op.create_check_constraint(
        "ck_cards_showcase_leader_only",
        "cards",
        "NOT is_showcase OR type = 'Leader'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_cards_showcase_leader_only", "cards", type_="check")
    op.drop_constraint("uq_cards_set_card_number_foil", "cards", type_="unique")

    op.drop_column("cards", "is_showcase")
    op.drop_column("cards", "is_prestige")
    op.drop_column("cards", "is_hyperspace")
    op.drop_column("cards", "is_foil")

    op.add_column("cards", sa.Column(
        "variant", sa.String(30), server_default=sa.text("'Standard'"), nullable=False
    ))

    op.create_unique_constraint(
        "uq_cards_set_card_number",
        "cards",
        ["set_id", "card_number"],
    )
    op.create_check_constraint(
        "ck_cards_showcase_leader_only",
        "cards",
        "variant != 'Showcase' OR type = 'Leader'",
    )
