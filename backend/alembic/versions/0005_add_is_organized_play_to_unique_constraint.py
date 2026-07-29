"""Add is_organized_play to cards unique constraint

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-09

The previous constraint UNIQUE(set_id, card_number, is_foil) did not include
is_organized_play. OP CSVs use sequential card numbers (1-29, 1-40, etc.) that
collide with base set card numbers. This caused ON CONFLICT DO NOTHING to silently
discard every OP card whose (set_id, card_number, is_foil) matched an existing
standard card — 83 records lost across SOR, SHD, TWI, JTL, LOF, and LAW.

Adding is_organized_play to the constraint allows a standard card and an OP card
to coexist at the same (set_id, card_number, is_foil) position. SEC was unaffected
because its OP card numbers start at 2000, above all standard card numbers.

After applying this migration, re-run F3 CSV ingestion (idempotent) to insert
the previously-blocked OP records, then re-run F4 Excel inventory ingestion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_cards_set_card_number_foil", "cards", type_="unique")
    op.create_unique_constraint(
        "uq_cards_set_card_number_foil_op",
        "cards",
        ["set_id", "card_number", "is_foil", "is_organized_play"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_cards_set_card_number_foil_op", "cards", type_="unique")
    op.create_unique_constraint(
        "uq_cards_set_card_number_foil",
        "cards",
        ["set_id", "card_number", "is_foil"],
    )
