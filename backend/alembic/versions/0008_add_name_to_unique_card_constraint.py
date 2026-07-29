"""Add name to the unique card constraint to handle shared card numbers

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-10

The original unique constraint UNIQUE(set_id, card_number, is_foil, is_organized_play)
assumes card numbers are unique per variant within a set. This assumption is violated
by a manufacturing error in SEC: Willrow Hood and Bardottan Ornithopter share the same
printed card numbers for their Foil (571) and Hyperspace Foil (817) variants.

During F3 ingestion, Willrow Hood appeared first in the CSV and was inserted. Bardottan
Ornithopter then hit ON CONFLICT DO NOTHING and was silently dropped for both variants.

Adding name to the constraint allows both cards to coexist. The inventory lookup in
excel_ingestor._lookup_card uses base_card_number (not card_number), and these two cards
have different base_card_numbers, so all lookups remain unambiguous. Idempotency of F3
re-runs is preserved because the full 5-column combination is stable per card.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_cards_set_card_number_foil_op", "cards", type_="unique")
    op.create_unique_constraint(
        "uq_cards_set_card_number_foil_op_name",
        "cards",
        ["set_id", "card_number", "is_foil", "is_organized_play", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_cards_set_card_number_foil_op_name", "cards", type_="unique")
    op.create_unique_constraint(
        "uq_cards_set_card_number_foil_op",
        "cards",
        ["set_id", "card_number", "is_foil", "is_organized_play"],
    )
