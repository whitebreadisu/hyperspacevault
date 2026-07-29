"""Fix base_card_numbers for Rio Durant and Razor Crest in JTL

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-10

Two JTL cards have base_card_number equal to their own card_number instead of
pointing to their standard card, for different root causes:

Rio Durant (standard card_number 15)
  The TCGPlayer CSV uses 'Wisecracking Wheelman' for the standard row but
  'Wisecrack Wheelman' for the Hyperspace (277) and Showcase (1011) rows.
  The name-based lookup in _assign_base_card_numbers compares exact strings,
  so the spelling difference caused both variants to retain their own card_number
  as base_card_number. Fixed directly by setting base_card_number='15' for the
  two affected rows (case-insensitive name comparison would not help here since
  the words differ, not just their case).

Razor Crest (standard card_number 223)
  The CSV uses 'Ride for Hire' for the standard row but 'Ride For Hire' (capital F)
  for all five variant rows (485, 721, 957, 1044, 1080). The exact-match lookup
  failed for all five. Fixed by a case-insensitive re-run of the base_card_number
  resolution SQL across all sets, which also guards against similar issues elsewhere.

After this migration, re-run F4 Excel inventory ingestion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Fix Rio Durant directly — spelling inconsistency cannot be caught
    # by case-insensitive comparison ('Wisecracking' vs 'Wisecrack').
    op.execute("""
        UPDATE cards
        SET base_card_number = '15'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'JTL')
          AND card_number IN ('277', '1011')
    """)

    # Step 2: Case-insensitive base_card_number resolution across all sets.
    # Fixes Razor Crest ('Ride for Hire' vs 'Ride For Hire') and any other cards
    # where variant rows differ from the standard row only in letter case.
    op.execute("""
        UPDATE cards AS c
        SET base_card_number = std.card_number
        FROM cards AS std
        WHERE c.set_id = std.set_id
          AND LOWER(c.name) = LOWER(std.name)
          AND std.is_foil = false
          AND std.is_hyperspace = false
          AND std.is_prestige = false
          AND std.is_showcase = false
          AND std.is_organized_play = false
          AND c.base_card_number != std.card_number
    """)


def downgrade() -> None:
    pass
