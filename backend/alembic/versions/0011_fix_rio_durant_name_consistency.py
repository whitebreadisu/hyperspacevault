"""Normalize Rio Durant name to 'Wisecracking Wheelman' across all variants

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-10

The JTL CSV uses 'Wisecrack Wheelman' for the Hyperspace (277) and Showcase (1011)
variants but 'Wisecracking Wheelman' for the standard (15). Migration 0010 fixed the
base_card_numbers directly, but the variant names in the DB remain inconsistent.

This migration normalizes all three records to the standard card's spelling so the
displayed name is consistent across variants. The source CSV has also been corrected
to match, keeping future F3 re-runs idempotent.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE cards
        SET name = 'Rio Durant - Wisecracking Wheelman'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'JTL')
          AND card_number = '277'
    """)
    op.execute("""
        UPDATE cards
        SET name = 'Rio Durant - Wisecracking Wheelman (Showcase)'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'JTL')
          AND card_number = '1011'
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE cards
        SET name = 'Rio Durant - Wisecrack Wheelman'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'JTL')
          AND card_number = '277'
    """)
    op.execute("""
        UPDATE cards
        SET name = 'Rio Durant - Wisecrack Wheelman (Showcase)'
        WHERE set_id = (SELECT id FROM sets WHERE code = 'JTL')
          AND card_number = '1011'
    """)
