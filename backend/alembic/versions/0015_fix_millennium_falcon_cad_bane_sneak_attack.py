"""Fix name typos and insert missing variant for three cards

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-10

Three catalog issues discovered by the variant-completeness domain test:

LAW Millennium Falcon - Dodging Patrols (base card_number 68)
  The TCGPlayer CSV has a typo in the Hyperspace (332) and Hyperspace Foil (570)
  rows: 'Dodgin Patrols' (missing 'g'). The standard, Prestige, and OP records
  use the correct spelling. The name mismatch left cards 332 and 570 with
  base_card_number equal to their own card_number instead of 68.
  Fix: correct the typo, re-run base_card_number resolution.

LAW Cad Bane - Now It's My Turn (base card_number 32)
  The TCGPlayer CSV has 'Cade Bane' (extra 'e') for the standard (32),
  Hyperspace Foil (534), Prestige (818), and Prestige Foil (857) rows.
  Card 296 (Hyperspace) uses the correct spelling 'Cad Bane' and was left
  self-referencing because names didn't match.
  Fix: correct 'Cade Bane' → 'Cad Bane' on all four affected records,
  re-run base_card_number resolution.

SOR Sneak Attack (base card_number 219)
  The TCGPlayer CSV contains Standard, Foil, and Hyperspace rows but omits
  the Hyperspace Foil. For SOR (has_unique_variant_numbers=False) the
  Hyperspace Foil shares card_number with the Hyperspace (481).
  Fix: insert the missing record directly. The CSV is not corrected — F3
  ingestion uses ON CONFLICT DO NOTHING so this record will be preserved
  across re-runs even without a CSV entry.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Millennium Falcon: fix 'Dodgin' → 'Dodging' ---
    op.execute("""
        UPDATE cards
        SET name = 'Millennium Falcon - Dodging Patrols'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'LAW')
          AND card_number IN ('332', '570')
          AND name = 'Millennium Falcon - Dodgin Patrols'
    """)

    # --- Cad Bane: fix 'Cade Bane' → 'Cad Bane' ---
    op.execute("""
        UPDATE cards
        SET name = 'Cad Bane - Now It''s My Turn'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'LAW')
          AND card_number IN ('32', '534', '818', '857')
          AND name = 'Cade Bane - Now It''s My Turn'
    """)

    # --- Re-run base_card_number resolution (case-insensitive) ---
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

    # --- Sneak Attack: insert missing SOR Hyperspace Foil ---
    op.execute("""
        INSERT INTO cards
            (set_id, card_number, base_card_number, name, rarity, type,
             is_foil, is_hyperspace, is_prestige, is_showcase, is_organized_play)
        SELECT
            s.id, '481', '219', 'Sneak Attack', 'R', 'Event',
            true, true, false, false, false
        FROM sets s
        WHERE s.code = 'SOR'
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    pass
