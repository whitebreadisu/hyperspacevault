"""BL-136 P1: builds `tcgplayer_products` (the variant<->tcgcsv-product
mapping) for every set in tcgcsv_client.ALL_PRICED_GROUP_IDS (the 10 root
sets plus, since BL-174, the 8 Weekly Play container sets), and
regenerates the human-readable exceptions report
(specification_documents/analysis/tcgplayer_mapping_exceptions.md, same
pattern as swuapi_standard_variant_exceptions.md).

Idempotent: re-running upserts on variant_id (ON CONFLICT DO UPDATE), so a
later run with a corrected join or a newly-ingested set simply refreshes
existing rows and adds new ones -- never dupes.

Usage:
    python -m app.ingestion.run_tcgplayer_mapping
    python -m app.ingestion.run_tcgplayer_mapping --set-code SOR
    python -m app.ingestion.run_tcgplayer_mapping --dry-run
"""

from __future__ import annotations

import argparse
import logging
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.ingestion.swuapi_classify import WEEKLY_PLAY_VARIANT_TYPES
from app.ingestion.tcgcsv_client import (
    ALL_PRICED_GROUP_IDS,
    WEEKLY_PLAY_GROUP_IDS,
    TcgcsvClient,
    throttle,
)
from app.ingestion.tcgplayer_mapping import (
    CatalogVariant,
    MappingResult,
    build_mapping,
    resolve_weekly_play_variant_type,
)

logger = logging.getLogger(__name__)

# BL-149: the repo-relative default only resolves correctly inside a full
# checkout (parents[3] walks ingestion -> app -> backend -> repo root). The
# runbook's real invocation (`docker run -v <repo>/backend:/app ... python -m
# app.ingestion.run_tcgplayer_mapping`) mounts ONLY backend/, so parents[3]
# lands outside the container filesystem entirely (specification_documents/
# doesn't exist there) -- this used to raise and crash main() AFTER the DB
# commit, masking a successful mapping run and skipping the report.
# Configurable via TCGPLAYER_MAPPING_REPORT_PATH; write_exceptions_report()
# below also degrades to a warning instead of raising if the resolved path
# (default or override) still isn't writable.
EXCEPTIONS_REPORT_PATH = Path(
    os.environ.get("TCGPLAYER_MAPPING_REPORT_PATH")
    or (
        Path(__file__).resolve().parents[3]
        / "specification_documents"
        / "analysis"
        / "tcgplayer_mapping_exceptions.md"
    )
)


def fetch_catalog_variants(db: Session, set_code: str) -> list[CatalogVariant]:
    """ALL non-fixture variants printed IN this set (cv.source_set_code,
    not the base card's own set -- for the root sets this mapping targets
    the two always coincide, since a root set's core tiers are its own
    printings). Unfiltered by variant_type/is_token here -- build_mapping's
    target_variant_types gate and its separate is_token check are what
    actually narrow this down to the finishes a given mapping pass wants
    (root-set core/Prestige/Showcase, or BL-174's Weekly Play).

    tcgcsv product names are "<name> - <subtitle>" for every card that has
    a subtitle (live-verified against SOR: "Luke Skywalker - Jedi Knight",
    "Mon Mothma - Voice of the Rebellion", ...) and plain "<name>" for
    cards without one (generic units, Bases). This wasn't called out
    explicitly in the spike (which only compared bare names for a handful
    of examples) but is necessary for any set with named/subtitled
    cards -- composing "name - subtitle" here, matching tcgcsv's own
    convention, is what makes Leaders and other subtitled Units joinable at
    all; matching bare name against catalog `name` alone silently missed
    ~30% of SOR's core variants during this build."""
    rows = db.execute(
        text(
            "SELECT cv.id AS variant_id, bc.name AS name, bc.subtitle AS subtitle, "
            "cv.variant_type, bc.is_token "
            "FROM card_variants cv "
            "JOIN base_cards bc ON bc.id = cv.base_card_id "
            "WHERE cv.source_set_code = :set_code "
            # This dev DB is shared with the pytest suite (conftest.py's
            # seed_minimal_catalog inserts a small SOR-scoped fixture
            # catalog directly into it, swuapi_id prefixed 'test-') --
            # excluded here so real match-rate stats aren't diluted by
            # fixture rows that have no real tcgcsv product to match.
            "AND bc.swuapi_id NOT LIKE 'test-%'"
        ),
        {"set_code": set_code},
    ).all()
    return [
        CatalogVariant(
            variant_id=r.variant_id,
            base_card_name=f"{r.name} - {r.subtitle}" if r.subtitle else r.name,
            variant_type=r.variant_type,
            is_token=r.is_token,
        )
        for r in rows
    ]


def upsert_mapping(db: Session, result: MappingResult) -> None:
    for m in result.matches:
        db.execute(
            text(
                "INSERT INTO tcgplayer_products "
                "(variant_id, tcg_product_id, tcg_group_id, sub_type, "
                "match_method, matched_name) "
                "VALUES (:variant_id, :tcg_product_id, :tcg_group_id, "
                ":sub_type, :match_method, :matched_name) "
                "ON CONFLICT (variant_id) DO UPDATE SET "
                "tcg_product_id = EXCLUDED.tcg_product_id, "
                "tcg_group_id = EXCLUDED.tcg_group_id, "
                "sub_type = EXCLUDED.sub_type, "
                "match_method = EXCLUDED.match_method, "
                "matched_name = EXCLUDED.matched_name"
            ),
            {
                "variant_id": m.variant_id,
                "tcg_product_id": m.tcg_product_id,
                "tcg_group_id": m.tcg_group_id,
                "sub_type": m.sub_type,
                "match_method": m.match_method,
                "matched_name": m.matched_name,
            },
        )


@dataclass
class RunReport:
    results: dict[str, MappingResult]

    def render_exceptions_doc(self) -> str:
        generated = date.today().isoformat()
        lines = [
            "# TCGplayer Pricing Mapping — Current Exceptions",
            "",
            f"**Last generated:** {generated} (BL-136 P1 mapping run, "
            "`app.ingestion.run_tcgplayer_mapping`).",
            "",
            "Era-aware name+tier join per "
            "`specification_documents/analysis/Spike_TCGCSV_Pricing_2026-07-16.md` "
            "§4, widened by BL-174 (`Pricing_Coverage_NonCore_Finishes_2026-07-27.md`) "
            "to Showcase/Prestige finishes and Weekly Play groups. A variant "
            "lands here if it's a mapping-target finish for its set (root sets: "
            "Standard/Standard Foil/Hyperspace/Hyperspace Foil/Showcase/Standard "
            "Prestige/Foil Prestige/Serialized Prestige; Weekly Play groups: "
            "Weekly Play/Weekly Play Foil), non-token, with no matching tcgcsv "
            "product in its own set's tcgcsv group. Tokens are excluded from the "
            "denominator entirely (they have no priceable product by design, not "
            "a mapping gap). Promo/tournament tiers remain out of scope entirely "
            "(neither counted nor reported here).",
            "",
            "## Per-set match rates",
            "",
            "| Set | Target variants | Matched | Match rate | Tokens excluded |",
            "|---|---|---|---|---|",
        ]
        for set_code, result in self.results.items():
            s = result.stats
            lines.append(
                f"| {set_code} | {s.catalog_core_variants} | {s.matched} | "
                f"{s.match_rate:.1%} | {s.tokens_excluded} |"
            )

        total_exceptions = sum(len(r.exceptions) for r in self.results.values())
        lines += ["", f"## Current exceptions ({total_exceptions})", ""]
        if total_exceptions == 0:
            lines.append("None.")
        else:
            lines.append("| Set | Card Name | Variant Type | Reason |")
            lines.append("|---|---|---|---|")
            for set_code, result in self.results.items():
                for exc in result.exceptions:
                    lines.append(
                        f"| {set_code} | {exc.base_card_name} | "
                        f"{exc.variant_type} | {exc.reason} |"
                    )

        unmapped_all = {
            (set_code, name)
            for set_code, result in self.results.items()
            for name in result.unmapped_products
        }
        if unmapped_all:
            lines += [
                "",
                "## tcgcsv products with an unresolved tier suffix "
                f"({len(unmapped_all)})",
                "",
                "| Set | tcgcsv product name |",
                "|---|---|",
            ]
            for set_code, name in sorted(unmapped_all):
                lines.append(f"| {set_code} | {name} |")

        lines += [
            "",
            "---",
            "",
            "*This file is regenerated by "
            "`python -m app.ingestion.run_tcgplayer_mapping` on each run.*",
        ]
        return "\n".join(lines) + "\n"


def run(
    db: Session,
    client: TcgcsvClient,
    set_codes: list[str] | None = None,
    set_group_ids: dict[str, int] | None = None,
    weekly_play_set_codes: set[str] | None = None,
) -> RunReport:
    """set_group_ids defaults to the real ALL_PRICED_GROUP_IDS map (the 10
    root sets plus BL-174's 8 Weekly Play groups); tests inject a synthetic
    one (alongside a fake `client`) to exercise this function against
    isolated fixture data without a live tcgcsv call or touching the real
    catalog's rows.

    weekly_play_set_codes selects, per set_code, which build_mapping call
    shape to use: a code in this set gets target_variant_types={"Weekly
    Play", "Weekly Play Foil"} and resolve_fn=resolve_weekly_play_variant_
    type (BL-174's suffix-ignoring precedence for WP promo groups); every
    other code gets build_mapping's defaults (the root-set core/Prestige/
    Showcase precedence). Defaults to the real WEEKLY_PLAY_GROUP_IDS keys;
    kept as an explicit parameter (not hardcoded against that map) so a
    test can exercise the WP branch against a synthetic set code without
    touching the real map."""
    group_ids = set_group_ids or ALL_PRICED_GROUP_IDS
    wp_codes = (
        weekly_play_set_codes
        if weekly_play_set_codes is not None
        else set(WEEKLY_PLAY_GROUP_IDS)
    )
    targets = set_codes or list(group_ids.keys())
    results: dict[str, MappingResult] = {}

    for i, set_code in enumerate(targets):
        group_id = group_ids[set_code]
        catalog_variants = fetch_catalog_variants(db, set_code)

        # BL-183: a WP pass ALSO sources variants from its root set code
        # (SORP -> SOR). The first three sets' Weekly Play printings carry
        # the ROOT code in card_variants.source_set_code (SOR/SHD/TWI, 63
        # variants) rather than the "P" code the WP convention comment in
        # tcgcsv_client assumed -- swuapi only adopted the dedicated
        # "P"-set typing from JTL onward. Fetching both and concatenating
        # is era-agnostic: later-era root sets contribute no WP-typed
        # variants, so build_mapping's target filter drops their extras.
        if set_code in wp_codes and set_code.endswith("P"):
            catalog_variants += fetch_catalog_variants(db, set_code[:-1])

        if i > 0:
            throttle()
        products = client.products(group_id)
        throttle()
        prices = client.prices(group_id)

        if set_code in wp_codes:
            result = build_mapping(
                set_code,
                catalog_variants,
                products,
                prices,
                group_id,
                target_variant_types=WEEKLY_PLAY_VARIANT_TYPES,
                resolve_fn=resolve_weekly_play_variant_type,
            )
        else:
            result = build_mapping(
                set_code, catalog_variants, products, prices, group_id
            )
        results[set_code] = result
        upsert_mapping(db, result)

        logger.info(
            "mapping %s: %d/%d target variants matched (%.1f%%), %d exceptions, "
            "%d tokens excluded, %d unresolved tcgcsv products",
            set_code,
            result.stats.matched,
            result.stats.catalog_core_variants,
            result.stats.match_rate * 100,
            len(result.exceptions),
            result.stats.tokens_excluded,
            len(result.unmapped_products),
        )

    return RunReport(results=results)


def write_exceptions_report(report: RunReport, path: Path) -> None:
    """Writes the exceptions doc to `path`; warns instead of raising if it
    can't be written (BL-149). The DB commit always happens before this is
    called, so a report-write failure must never look like a run failure --
    that's exactly what made the container-mount crash costly to diagnose
    (looked like the whole run failed; the mapping had actually landed)."""
    try:
        path.write_text(report.render_exceptions_doc(), encoding="utf-8")
        logger.info("wrote %s", path)
    except OSError as exc:
        logger.warning(
            "could not write exceptions report to %s (%s) -- mapping DB writes "
            "already committed successfully; set TCGPLAYER_MAPPING_REPORT_PATH "
            "to a writable path (e.g. a mounted volume) to get the report on "
            "container runs",
            path,
            exc,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="BL-136 P1 tcgplayer mapping builder")
    parser.add_argument(
        "--set-code",
        action="append",
        dest="set_codes",
        help="limit to one or more set codes (repeatable); default: all root sets",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="fetch and report, but do not write to the database or the report file",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        with TcgcsvClient() as client:
            report = run(db, client, args.set_codes)
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
            write_exceptions_report(report, EXCEPTIONS_REPORT_PATH)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(report.render_exceptions_doc())


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    main()
