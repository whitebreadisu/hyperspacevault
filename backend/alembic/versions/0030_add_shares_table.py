"""Add shares table (BL-205: secret-link collection sharing, App Spec §19.1)

Revision ID: 0030
Revises: 0029
Create Date: 2026-08-11

The platform's first unauthenticated read of tenant data rides on this
table: a share row's `token` (>=128-bit URL-safe random) is the sole
credential a viewer presents, and the owner-chosen `name` is the only
owner identity a viewer ever sees. `scope` carries the full enum from day
one (owner ruling: this table is public-facing and must never need a
schema migration to grow scopes); BL-205 implements only 'inventory'.
`target_id` is the future list-scope binder reference — NULL for
inventory/wanted scopes, spec'd as scope-forward alongside the enum.

Cardinality (owner ruling 2026-08-11): at most ONE active share per scope
target — enforced by the partial unique index on
(tenant_id, scope, COALESCE(target_id, 0)) WHERE revoked_at IS NULL, so
revoked rows never block a re-create and the constraint is the database's
own word, not an application convention.

RLS follows the two-audience shape this table uniquely has:
  - shares_tenant_all (FOR ALL): the tenant_isolation pattern — the owner
    manages (and purges, see feedback/0027's visibility lesson: FOR ALL
    includes SELECT, so purge DELETEs can locate rows) only their own
    shares.
  - shares_token_select (FOR SELECT): a row is visible to a session whose
    app.share_token GUC equals the row's token AND the row is unrevoked.
    current_setting(..., true) is NULL when the GUC is unset, so tenant
    and catalog sessions (which never set it) match nothing; revoked rows
    match nothing for anyone. This is how database.get_shared_db resolves
    a presented token without any auth context — same RLS rails, no
    bypass.

swu_app gets SELECT/INSERT/UPDATE/DELETE: UPDATE backs rename/rotate/
revoke (revocation is soft — revoked_at — so tokens are never reissued
into a row that once leaked), DELETE backs account purge only.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shares",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column(
            "scope",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'inventory'"),
        ),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(30), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "scope IN ('inventory', 'wanted', 'list')", name="ck_shares_scope"
        ),
    )
    op.create_index("uq_shares_token", "shares", ["token"], unique=True)
    op.execute(
        """
        CREATE UNIQUE INDEX uq_shares_one_active_per_target
        ON shares (tenant_id, scope, COALESCE(target_id, 0))
        WHERE revoked_at IS NULL
        """
    )

    op.execute("ALTER TABLE shares ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shares FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY shares_tenant_all ON shares FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        """
    )
    op.execute(
        """
        CREATE POLICY shares_token_select ON shares FOR SELECT
        USING (
            revoked_at IS NULL
            AND token = current_setting('app.share_token', true)
        )
        """
    )

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON shares TO swu_app")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON shares FROM swu_app")
    op.execute("DROP POLICY shares_token_select ON shares")
    op.execute("DROP POLICY shares_tenant_all ON shares")
    op.execute("ALTER TABLE shares NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shares DISABLE ROW LEVEL SECURITY")
    op.drop_table("shares")
