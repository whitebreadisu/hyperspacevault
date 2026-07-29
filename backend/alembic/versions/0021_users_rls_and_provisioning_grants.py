"""Enable users RLS and grant provisioning writes to swu_app (P5 Stage 2)

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-13

Auto-provisioning (get_db) needs swu_app to INSERT into both `users` and
`tenants` the first time a firebase_uid is seen.

`users` gets RLS keyed on firebase_uid, not tenant_id -- tenant_id is what
this table is used to look up, so it isn't known yet when the lookup runs.
The verified firebase_uid is known first; a session may only see/create the
`users` row matching its own app.current_firebase_uid (set by get_db before
querying). FORCE is required because swu_user owns `users`, same as
`inventory` in migration 0018. No FOR/WITH CHECK clause means the USING
expression also gates INSERT, mirroring 0018's tenant_isolation policy.

`tenants` gets no RLS -- the auto-provisioning INSERT doesn't know its own
new row's id yet, so there's no tenant_id-shaped predicate to check at
insert time. Instead, swu_app's previously-blanket SELECT on `tenants`
(granted by 0019's "GRANT SELECT ON ALL TABLES") is revoked: once
tenants.name holds human-readable, email-derived values, blanket SELECT
would let any authenticated session read every other tenant's name.

Auto-provisioning's `INSERT ... RETURNING id` still needs SELECT on the
`id` column specifically -- Postgres checks column-level SELECT privilege
for RETURNING even on a row the same statement just inserted. Granting
SELECT (id) only (not the whole row) keeps tenants.name unreadable.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY user_self_access ON users
        USING (firebase_uid = current_setting('app.current_firebase_uid', true))
        """
    )
    op.execute("GRANT INSERT ON users TO swu_app")

    op.execute("REVOKE SELECT ON tenants FROM swu_app")
    op.execute("GRANT INSERT ON tenants TO swu_app")
    op.execute("GRANT SELECT (id) ON tenants TO swu_app")


def downgrade() -> None:
    op.execute("REVOKE SELECT (id) ON tenants FROM swu_app")
    op.execute("REVOKE INSERT ON tenants FROM swu_app")
    op.execute("GRANT SELECT ON tenants TO swu_app")

    op.execute("REVOKE INSERT ON users FROM swu_app")
    op.execute("DROP POLICY user_self_access ON users")
    op.execute("ALTER TABLE users NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE users DISABLE ROW LEVEL SECURITY")
