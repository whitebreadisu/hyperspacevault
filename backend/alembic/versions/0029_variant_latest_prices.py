"""BL-146: variant_latest_prices snapshot table -- promote-gate fix (#368)

Revision ID: 0029
Revises: 0028
Create Date: 2026-07-21

Incident (dev, 2026-07-21, db-f1-micro, 2,827,106 variant_prices rows):
the latest-price read path (app.repositories.pricing.get_latest_prices)
was `SELECT DISTINCT ON (variant_id) ... FROM variant_prices ORDER BY
variant_id, as_of DESC` -- unscoped, so it re-scans ALL ~9,057 variants'
worth of history on every call. At 87 days (~80k rows) that measured
15-19ms; once the backfill pushed the table to 2.8M rows the same query
took minutes, requests stacked (16 concurrent copies observed), and every
API endpoint 503'd -- dev's catalog rendered empty. This must never depend
on history depth again (issue #368).

One new table, `variant_latest_prices`: one row per PRICED variant (~9k
rows forever, never grows with history). Same global-catalog posture as
migration 0028's pricing tables -- no tenant_id, no RLS, no explicit GRANT
(0019's `ALTER DEFAULT PRIVILEGES FOR ROLE swu_user ... GRANT SELECT ON
TABLES TO swu_app` already covers it).

The one-time populate (the exact DISTINCT ON query, run ONCE here) is fine
at migration time -- ADR-0011's discrete-deploy-step model means this runs
once per environment as part of a promote, not on every container start.
After this migration, app.repositories.pricing.upsert_latest_price (called
by both app.jobs.price_sync and app.jobs.price_backfill, in the same
transaction as their variant_prices writes) keeps this table current going
forward; the DISTINCT ON scan is never run again at request time.

The price-HISTORY endpoint is untouched -- it already reads variant_prices
scoped by variant_id and uses the 0028 (variant_id, as_of DESC) index, so
its cost never depended on total history depth.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept as a literal string (not imported from app.repositories.pricing) --
# migrations in this codebase are self-contained snapshots-in-time and
# don't import application code (see 0001-0028), so this is deliberately
# duplicated rather than shared. ON CONFLICT DO NOTHING costs nothing here
# (the table is freshly created and empty) but keeps this statement safely
# re-runnable if a migration ever needs to be replayed.
POPULATE_SNAPSHOT_SQL = """
    INSERT INTO variant_latest_prices (variant_id, market, low, as_of)
    SELECT DISTINCT ON (variant_id) variant_id, market, low, as_of
    FROM variant_prices
    ORDER BY variant_id, as_of DESC
    ON CONFLICT (variant_id) DO NOTHING
"""


def upgrade() -> None:
    op.create_table(
        "variant_latest_prices",
        sa.Column("variant_id", sa.Integer(), nullable=False),
        sa.Column("market", sa.Numeric(10, 2), nullable=True),
        sa.Column("low", sa.Numeric(10, 2), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["variant_id"], ["card_variants.id"]),
        sa.PrimaryKeyConstraint("variant_id"),
    )

    # One-time backfill from whatever variant_prices history already exists
    # in this environment -- the last time this DISTINCT ON scan ever needs
    # to run. Safe/expected to take a while in an environment with a large
    # variant_prices table (this IS the incident's expensive query) --
    # that cost is exactly what this migration exists to pay exactly once.
    op.execute(POPULATE_SNAPSHOT_SQL)


def downgrade() -> None:
    op.drop_table("variant_latest_prices")
