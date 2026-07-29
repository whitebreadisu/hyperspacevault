"""Strip '(Showcase)' suffix from stored card names and re-link base_card_numbers

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-10

Showcase cards were stored with their suffix in the name
(e.g. 'Kylo Ren (Showcase)') while all other variant suffixes are stripped
before storage. This prevented _assign_base_card_numbers from matching
Showcase cards to their standard card by name, leaving them self-referencing
in sets with unique variant numbers (LOF, SEC, JTL, LAW).

This migration mirrors the fix applied to normalize.py (strip_from_name=True
for the Showcase suffix):

  Step 1 — Strip ' (Showcase)' from all card names.
    'Kylo Ren - We're Not Done Yet (Showcase)' → 'Kylo Ren - We're Not Done Yet'
    The is_showcase=True flag already captures the variant type.

  Step 2 — Re-run case-insensitive base_card_number resolution. Showcase cards
    whose names now match their standard card will receive the correct
    base_card_number instead of self-referencing.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: strip the suffix from all Showcase card names
    op.execute("""
        UPDATE cards
        SET name = TRIM(REPLACE(name, ' (Showcase)', ''))
        WHERE name LIKE '% (Showcase)'
    """)

    # Step 2: re-run base_card_number resolution
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
    # Suffix information is captured in is_showcase=True — not reversible.
    pass
