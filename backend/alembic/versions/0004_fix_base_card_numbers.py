"""Fix base_card_number for Hyperspace and OP cards in SOR/SHD/TWI

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-09

In sets where has_unique_variant_numbers=False (SOR, SHD, TWI), the F3 ingestion
assigned base_card_number = card_number for all variants. This was correct for
Standard and Foil (which share a card_number), but wrong for Hyperspace and OP
variants, which have distinct card_numbers and should link back to the Standard
card's number — the same as all other sets.

This migration performs a self-join on the cards table to find, for each affected
variant, the Standard card with the same set_id and name, and updates
base_card_number to that Standard card's card_number.

After applying this migration, re-run the Excel inventory ingestion to import
the quantities that previously produced lookup failures.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE cards AS c
        SET base_card_number = std.card_number
        FROM cards AS std
        WHERE c.set_id = std.set_id
          AND c.name = std.name
          AND std.is_foil = false
          AND std.is_hyperspace = false
          AND std.is_prestige = false
          AND std.is_showcase = false
          AND std.is_organized_play = false
          AND c.base_card_number != std.card_number
          AND c.set_id IN (
              SELECT id FROM sets WHERE has_unique_variant_numbers = false
          )
    """)


def downgrade() -> None:
    # Restore base_card_number = card_number for all non-Standard variants
    # in non-unique sets. This reverts to the pre-fix (incorrect) state.
    op.execute("""
        UPDATE cards
        SET base_card_number = card_number
        WHERE set_id IN (
            SELECT id FROM sets WHERE has_unique_variant_numbers = false
        )
          AND (is_hyperspace = true OR is_organized_play = true)
    """)
