"""Make an unset/empty tenant see zero rows, not tenant #1 (BL-56 Slice 1)

Revision ID: 0023
Revises: 0022
Create Date: 2026-07-05

ADR-0008: BL-56 introduces a tenant-less catalog session (get_catalog_db /
get_optional_db, app/database.py) for public catalog reads, using the same
swu_app role as every authenticated session. Migration 0018's
tenant_isolation policy on `inventory` falls back to tenant #1 via
COALESCE(current_setting('app.current_tenant_id', true)::integer, 1) when
the session variable isn't set -- that fallback made sense before anything
ever left it unset (P4 Stage 2), but a tenant-less session leaves it unset
*by design* now, and the COALESCE would leak tenant #1's inventory to every
anonymous caller.

The fix: require the session variable to be non-null AND non-empty before
comparing tenant_id, using NULLIF(current_setting(...), '') rather than a
literal IS NOT NULL / <> '' guard alongside a separate ::integer cast --
NULLIF turns both "never set" (NULL) and "explicitly cleared to ''" (the
tenant-less session's own set_config('app.current_tenant_id', '', false),
see app/database.py's _open_catalog_session) into a single NULL, which
casts to NULL without erroring, then never equals any real tenant_id. A
plain `... AND tenant_id = current_setting(...)::integer` would instead
raise "invalid input syntax for type integer" the moment the guard's ''
reached the cast, because SQL's AND does not guarantee left-to-right
short-circuit evaluation order.

`users`.user_self_access (migration 0021) needs no equivalent change: it
compares firebase_uid (text, no cast) to current_setting(...), and neither
NULL (never set) nor '' (explicitly cleared) equals any real firebase_uid,
so it already returns zero rows for a tenant-less session without a guard.
Confirmed by the existing regression test
test_users_row_level_security.test_swu_app_sees_no_rows_without_current_firebase_uid.
Left unchanged here to keep this migration's blast radius to the one
policy that actually had a leak.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP POLICY tenant_isolation ON inventory")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON inventory
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY tenant_isolation ON inventory")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON inventory
        USING (tenant_id = COALESCE(current_setting('app.current_tenant_id', true)::integer, 1))
        """
    )
