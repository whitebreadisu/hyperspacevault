"""Add feedback table (BL-126: header button + modal + DB record + GitHub-issue notification)

Revision ID: 0027
Revises: 0026
Create Date: 2026-07-13

Owner decisions (issue #289): `feedback` is the source of truth for user
feedback submissions -- anonymous submissions are explicitly allowed (the
table is tenant-OPTIONAL, unlike every other tenant-owned table this
codebase has added since P4). contact_ok/contact_email/tenant_id together
encode the consent semantics decided on the issue: when contact_ok is
false the row must be genuinely anonymous even for a signed-in submitter --
no uid/tenant/email stored at all -- and tenant_id is populated ONLY when
contact_ok is true AND the submitter was authenticated. commit_sha +
created_at are the only metadata attached (server-side, no client
fingerprinting -- decision #4).

RLS is where this table's tenant-optional shape actually diverges from the
tenant_isolation pattern every prior migration (0018/0021/0025/0026) reused
verbatim. That pattern's single USING clause assumes every row belongs to
exactly one real tenant and gates ALL commands identically; applied here
unmodified it would reject every anonymous INSERT (tenant_id IS NULL never
equals a real tenant_id) and block the tenant-less catalog-reading sessions
BL-56/ADR-0008 established. So this migration defines three narrower,
command-specific policies instead of one blanket one:

  - feedback_insert (FOR INSERT): allows tenant_id IS NULL unconditionally
    (anonymous submitters, and signed-in submitters who declined contact --
    the session's real tenant GUC is irrelevant to that branch, exactly
    reproducing "genuinely anonymous even for signed-in users") OR
    tenant_id = the caller's own current tenant (a signed-in, consenting
    submitter can only ever attach their own tenant_id, never spoof
    another's).
  - feedback_select_own_tenant (FOR SELECT): tenant_id = the caller's own
    current tenant only -- deliberately NOT `OR tenant_id IS NULL`. This
    policy exists ONLY to make feedback_purge_delete below actually work,
    not to back a read endpoint (no route ever queries this table) --
    empirically confirmed while building this migration: PostgreSQL's RLS
    requires a row to be visible under an applicable SELECT (or ALL)
    policy for UPDATE/DELETE to locate it at all, even with a correct,
    matching command-specific USING clause of its own and even with NO
    RETURNING clause in play. Without this policy, `DELETE FROM feedback
    WHERE tenant_id = :tenant_id` (app/repositories/account.py's
    purge_tenant) silently matches zero rows -- not an error, just a
    no-op -- which then surfaces one step later as a FOREIGN KEY
    violation when the subsequent `DELETE FROM tenants` runs (confirmed by
    reproducing exactly this failure locally before adding this policy).
    Because this policy excludes `tenant_id IS NULL`, an anonymous row is
    NEVER visible under it, to any session -- it cannot be a channel for
    reading other people's anonymous feedback.
  - feedback_purge_delete (FOR DELETE): USING tenant_id = the caller's own
    current tenant only -- same predicate as the SELECT policy above, so
    every row the purge can see, it can also delete, and nothing else.
    This is the RLS-layer expression of the purge_tenant rule (#244) as
    applied here: "anonymous rows survive deletion by design" isn't just
    an application-level filtering convention (like `tenants`' explicit-
    filter-only design from migration 0024) -- no policy on this table
    ever makes an anonymous row visible to a DELETE, for any session.

No UPDATE policy exists -- correct, since no endpoint ever mutates an
existing feedback row.

swu_app needs its own explicit SELECT/INSERT/DELETE grant, matching every
prior table's migration (0019's grant was inventory-only, not a default
privilege for future tables) -- sequence USAGE is already covered by
0019's `ALTER DEFAULT PRIVILEGES FOR ROLE swu_user ...`.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "contact_ok",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("contact_email", sa.String(254), nullable=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id"),
            nullable=True,
        ),
        sa.Column("commit_sha", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.execute("ALTER TABLE feedback ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE feedback FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY feedback_insert ON feedback FOR INSERT
        WITH CHECK (
            tenant_id IS NULL
            OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer
        )
        """
    )
    op.execute(
        """
        CREATE POLICY feedback_select_own_tenant ON feedback FOR SELECT
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        """
    )
    op.execute(
        """
        CREATE POLICY feedback_purge_delete ON feedback FOR DELETE
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer)
        """
    )

    op.execute("GRANT SELECT, INSERT, DELETE ON feedback TO swu_app")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, DELETE ON feedback FROM swu_app")
    op.execute("DROP POLICY feedback_purge_delete ON feedback")
    op.execute("DROP POLICY feedback_select_own_tenant ON feedback")
    op.execute("DROP POLICY feedback_insert ON feedback")
    op.execute("ALTER TABLE feedback NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE feedback DISABLE ROW LEVEL SECURITY")
    op.drop_table("feedback")
