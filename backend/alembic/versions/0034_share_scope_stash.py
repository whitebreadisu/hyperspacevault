"""Allow the 'stash' share scope (stash sharing, App Spec §19.1)

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-12

A stash share is a `shares` row with scope 'stash' and target_id = the
stash's id. Nothing else in the table changes: the partial unique index
from 0030, (tenant_id, scope, COALESCE(target_id, 0)) WHERE revoked_at IS
NULL, already gives each stash at most one active link, separate from the
vault link, and the two RLS policies already cover every scope.

target_id carries no foreign key on purpose: shares rows are never deleted
by a stash delete (revocation is soft, so a token is never re-issued); the
stash delete revokes the row in the same transaction instead.

Downgrade deletes every stash-scope row (active or revoked) before putting
the old constraint back: the old CHECK cannot hold them, and deleting a
token row only makes its link a 404, which is the safe direction.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_shares_scope", "shares", type_="check")
    op.create_check_constraint(
        "ck_shares_scope",
        "shares",
        "scope IN ('inventory', 'wanted', 'list', 'stash')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM shares WHERE scope = 'stash'")
    op.drop_constraint("ck_shares_scope", "shares", type_="check")
    op.create_check_constraint(
        "ck_shares_scope",
        "shares",
        "scope IN ('inventory', 'wanted', 'list')",
    )
