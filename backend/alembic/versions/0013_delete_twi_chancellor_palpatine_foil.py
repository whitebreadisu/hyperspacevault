"""Delete erroneous plain Foil record for TWI Chancellor Palpatine - Playing Both Sides

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-10

The TCGPlayer TWI CSV contains two rows for extNumber=017/257:
  subTypeName='Normal'  → valid standard card
  subTypeName='Foil'    → data error; Leaders do not have a standalone Foil variant

The Foil row was ingested and stored as card_number='17', is_foil=True,
is_showcase=False. This record is incorrect — the only foil version of this
Leader is the Showcase (card_number=274, is_foil=True, is_showcase=True).

The source CSV has also been corrected (Foil row removed) so future F3 re-runs
will not re-insert this record.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DELETE FROM cards
        WHERE set_id = (SELECT id FROM sets WHERE code = 'TWI')
          AND card_number = '17'
          AND is_foil = true
          AND is_showcase = false
          AND is_hyperspace = false
    """)


def downgrade() -> None:
    # The source CSV row has been removed — re-inserting here would diverge
    # from the CSV. Run F3 ingestion against the original CSV to restore.
    pass
