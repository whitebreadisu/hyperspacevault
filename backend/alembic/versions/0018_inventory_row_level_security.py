"""Enable row-level security on inventory (P4 Stage 2)

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-13

Enables and forces RLS on `inventory`, then adds a policy comparing
tenant_id to the app.current_tenant_id session variable. FORCE is
required because swu_user owns inventory, and table owners bypass RLS
by default. The policy falls back to tenant #1 when the session
variable isn't set (COALESCE bridge) -- nothing sets it until P4 Stage
3, so without the fallback every query against inventory would return
zero rows the moment this migration applies.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE inventory ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE inventory FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON inventory
        USING (tenant_id = COALESCE(current_setting('app.current_tenant_id', true)::integer, 1))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY tenant_isolation ON inventory")
    op.execute("ALTER TABLE inventory NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE inventory DISABLE ROW LEVEL SECURITY")
