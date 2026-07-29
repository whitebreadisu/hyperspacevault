"""Normalize accented character in Chirrut Imwe card name and fix base_card_numbers

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-10

The LAW CSV from TCGPlayer is inconsistent: the standard card (extNumber 46/264)
uses 'Chirrut Îmwe' (Î = U+00CE, Latin Capital I With Circumflex) while all four
variant rows (Hyperspace, Hyperspace Foil, Prestige, Prestige Foil) use plain
'Chirrut Imwe' (I = U+0049). The name-based join in _assign_base_card_numbers
treats these as different cards, leaving cards 310, 548, 803, and 842 with
base_card_number equal to their own card_number instead of '46'. The inventory
lookup for the Hyperspace variant then fails because no card has base_card_number
'46' with is_hyperspace=True.

This migration mirrors the fix now applied in normalize.py (normalize_card_name
strips combining diacritical marks before storage):

  Step 1 — Normalize the standard card's name to match its variants:
    'Chirrut Îmwe - I Don't Need Luck' → 'Chirrut Imwe - I Don't Need Luck'

  Step 2 — Re-run base_card_number resolution. With names now matching, cards
    310, 548, 803, and 842 resolve to base_card_number '46'.

After this migration, re-run F4 Excel inventory ingestion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: strip the circumflex accent from the standard Chirrut card name
    op.execute("""
        UPDATE cards
        SET name = 'Chirrut Imwe - I Don''t Need Luck'
        WHERE name = 'Chirrut Îmwe - I Don''t Need Luck'
    """)

    # Step 2: re-run base_card_number resolution now that names match
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
    # The original accent inconsistency was a source data error — not reversible.
    pass
