"""Initial schema: sets, cards, inventory

Revision ID: 0001
Revises:
Create Date: 2026-05-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(3), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("has_unique_variant_numbers", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_sets_code"),
    )

    op.create_table(
        "cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("base_card_number", sa.String(10), nullable=False),
        sa.Column("card_number", sa.String(10), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("rarity", sa.String(1), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("variant", sa.String(30), nullable=False),
        sa.Column(
            "is_organized_play",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("set_id", "card_number", name="uq_cards_set_card_number"),
        sa.CheckConstraint(
            "variant != 'Showcase' OR type = 'Leader'",
            name="ck_cards_showcase_leader_only",
        ),
    )
    op.create_index("ix_cards_set_id", "cards", ["set_id"])
    op.create_index("ix_cards_base_card_number", "cards", ["base_card_number"])

    op.create_table(
        "inventory",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column(
            "quantity",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("card_id", name="uq_inventory_card_id"),
        sa.CheckConstraint("quantity >= 0", name="ck_inventory_quantity_non_negative"),
    )
    op.create_index("ix_inventory_card_id", "inventory", ["card_id"])


def downgrade() -> None:
    op.drop_table("inventory")
    op.drop_table("cards")
    op.drop_table("sets")
