"""Delete accent-duplicate cards and normalize all card names

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-10

Adding normalize_card_name() to normalize.py (strip combining diacritical marks)
caused F3 re-ingestion to insert unaccented variants of already-stored cards as
new records. The expanded unique constraint from migration 0008 (which includes
name) treated 'Padme Amidala' and 'Padme Amidala' as distinct, so both were kept.
Affected cards:

  TWI: Royal Guard Attache (x2), Padme Amidala - Serving the Republic (x2),
       Padme Amidala - Pursuing Peace (x4), Padme Amidala - Serving the Republic
       (Showcase) (x1)  → 9 duplicates
  SEC: Padme Amidala - What Do You Have to Hide? (x2), Sabe - Queen's Shadow (x2)
       → 4 duplicates

Total: 13 duplicate records. The 2 correctly-inserted Bardottan Ornithopter records
(migration 0008's target) are unaffected — their names do not match any existing card
after unaccenting.

  Step 1 — Delete the newer unaccented duplicates (higher id). The older accented
    records have linked inventory rows and must be preserved.

  Step 2 — Normalize all remaining card names by stripping combining diacritical
    marks via the unaccent extension. This makes stored names match what
    normalize_card_name() in normalize.py now produces, so future F3 re-runs
    hit ON CONFLICT correctly instead of inserting new records.

After this migration, re-run F4 Excel inventory ingestion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")

    # Step 1: delete the newer accent-stripped duplicates, keeping the original
    # accented records (which carry inventory foreign keys).
    op.execute("""
        DELETE FROM cards
        WHERE id IN (
            SELECT newer.id
            FROM cards AS older
            JOIN cards AS newer
              ON  newer.set_id           = older.set_id
              AND newer.card_number      = older.card_number
              AND newer.is_foil          = older.is_foil
              AND newer.is_organized_play = older.is_organized_play
              AND newer.id               > older.id
              AND unaccent(older.name)   = newer.name
        )
    """)

    # Step 2: normalize remaining names to match normalize_card_name() output.
    op.execute("""
        UPDATE cards
        SET name = unaccent(name)
        WHERE name != unaccent(name)
    """)


def downgrade() -> None:
    # Original accented names were discarded — not reversible.
    pass
