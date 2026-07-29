"""Add users table (P5 Stage 1)

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-13

The `users` table P4 deferred. Maps a Firebase identity (firebase_uid)
to a tenant_id -- the bridge between "Firebase says this is user X" and
"this app's tenant Y". Empty until P5 Stage 2's auto-provisioning starts
inserting rows. No RLS yet: the table is unused until Stage 2.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("firebase_uid", sa.String(128), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], name="fk_users_tenant_id"),
        sa.UniqueConstraint("firebase_uid", name="uq_users_firebase_uid"),
    )


def downgrade() -> None:
    op.drop_table("users")
