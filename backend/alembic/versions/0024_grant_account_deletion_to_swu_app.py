"""Grant swu_app DELETE on users and tenants (BL-87)

Revision ID: 0024
Revises: 0023
Create Date: 2026-07-10

BL-87's account-purge endpoint deletes a tenant's rows from `inventory`,
`users`, and `tenants` in one transaction. `inventory` already has
INSERT/UPDATE/DELETE granted to swu_app (migration 0019); `users` and
`tenants` were only ever granted INSERT (migration 0021, for
auto-provisioning) plus SELECT (`users`: blanket from 0019; `tenants`:
column-level `id` only, from 0021). Without this migration, swu_app's
DELETE FROM users / DELETE FROM tenants would fail with "permission
denied" the moment the purge endpoint tried to run -- confirmed by
inspection before writing any endpoint code.

`users` already has RLS (migration 0021's user_self_access policy, no FOR
clause so it covers DELETE too) scoped to the caller's own firebase_uid --
that policy becomes a real backstop the moment DELETE is granted, with no
further change needed here.

`tenants` deliberately has *no* RLS at all (see migration 0021's
docstring: the auto-provisioning INSERT doesn't know its own row's id yet,
so there's no tenant_id-shaped predicate to check at insert time). A
naive fix -- add a `FOR DELETE` policy scoped to
app.current_tenant_id -- was considered and rejected: PostgreSQL's RLS is
per-command, so enabling ROW LEVEL SECURITY on `tenants` with only a
DELETE policy would leave SELECT and INSERT with zero applicable
policies, which defaults to deny-all for swu_app on *those* commands --
silently breaking the existing auto-provisioning INSERT ... RETURNING id
and the SELECT (id) it depends on. Getting this right would mean adding
permissive SELECT/INSERT policies too, which is more surface than "grant
the minimum needed" calls for. Instead, `tenants` stays RLS-free and
relies solely on the application filtering DELETE FROM tenants WHERE id =
:tenant_id, where :tenant_id is always read server-side from
app.current_tenant_id (set by get_db from the verified Firebase token) --
never a client-supplied value. This is intentionally the *only* line of
defense for `tenants`; `inventory` and `users` both still have their RLS
backstop underneath the same explicit-filter discipline.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("GRANT DELETE ON users TO swu_app")
    op.execute("GRANT DELETE ON tenants TO swu_app")


def downgrade() -> None:
    op.execute("REVOKE DELETE ON tenants FROM swu_app")
    op.execute("REVOKE DELETE ON users FROM swu_app")
