"""Add card_aspects, card_traits, card_keywords, card_details tables

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-12

Phase 2 data tables for per-card enrichment fields. All were defined as
SQLAlchemy models but never included in a migration. Tables are created
empty; the backfill_card_details.py script populates them from the CSV files.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_aspects",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("aspect", sa.String(20), nullable=False),
        sa.PrimaryKeyConstraint("card_id", "aspect"),
    )

    op.create_table(
        "card_keywords",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("keyword", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("card_id", "keyword"),
    )

    op.create_table(
        "card_traits",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("trait", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("card_id", "trait"),
    )

    op.create_table(
        "card_details",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("sub_text", sa.Text(), nullable=True),
        sa.Column("cost", sa.Integer(), nullable=True),
        sa.Column("power", sa.Integer(), nullable=True),
        sa.Column("hp", sa.Integer(), nullable=True),
        sa.Column("arena", sa.String(10), nullable=True),
        sa.Column("is_unique", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("card_id"),
    )


def downgrade() -> None:
    op.drop_table("card_details")
    op.drop_table("card_traits")
    op.drop_table("card_keywords")
    op.drop_table("card_aspects")
