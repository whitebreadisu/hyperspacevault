"""Add tenant_card_limits (BL-24 per-tenant inventory limit overrides)

Revision ID: 0025
Revises: 0024
Create Date: 2026-07-12

BL-24: tenant-configurable overrides of the code-default per-variant
keep-limit, keyed by (type_category, limit_bucket) -- type_category is
"singleton" (Leader/Base, code default 1) or "standard" (everything else,
code default 3); limit_bucket is a variant's `finish` if it has one, else
its `channel` (app/ingestion/swuapi_classify.py's limit_bucket() /
ALL_LIMIT_BUCKETS). Rows are OVERRIDES ONLY -- absence of a row means the
code default applies (app/services/limits.py); a row with max_quantity
NULL means the tenant has explicitly configured "no limit" for that cell,
which is distinct from "no row" (falls back to the numeric default).

RLS follows the current (post-0023) tenant_isolation pattern copied
verbatim from `inventory`: FORCE (swu_user owns the table, so table-owner
RLS bypass would otherwise apply), and the
NULLIF(current_setting(...), '')::integer guard so a tenant-less session
(BL-56's catalog reads) sees zero rows instead of leaking tenant #1's
overrides via a COALESCE-to-1 fallback -- migration 0018's original
COALESCE pattern was superseded by 0023 before this table existed, so
there's no need to replicate the since-corrected leak here. No FOR/WITH
CHECK clause means the single USING expression also gates INSERT/UPDATE/
DELETE, mirroring 0018/0021.

swu_app needs explicit INSERT/UPDATE/DELETE for the PUT full-replacement
endpoint -- migration 0019's grants were per-table (inventory only), not a
default privilege for future tables, so this table needs its own grant
just like 0019 did for `inventory`. SELECT is already covered by 0019's
`ALTER DEFAULT PRIVILEGES FOR ROLE swu_user ... GRANT SELECT ON TABLES`,
since this table is created by swu_user (the migration-running role).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_card_limits",
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column("type_category", sa.String(20), nullable=False),
        sa.Column("limit_bucket", sa.String(50), nullable=False),
        sa.Column("max_quantity", sa.Integer(), nullable=True),
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
        sa.PrimaryKeyConstraint("tenant_id", "type_category", "limit_bucket"),
        sa.CheckConstraint(
            "max_quantity IS NULL OR (max_quantity >= 0 AND max_quantity <= 999)",
            name="ck_tenant_card_limits_max_quantity_range",
        ),
    )

    op.execute("ALTER TABLE tenant_card_limits ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_card_limits FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON tenant_card_limits
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        """
    )

    op.execute("GRANT INSERT, UPDATE, DELETE ON tenant_card_limits TO swu_app")


def downgrade() -> None:
    op.execute("REVOKE INSERT, UPDATE, DELETE ON tenant_card_limits FROM swu_app")
    op.execute("DROP POLICY tenant_isolation ON tenant_card_limits")
    op.execute("ALTER TABLE tenant_card_limits NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_card_limits DISABLE ROW LEVEL SECURITY")
    op.drop_table("tenant_card_limits")
