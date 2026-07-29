"""Add tenant_settings (BL-35 hard/soft keep-limit enforcement mode)

Revision ID: 0026
Revises: 0025
Create Date: 2026-07-13

BL-35: one row per tenant holding the cap_mode (hard/soft) keep-limit
enforcement toggle -- "hard" blocks an increment at/over the variant's
effective keep-limit with reason "trade_sell" (the pre-BL-35 behavior,
unchanged); "soft" commits the increment and flags the response
over_limit=True instead (see app/services/inventory.py's increment_card).
The 999 QUANTITY_CEILING still blocks unconditionally in both modes.

Rows are created LAZILY -- there is no provisioning step alongside tenant
creation; absence of a row means cap_mode "hard"
(app/repositories/tenant_settings.py's DEFAULT_CAP_MODE), so a brand new
tenant is hard-mode by default without ever needing an INSERT.

RLS follows the same post-0023 tenant_isolation pattern that
tenant_card_limits (migration 0025) established -- copied here verbatim:
FORCE (swu_user owns the table, so table-owner RLS bypass would otherwise
apply), and the NULLIF(current_setting(...), '')::integer guard so a
tenant-less session (BL-56's catalog reads) sees zero rows instead of
leaking tenant #1's cap_mode via a COALESCE-to-1 fallback -- migration
0018's original COALESCE pattern was superseded by 0023 before this table
existed, so there's no need to replicate the since-corrected leak here.
No FOR/WITH CHECK clause means the single USING expression also gates
INSERT/UPDATE/DELETE, mirroring 0018/0021/0025.

swu_app needs explicit INSERT/UPDATE/DELETE for the PUT
/api/settings/limits upsert path (only touched when the request body
includes a cap_mode change) -- migration 0019's grants were per-table
(inventory only), not a default privilege for future tables, so this
table needs its own grant just like 0025 did for tenant_card_limits.
SELECT is already covered by 0019's `ALTER DEFAULT PRIVILEGES FOR ROLE
swu_user ... GRANT SELECT ON TABLES`, since this table is created by
swu_user (the migration-running role).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_settings",
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id"),
            primary_key=True,
        ),
        sa.Column(
            "cap_mode",
            sa.String(10),
            nullable=False,
            server_default="hard",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "cap_mode IN ('hard', 'soft')", name="ck_tenant_settings_cap_mode"
        ),
    )

    op.execute("ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON tenant_settings
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        """
    )

    op.execute("GRANT INSERT, UPDATE, DELETE ON tenant_settings TO swu_app")


def downgrade() -> None:
    op.execute("REVOKE INSERT, UPDATE, DELETE ON tenant_settings FROM swu_app")
    op.execute("DROP POLICY tenant_isolation ON tenant_settings")
    op.execute("ALTER TABLE tenant_settings NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_settings DISABLE ROW LEVEL SECURITY")
    op.drop_table("tenant_settings")
