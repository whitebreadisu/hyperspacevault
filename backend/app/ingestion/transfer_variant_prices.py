"""BL-139: one-time dev->prod transfer of the variant_prices history.

Prod never ran the ~860-day tcgcsv backfill (6-10h of degraded service on a
db-f1-micro, plus re-pulling every daily archive against tcgcsv.com's usage
guidelines). The decided approach (issue #351, owner approval 2026-07-21) is
a data transfer instead: export dev's fully-backfilled variant_prices keyed
by the PORTABLE identity (tcgplayer productId + subtype + as_of) -- variant
ids are serial and differ per environment, but both environments derive the
same product<->variant mapping (app.ingestion.run_tcgplayer_mapping) -- and
re-key against the target's own tcgplayer_products on import.

Three subcommands, deliberately separable so the export can run ahead of
the quiet window and the import inside it:

  export  -- preflight the source history (contiguity + freshness, the
             2026-07-21 session-close precondition), then stream the keyed
             join to a local CSV via COPY.
  import  -- preflight the target (migration 0029 applied; mapping built),
             COPY the CSV into an UNLOGGED staging table, re-key into
             variant_prices (ON CONFLICT DO NOTHING -- idempotent, safe to
             re-run), refresh variant_latest_prices with the same guarded
             upsert semantics as app.repositories.pricing.upsert_latest_price
             (an older as_of never regresses the snapshot -- the target's
             daily sync may legitimately have written newer rows between
             export and import), then ANALYZE.
  verify  -- compare source vs target inside the source's date window: row
             counts, span, per-day counts, and md5-hashed full price series
             for a deterministic sample of product keys; also check the
             target's snapshot agrees with its own history. Exit 0/1.

Both ends are reached through cloud-sql-proxy tunnels; pass plain TCP URLs
(postgresql://swu_user:<pw>@127.0.0.1:<port>/swu_inventory), not the
/cloudsql unix-socket URLs stored in Secret Manager.

Usage:
    python -m app.ingestion.transfer_variant_prices export \
        --source-url postgresql://... --out prices.csv
    python -m app.ingestion.transfer_variant_prices import \
        --target-url postgresql://... --in prices.csv
    python -m app.ingestion.transfer_variant_prices verify \
        --source-url postgresql://... --target-url postgresql://...
"""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg2

logger = logging.getLogger(__name__)

STAGING_TABLE = "variant_prices_transfer_staging"

# The keyed export: every history row joined to its portable identity. Rows
# whose variant has no mapping cannot exist (both price writers resolve
# variants THROUGH tcgplayer_products), but the count comparison in export()
# asserts that rather than assuming it.
EXPORT_SQL = """
    COPY (
        SELECT tp.tcg_product_id, tp.sub_type, vp.as_of,
               vp.market, vp.low, vp.mid, vp.high, vp.currency
        FROM variant_prices vp
        JOIN tcgplayer_products tp ON tp.variant_id = vp.variant_id
    ) TO STDOUT WITH (FORMAT CSV, HEADER true)
"""

STAGING_DDL = f"""
    CREATE UNLOGGED TABLE IF NOT EXISTS {STAGING_TABLE} (
        tcg_product_id integer      NOT NULL,
        sub_type       varchar(10)  NOT NULL,
        as_of          date         NOT NULL,
        market         numeric(10,2),
        low            numeric(10,2),
        mid            numeric(10,2),
        high           numeric(10,2),
        currency       varchar(3)   NOT NULL
    )
"""

STAGING_COPY_SQL = f"COPY {STAGING_TABLE} FROM STDIN WITH (FORMAT CSV, HEADER true)"

REKEY_SQL = f"""
    INSERT INTO variant_prices (variant_id, as_of, market, low, mid, high, currency)
    SELECT tp.variant_id, s.as_of, s.market, s.low, s.mid, s.high, s.currency
    FROM {STAGING_TABLE} s
    JOIN tcgplayer_products tp
      ON tp.tcg_product_id = s.tcg_product_id AND tp.sub_type = s.sub_type
    ON CONFLICT (variant_id, as_of) DO NOTHING
"""

# Set-based twin of app.repositories.pricing.upsert_latest_price: same
# ON CONFLICT guard, so a snapshot row the target's daily sync already
# advanced past the imported history is left alone.
SNAPSHOT_REFRESH_SQL = """
    INSERT INTO variant_latest_prices (variant_id, market, low, as_of)
    SELECT DISTINCT ON (variant_id) variant_id, market, low, as_of
    FROM variant_prices
    ORDER BY variant_id, as_of DESC
    ON CONFLICT (variant_id) DO UPDATE SET
        market = EXCLUDED.market, low = EXCLUDED.low, as_of = EXCLUDED.as_of
        WHERE EXCLUDED.as_of >= variant_latest_prices.as_of
"""

# One md5 per sampled product key: the whole series (every day, every price
# column) collapsed to a single order-independent-of-storage hash. Running
# the identical statement on both ends and comparing strings verifies far
# more than a spot value without shipping 3.4M rows back.
SERIES_HASH_SQL = """
    SELECT md5(string_agg(
               vp.as_of::text || ':' || coalesce(vp.market::text, '') ||
               ':' || coalesce(vp.low::text, '') ||
               ':' || coalesce(vp.mid::text, '') ||
               ':' || coalesce(vp.high::text, ''),
               '|' ORDER BY vp.as_of))
    FROM variant_prices vp
    JOIN tcgplayer_products tp ON tp.variant_id = vp.variant_id
    WHERE tp.tcg_product_id = %s AND tp.sub_type = %s
      AND vp.as_of BETWEEN %s AND %s
"""


def find_missing_days(present: list[date], start: date, end: date) -> list[date]:
    """Calendar days in [start, end] absent from `present`. Pure helper so
    the contiguity rule (the 2026-07-21 export precondition) is unit-testable
    without a database."""
    have = set(present)
    out = []
    d = start
    while d <= end:
        if d not in have:
            out.append(d)
        d += timedelta(days=1)
    return out


class _CountingWriter:
    """File wrapper that counts CSV rows (newlines) as COPY streams through,
    for progress logging on a multi-minute export."""

    def __init__(self, raw, log_every: int = 500_000):
        self._raw = raw
        self._log_every = log_every
        self._next_log = log_every
        self.rows = 0

    def write(self, data: bytes) -> int:
        self.rows += data.count(b"\n")
        if self.rows >= self._next_log:
            logger.info("  ... %s rows exported", f"{self.rows:,}")
            self._next_log += self._log_every
        return self._raw.write(data)


@dataclass
class SourceStats:
    total_rows: int
    min_day: date
    max_day: date
    distinct_days: int
    missing_days: list[date]


def preflight_source(conn) -> SourceStats:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), min(as_of), max(as_of), count(DISTINCT as_of) "
            "FROM variant_prices"
        )
        total, min_day, max_day, distinct_days = cur.fetchone()
        if not total:
            raise SystemExit("preflight: source variant_prices is EMPTY -- abort")
        cur.execute("SELECT DISTINCT as_of FROM variant_prices ORDER BY as_of")
        present = [r[0] for r in cur.fetchall()]
    return SourceStats(
        total_rows=total,
        min_day=min_day,
        max_day=max_day,
        distinct_days=distinct_days,
        missing_days=find_missing_days(present, min_day, max_day),
    )


def export_prices(conn, out_path: str, force: bool = False) -> int:
    """Preflight + stream the keyed export to out_path. Returns rows written."""
    stats = preflight_source(conn)
    logger.info(
        "source: %s rows, %s -> %s (%d distinct days)",
        f"{stats.total_rows:,}",
        stats.min_day,
        stats.max_day,
        stats.distinct_days,
    )

    yesterday = date.today() - timedelta(days=1)
    problems = []
    if stats.max_day < yesterday:
        problems.append(
            f"history is STALE: max(as_of)={stats.max_day}, expected >= {yesterday}"
        )
    if stats.missing_days:
        shown = ", ".join(str(d) for d in stats.missing_days[:10])
        problems.append(
            f"{len(stats.missing_days)} missing day(s) in span (first: {shown}) -- "
            "small tcgcsv archive gaps can be legitimate; an extended hole is not"
        )
    if problems:
        for p in problems:
            logger.error("preflight: %s", p)
        if not force:
            raise SystemExit("preflight failed -- re-run with --force to override")
        logger.warning("--force given: proceeding despite preflight findings")

    with open(out_path, "wb") as f:
        writer = _CountingWriter(f)
        with conn.cursor() as cur:
            cur.copy_expert(EXPORT_SQL, writer)
    exported = writer.rows - 1  # minus the CSV header line

    if exported != stats.total_rows:
        raise SystemExit(
            f"export wrote {exported:,} rows but source holds {stats.total_rows:,} "
            "-- some history rows have no tcgplayer_products mapping; investigate "
            "before transferring (this should be impossible: both price writers "
            "resolve variants through the mapping)"
        )
    logger.info("export complete: %s rows -> %s", f"{exported:,}", out_path)
    return exported


def preflight_target(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.variant_latest_prices')")
        if cur.fetchone()[0] is None:
            raise SystemExit(
                "preflight: variant_latest_prices missing -- migration 0029 has "
                "not been applied here; run the promote first"
            )
        cur.execute("SELECT count(*) FROM tcgplayer_products")
        mapping_rows = cur.fetchone()[0]
        if mapping_rows == 0:
            raise SystemExit(
                "preflight: tcgplayer_products is EMPTY -- the re-key join would "
                "import nothing; run `python -m app.ingestion.run_tcgplayer_mapping` "
                "against this environment first"
            )
        cur.execute("SELECT count(*) FROM variant_prices")
        existing = cur.fetchone()[0]
    logger.info(
        "target: mapping has %s products, variant_prices has %s existing rows",
        f"{mapping_rows:,}",
        f"{existing:,}",
    )


def import_prices(conn, in_path: str, keep_staging: bool = False) -> dict:
    """Stage the CSV, re-key into variant_prices, refresh the snapshot.
    Idempotent end-to-end: staging is truncated first, the re-key skips
    existing (variant_id, as_of) rows, the snapshot upsert is guarded."""
    preflight_target(conn)

    with conn.cursor() as cur:
        cur.execute(STAGING_DDL)
        cur.execute(f"TRUNCATE {STAGING_TABLE}")
        with open(in_path, "rb") as f:
            cur.copy_expert(STAGING_COPY_SQL, f)
        cur.execute(f"ANALYZE {STAGING_TABLE}")
        cur.execute(f"SELECT count(*) FROM {STAGING_TABLE}")
        staged = cur.fetchone()[0]
        logger.info("staged %s rows", f"{staged:,}")

        cur.execute(
            f"SELECT count(*), min(s.tcg_product_id || '/' || s.sub_type) "
            f"FROM {STAGING_TABLE} s "
            "LEFT JOIN tcgplayer_products tp "
            "  ON tp.tcg_product_id = s.tcg_product_id AND tp.sub_type = s.sub_type "
            "WHERE tp.variant_id IS NULL"
        )
        unmatched, unmatched_example = cur.fetchone()
        if unmatched:
            logger.warning(
                "%s staged rows have NO mapping match here (e.g. %s) -- they "
                "will be skipped; expected 0 when both environments ran the "
                "same run_tcgplayer_mapping",
                f"{unmatched:,}",
                unmatched_example,
            )

        cur.execute(REKEY_SQL)
        inserted = cur.rowcount
        logger.info("re-keyed %s new rows into variant_prices", f"{inserted:,}")

        cur.execute(SNAPSHOT_REFRESH_SQL)
        logger.info("snapshot refresh touched %s rows", f"{cur.rowcount:,}")

        cur.execute("ANALYZE variant_prices")
        cur.execute("ANALYZE variant_latest_prices")
    conn.commit()

    if not keep_staging:
        with conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
        conn.commit()

    return {"staged": staged, "unmatched": unmatched, "inserted": inserted}


def verify_transfer(source_conn, target_conn, samples: int = 12) -> bool:
    """Source-vs-target comparison inside the source's date window (the
    target's daily sync may hold newer days; those are out of scope here).
    Returns True when every check passes."""
    ok = True

    def fail(msg, *args):
        nonlocal ok
        ok = False
        logger.error("FAIL: " + msg, *args)

    with source_conn.cursor() as cur:
        cur.execute("SELECT min(as_of), max(as_of) FROM variant_prices")
        win_start, win_end = cur.fetchone()
    if win_start is None:
        raise SystemExit("verify: source has no history rows")
    logger.info("comparison window: %s -> %s", win_start, win_end)

    window_sql = (
        "SELECT count(*), count(DISTINCT as_of) FROM variant_prices "
        "WHERE as_of BETWEEN %s AND %s"
    )
    with source_conn.cursor() as cur:
        cur.execute(window_sql, (win_start, win_end))
        src_rows, src_days = cur.fetchone()
    with target_conn.cursor() as cur:
        cur.execute(window_sql, (win_start, win_end))
        tgt_rows, tgt_days = cur.fetchone()
    if (src_rows, src_days) == (tgt_rows, tgt_days):
        logger.info("row counts match: %s rows / %d days", f"{src_rows:,}", src_days)
    else:
        fail(
            "window mismatch: source %s rows/%d days, target %s rows/%d days",
            f"{src_rows:,}",
            src_days,
            f"{tgt_rows:,}",
            tgt_days,
        )

    per_day_sql = (
        "SELECT as_of, count(*) FROM variant_prices "
        "WHERE as_of BETWEEN %s AND %s GROUP BY as_of"
    )
    with source_conn.cursor() as cur:
        cur.execute(per_day_sql, (win_start, win_end))
        src_by_day = dict(cur.fetchall())
    with target_conn.cursor() as cur:
        cur.execute(per_day_sql, (win_start, win_end))
        tgt_by_day = dict(cur.fetchall())
    diff_days = sorted(
        d
        for d in set(src_by_day) | set(tgt_by_day)
        if src_by_day.get(d) != tgt_by_day.get(d)
    )
    if diff_days:
        for d in diff_days[:10]:
            fail(
                "day %s: source %s rows, target %s rows",
                d,
                src_by_day.get(d, 0),
                tgt_by_day.get(d, 0),
            )
        if len(diff_days) > 10:
            logger.error("... and %d more differing days", len(diff_days) - 10)
    else:
        logger.info("per-day counts identical across all %d days", src_days)

    # Deterministic sample (md5-ordered, no RNG) so re-runs check the same keys.
    with source_conn.cursor() as cur:
        cur.execute(
            "SELECT tcg_product_id, sub_type FROM ("
            "  SELECT DISTINCT tp.tcg_product_id, tp.sub_type "
            "  FROM tcgplayer_products tp "
            "  JOIN variant_prices vp ON vp.variant_id = tp.variant_id"
            ") keys "
            "ORDER BY md5(tcg_product_id::text || sub_type), sub_type "
            "LIMIT %s",
            (samples,),
        )
        sample_keys = cur.fetchall()
    matched = 0
    for product_id, sub_type in sample_keys:
        hashes = []
        for conn in (source_conn, target_conn):
            with conn.cursor() as cur:
                cur.execute(SERIES_HASH_SQL, (product_id, sub_type, win_start, win_end))
                hashes.append(cur.fetchone()[0])
        if hashes[0] == hashes[1] and hashes[0] is not None:
            matched += 1
        else:
            fail("series hash mismatch for product %s/%s", product_id, sub_type)
    logger.info(
        "spot-series: %d/%d sampled series identical", matched, len(sample_keys)
    )

    # Target self-consistency: its snapshot must agree with its own history.
    with target_conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM variant_latest_prices vlp "
            "JOIN LATERAL ("
            "  SELECT market, low, as_of FROM variant_prices vp "
            "  WHERE vp.variant_id = vlp.variant_id "
            "  ORDER BY as_of DESC LIMIT 1"
            ") latest ON true "
            "WHERE latest.as_of IS DISTINCT FROM vlp.as_of "
            "   OR latest.market IS DISTINCT FROM vlp.market "
            "   OR latest.low IS DISTINCT FROM vlp.low"
        )
        stale_snapshot = cur.fetchone()[0]
    if stale_snapshot:
        fail(
            "target snapshot disagrees with its history for %d variants", stale_snapshot
        )
    else:
        logger.info("target snapshot consistent with its history")

    logger.info("verify: %s", "PASS" if ok else "FAIL")
    return ok


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_exp = sub.add_parser("export", help="preflight + export source history to CSV")
    p_exp.add_argument("--source-url", required=True)
    p_exp.add_argument("--out", required=True)
    p_exp.add_argument(
        "--force",
        action="store_true",
        help="export despite stale/missing-day preflight findings",
    )

    p_imp = sub.add_parser("import", help="stage CSV, re-key, refresh snapshot")
    p_imp.add_argument("--target-url", required=True)
    p_imp.add_argument("--in", dest="in_path", required=True)
    p_imp.add_argument("--keep-staging", action="store_true")

    p_ver = sub.add_parser("verify", help="compare source vs target")
    p_ver.add_argument("--source-url", required=True)
    p_ver.add_argument("--target-url", required=True)
    p_ver.add_argument("--samples", type=int, default=12)

    args = parser.parse_args(argv)

    if args.command == "export":
        conn = psycopg2.connect(args.source_url)
        try:
            export_prices(conn, args.out, force=args.force)
        finally:
            conn.close()
        return 0
    if args.command == "import":
        conn = psycopg2.connect(args.target_url)
        try:
            import_prices(conn, args.in_path, keep_staging=args.keep_staging)
        finally:
            conn.close()
        return 0
    # verify
    source_conn = psycopg2.connect(args.source_url)
    target_conn = psycopg2.connect(args.target_url)
    try:
        return 0 if verify_transfer(source_conn, target_conn, args.samples) else 1
    finally:
        source_conn.close()
        target_conn.close()


if __name__ == "__main__":
    sys.exit(main())
