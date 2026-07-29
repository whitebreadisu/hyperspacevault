"""BL-29 ingestion: upserts base_cards/card_variants (+ sets, aspects,
keywords, traits) from a swuapi export, keyed on swuapi_id throughout so
re-running is idempotent (BL-33 step 3).

Usage:
    python -m app.ingestion.run_swuapi_ingestion --file path/to/export.json
    python -m app.ingestion.run_swuapi_ingestion --live

`transform()` (swuapi_transform.py) does the actual root-resolution /
classification work and is DB-free; this module is just the upsert layer
plus the CLI entrypoint.
"""

import argparse
import json
import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.ingestion.swuapi_transform import IngestionResult, transform

logger = logging.getLogger(__name__)


def load_export_from_file(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def upsert_sets(db: Session, sets: list[dict]) -> None:
    for s in sets:
        db.execute(
            text(
                "INSERT INTO sets "
                "(code, name, is_base_set, release_date, total_cards, swuapi_updated_at) "
                "VALUES (:code, :name, :is_base_set, :release_date, :total_cards, "
                ":swuapi_updated_at) "
                "ON CONFLICT (code) DO UPDATE SET "
                "name = EXCLUDED.name, "
                "is_base_set = EXCLUDED.is_base_set, "
                "release_date = COALESCE(EXCLUDED.release_date, sets.release_date), "
                "total_cards = EXCLUDED.total_cards, "
                "swuapi_updated_at = EXCLUDED.swuapi_updated_at"
            ),
            s,
        )


def upsert_base_cards(db: Session, base_cards: list[dict]) -> dict[str, int]:
    set_ids = {
        row.code: row.id for row in db.execute(text("SELECT id, code FROM sets"))
    }
    base_card_ids: dict[str, int] = {}
    for bc in base_cards:
        params = {**bc, "set_id": set_ids[bc["set_code"]]}
        row = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, subtitle, type, type2, double_sided, "
                "rarity, cost, power, hp, arena, is_unique, front_text, back_text, "
                "epic_action, artist, is_token, swuapi_id) "
                "VALUES (:set_id, :base_card_number, :name, :subtitle, :type, :type2, "
                ":double_sided, :rarity, :cost, :power, :hp, :arena, :is_unique, "
                ":front_text, :back_text, :epic_action, :artist, :is_token, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET "
                "set_id = EXCLUDED.set_id, "
                "base_card_number = EXCLUDED.base_card_number, "
                "name = EXCLUDED.name, "
                "subtitle = EXCLUDED.subtitle, "
                "type = EXCLUDED.type, "
                "type2 = EXCLUDED.type2, "
                "double_sided = EXCLUDED.double_sided, "
                "rarity = EXCLUDED.rarity, "
                "cost = EXCLUDED.cost, "
                "power = EXCLUDED.power, "
                "hp = EXCLUDED.hp, "
                "arena = EXCLUDED.arena, "
                "is_unique = EXCLUDED.is_unique, "
                "front_text = EXCLUDED.front_text, "
                "back_text = EXCLUDED.back_text, "
                "epic_action = EXCLUDED.epic_action, "
                "artist = EXCLUDED.artist, "
                "is_token = EXCLUDED.is_token "
                "RETURNING id"
            ),
            params,
        ).first()
        base_card_ids[bc["swuapi_id"]] = row.id
    return base_card_ids


def upsert_card_variants(
    db: Session, card_variants: list[dict], base_card_ids: dict[str, int]
) -> dict[str, int]:
    variant_ids: dict[str, int] = {}
    for cv in card_variants:
        params = {
            "base_card_id": base_card_ids[cv["base_card_swuapi_id"]],
            "variant_type": cv["variant_type"],
            "source_set_code": cv["source_set_code"],
            "card_number": cv["card_number"],
            "front_image_url": cv["front_image_url"],
            "back_image_url": cv["back_image_url"],
            "stamp_group": cv["stamp_group"],
            "swuapi_id": cv["swuapi_id"],
        }
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, "
                "front_image_url, back_image_url, stamp_group, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :source_set_code, :card_number, "
                ":front_image_url, :back_image_url, :stamp_group, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET "
                "base_card_id = EXCLUDED.base_card_id, "
                "variant_type = EXCLUDED.variant_type, "
                "source_set_code = EXCLUDED.source_set_code, "
                "card_number = EXCLUDED.card_number, "
                "front_image_url = EXCLUDED.front_image_url, "
                "back_image_url = EXCLUDED.back_image_url, "
                "stamp_group = EXCLUDED.stamp_group "
                "RETURNING id"
            ),
            params,
        ).first()
        variant_ids[cv["swuapi_id"]] = row.id
    return variant_ids


def update_standard_variant_ids(
    db: Session,
    card_variants: list[dict],
    base_card_ids: dict[str, int],
    variant_ids: dict[str, int],
) -> None:
    """base_cards.standard_variant_id for every base card with a Standard
    printing among its own variants. Left null for the sole true exception
    (Zam, mapping spec §3.3) -- nothing to set, so it's a no-op for that row."""
    standard_variant_by_base: dict[str, str] = {}
    for cv in card_variants:
        if cv["variant_type"] == "Standard":
            standard_variant_by_base.setdefault(
                cv["base_card_swuapi_id"], cv["swuapi_id"]
            )
    for base_swuapi_id, variant_swuapi_id in standard_variant_by_base.items():
        db.execute(
            text("UPDATE base_cards SET standard_variant_id = :vid WHERE id = :bid"),
            {
                "vid": variant_ids[variant_swuapi_id],
                "bid": base_card_ids[base_swuapi_id],
            },
        )


def upsert_attributes(
    db: Session,
    table: str,
    column: str,
    attrs: dict[str, list[str]],
    base_card_ids: dict[str, int],
) -> None:
    for base_swuapi_id, values in attrs.items():
        base_card_id = base_card_ids[base_swuapi_id]
        for value in values:
            db.execute(
                text(
                    f"INSERT INTO {table} (base_card_id, {column}) "
                    f"VALUES (:base_card_id, :value) ON CONFLICT DO NOTHING"
                ),
                {"base_card_id": base_card_id, "value": value},
            )


def run_ingestion(export: dict, db: Session | None = None) -> IngestionResult:
    owns_session = db is None
    db = db or SessionLocal()
    try:
        result = transform(export)
        upsert_sets(db, result.sets)
        base_card_ids = upsert_base_cards(db, result.base_cards)
        variant_ids = upsert_card_variants(db, result.card_variants, base_card_ids)
        update_standard_variant_ids(
            db, result.card_variants, base_card_ids, variant_ids
        )
        upsert_attributes(db, "card_aspects", "aspect", result.aspects, base_card_ids)
        upsert_attributes(
            db, "card_keywords", "keyword", result.keywords, base_card_ids
        )
        upsert_attributes(db, "card_traits", "trait", result.traits, base_card_ids)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="BL-29 swuapi ingestion")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", type=Path, help="path to a captured export JSON file")
    source.add_argument(
        "--live", action="store_true", help="pull the live export from api.swuapi.com"
    )
    args = parser.parse_args()

    if args.live:
        from app.ingestion.swuapi_client import fetch_export

        export = fetch_export()
    else:
        export = load_export_from_file(args.file)

    result = run_ingestion(export)
    logger.info(
        "Ingestion complete: %d sets, %d base_cards, %d card_variants, %d exceptions",
        len(result.sets),
        len(result.base_cards),
        len(result.card_variants),
        len(result.exceptions),
    )
    print(
        f"Ingestion complete: {len(result.sets)} sets, {len(result.base_cards)} "
        f"base_cards, {len(result.card_variants)} card_variants, "
        f"{len(result.exceptions)} exceptions"
    )
    if result.duplicate_image_warnings:
        print(
            f"WARNING: {len(result.duplicate_image_warnings)} suspected swuapi "
            "duplicate-image groups (§10.8) -- see result.duplicate_image_warnings"
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
