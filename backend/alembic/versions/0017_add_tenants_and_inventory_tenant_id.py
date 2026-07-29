"""Add tenants table and inventory.tenant_id (P4 Stage 1)

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-13

Multi-tenant schema foundation. Creates `tenants`, seeds tenant #1, and
adds `inventory.tenant_id` via relax -> backfill -> constrain. The
inventory unique constraint becomes (tenant_id, card_id) so a future
tenant can hold its own row for a card another tenant already tracks.
tenant_id defaults to 1 so existing inserts (increment/decrement) keep
working until P4 Stage 3 sets it explicitly per request.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.execute("INSERT INTO tenants (name) VALUES ('Default Tenant')")

    # Relax: add tenant_id as nullable first
    op.add_column("inventory", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_inventory_tenant_id", "inventory", "tenants", ["tenant_id"], ["id"]
    )

    # Backfill: every existing row belongs to tenant #1
    op.execute("UPDATE inventory SET tenant_id = 1")

    # Constrain: tenant_id is now required. DEFAULT 1 is a bridge so
    # inserts that don't set tenant_id yet (increment/decrement) keep
    # working until P4 Stage 3 wires up real tenant context.
    op.alter_column("inventory", "tenant_id", nullable=False, server_default=sa.text("1"))

    op.drop_constraint("uq_inventory_card_id", "inventory", type_="unique")
    op.create_unique_constraint(
        "uq_inventory_tenant_id_card_id", "inventory", ["tenant_id", "card_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_inventory_tenant_id_card_id", "inventory", type_="unique")
    op.create_unique_constraint("uq_inventory_card_id", "inventory", ["card_id"])
    op.alter_column("inventory", "tenant_id", nullable=True, server_default=None)
    op.drop_constraint("fk_inventory_tenant_id", "inventory", type_="foreignkey")
    op.drop_column("inventory", "tenant_id")
    op.drop_table("tenants")
