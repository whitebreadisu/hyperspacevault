"""Rename ix_inventory_card_id to ix_inventory_variant_id

The index on inventory.variant_id kept its card_id-era name from migration
0001 after 0022 renamed the column. The ORM model's index=True expects the
name ix_inventory_variant_id, which made `alembic check` report a drop plus
an add. A rename is metadata-only (no index rebuild, no lock beyond the
catalog update), so it is safe on a live table.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER INDEX ix_inventory_card_id RENAME TO ix_inventory_variant_id")


def downgrade() -> None:
    op.execute("ALTER INDEX ix_inventory_variant_id RENAME TO ix_inventory_card_id")
