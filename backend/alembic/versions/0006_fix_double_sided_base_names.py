"""Normalize double-sided base card names and fix base_card_numbers

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-10

Some sets (SHD, TWI) include Base cards that are double-sided: the front is
the Base card and the back is a Token card. The CSV contains multiple records
per base card — one per token variant — distinguished by ' // ' in the name:
    'Sundari // Battle Droid'
    'Sundari // Clone Trooper'
    'Sundari // Battle Droid (Hyperspace)'
    'Sundari // Clone Trooper (Hyperspace)'

For inventory purposes these are all the same physical card. This migration:

  Step 1 — Strip token-back portions from all card names:
    'Sundari // Clone Trooper'             → 'Sundari'
    'Sundari // Battle Droid (Hyperspace)' → 'Sundari'
    (Variant info is already captured in is_hyperspace / is_foil flags.)

  Step 2 — Re-run base_card_number resolution across all sets. With names now
    normalised, hyperspace bases like 'Sundari' (card_number=295) correctly
    match their standard counterpart 'Sundari' (card_number=20) by name, and
    receive base_card_number='20'. The inventory lookup by (base_card_number,
    variant flags) then resolves correctly.

After this migration, re-run F4 Excel inventory ingestion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: strip token-back from names — take everything before ' // '
    op.execute("""
        UPDATE cards
        SET name = TRIM(SPLIT_PART(name, ' // ', 1))
        WHERE name LIKE '% // %'
    """)

    # Step 2: re-run base_card_number resolution now that names are normalised
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
    """)


def downgrade() -> None:
    # Token-back information was discarded — name stripping cannot be reversed.
    pass
