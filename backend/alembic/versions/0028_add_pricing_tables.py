"""BL-136 P1: card-pricing tables (Definition_Pricing_2026-07-16.md §2)

Revision ID: 0028
Revises: 0027
Create Date: 2026-07-16

Three new tables, all global catalog data (no tenant_id, no RLS -- prices
are the same for every tenant, same posture as base_cards/card_variants):

- `tcgplayer_products` -- the mapping layer between our card_variants and
  tcgcsv's (productId, subTypeName) price keys. One row per variant (unique
  FK), built by app.ingestion.run_tcgplayer_mapping (P1) and consumed
  read-only by the daily sync/backfill jobs (P2/P3) -- neither job re-runs
  the join, they just look up productId/sub_type per variant_id.
- `variant_prices` -- one row per variant per day; composite PK doubles as
  the natural idempotency key for both the daily sync (upsert on re-run)
  and the backfill (insert-or-skip per historical day). Same table serves
  both "current price" (latest as_of) and history (the whole run).
- `pricing_sync_state` -- tiny key/value watermark table shared by the P2
  daily-sync job (key='daily_sync', value=tcgcsv's last-updated.txt
  timestamp) and the P3 backfill job (key='backfill', value=last
  successfully-inserted date) so both are safely restartable/idempotent
  without a dedicated table each.

No explicit GRANT statements needed: migration 0019's
`ALTER DEFAULT PRIVILEGES FOR ROLE swu_user ... GRANT SELECT ON TABLES TO
swu_app` already covers every table swu_user (the migration-running role)
creates from here on, matching the precedent set by every catalog table
added since (base_cards, card_variants, card_aspects, ...). The pricing
jobs themselves write through the admin DATABASE_URL/SessionLocal
connection (swu_user), same as run_swuapi_ingestion.py and
backfill_card_images.py -- swu_app only ever reads these tables via the
API, so it needs nothing beyond the inherited SELECT.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tcgplayer_products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("variant_id", sa.Integer(), nullable=False),
        sa.Column("tcg_product_id", sa.Integer(), nullable=False),
        sa.Column("tcg_group_id", sa.Integer(), nullable=False),
        sa.Column("sub_type", sa.String(10), nullable=False),
        sa.Column("match_method", sa.String(20), nullable=False),
        sa.Column("matched_name", sa.String(300), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["variant_id"], ["card_variants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("variant_id", name="uq_tcgplayer_products_variant_id"),
    )
    op.create_index(
        "ix_tcgplayer_products_tcg_product_id",
        "tcgplayer_products",
        ["tcg_product_id"],
    )

    op.create_table(
        "variant_prices",
        sa.Column("variant_id", sa.Integer(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("market", sa.Numeric(10, 2), nullable=True),
        sa.Column("low", sa.Numeric(10, 2), nullable=True),
        sa.Column("mid", sa.Numeric(10, 2), nullable=True),
        sa.Column("high", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "currency", sa.String(3), nullable=False, server_default=sa.text("'USD'")
        ),
        sa.ForeignKeyConstraint(["variant_id"], ["card_variants.id"]),
        sa.PrimaryKeyConstraint("variant_id", "as_of"),
    )
    # Latest-price-per-variant lookups (the API's hot path -- embedding
    # current price on every card in the list endpoint) filter by variant_id
    # and want the max as_of; the PK's leading column already covers
    # variant_id, this index adds the as_of-descending shape for "give me
    # the newest row per variant" without a per-request MAX() subquery scan.
    op.create_index(
        "ix_variant_prices_variant_id_as_of",
        "variant_prices",
        ["variant_id", sa.text("as_of DESC")],
    )

    op.create_table(
        "pricing_sync_state",
        sa.Column("key", sa.String(50), nullable=False),
        sa.Column("value", sa.String(200), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("pricing_sync_state")
    op.drop_index("ix_variant_prices_variant_id_as_of", table_name="variant_prices")
    op.drop_table("variant_prices")
    op.drop_index(
        "ix_tcgplayer_products_tcg_product_id", table_name="tcgplayer_products"
    )
    op.drop_table("tcgplayer_products")
