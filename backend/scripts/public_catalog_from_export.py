"""Write the public card-page catalog (the JSON shape the planned
`GET /api/public/cards` route returns) from a local swuapi export.

The card-page generator (frontend/scripts/public-pages/generate.mjs) reads
one JSON document in that shape. In CI it will come from the route; locally,
with no database, this script builds the same document from an export run
through `swuapi_transform.transform()`, so the generator never knows which
source filled it. It is also the fixture builder for the generator's checks.

    python scripts/public_catalog_from_export.py EXPORT.json --out OUT.json \
        [--only SOR:5,TWI:15] [--prices-from https://<host>/api/base-cards]

An export carries no database ids and no prices. `--prices-from` overlays
both from one read of an environment's public list endpoint, joined per
printing on (source set, card number, variant type); a printing with no
match keeps a negative stand-in id and `price: null`.

Standard library only. The output holds full rules text, so it is written
outside version control (BL-170); never commit it.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ingestion.swuapi_classify import classify_variant  # noqa: E402
from app.ingestion.swuapi_transform import transform  # noqa: E402
from app.services.image_paths import same_origin_renditions  # noqa: E402


def _list_overlay(url: str) -> dict[tuple[str, str, str], dict]:
    """(source_set_code, card_number, variant_type) -> {variant_id, price,
    base_card_id} from an environment's public list endpoint."""
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - caller-chosen URL
        rows = json.load(resp)
    out: dict[tuple[str, str, str], dict] = {}
    for card in rows:
        for v in card["variants"]:
            key = (v["source_set_code"], v["card_number"], v["variant_type"])
            out[key] = {
                "variant_id": v["variant_id"],
                "price": v.get("price"),
                "base_card_id": card["id"],
            }
    return out


def build(
    export: dict, only: set[tuple[str, str]] | None, overlay: dict | None
) -> dict:
    result = transform(export)
    set_names = {s["code"]: s["name"] for s in result.sets}
    counts = Counter(b["set_code"] for b in result.base_cards if not b["is_token"])

    variants_by_base: dict[str, list[dict]] = {}
    for v in result.card_variants:
        variants_by_base.setdefault(v["base_card_swuapi_id"], []).append(v)

    next_stand_in = -1
    cards = []
    for b in sorted(
        result.base_cards,
        key=lambda b: (
            b["set_code"],
            int(b["base_card_number"]) if b["base_card_number"].isdigit() else 10**6,
        ),
    ):
        if b["is_token"]:
            continue
        if only is not None and (b["set_code"], b["base_card_number"]) not in only:
            continue
        base_id = None
        variants = []
        for v in variants_by_base.get(b["swuapi_id"], []):
            c = classify_variant(v["variant_type"], v["source_set_code"])
            hit = (overlay or {}).get(
                (v["source_set_code"], v["card_number"], v["variant_type"])
            )
            if hit:
                base_id = base_id or hit["base_card_id"]
                variant_id, price = hit["variant_id"], hit["price"]
            else:
                variant_id, price = next_stand_in, None
                next_stand_in -= 1
            front, back = v["front_image_url"], v["back_image_url"]
            variants.append(
                {
                    "variant_id": variant_id,
                    "variant_type": v["variant_type"],
                    "finish": c.finish,
                    "channel": c.channel,
                    "stamped": c.stamped,
                    "source_set_code": v["source_set_code"],
                    "source_set_name": set_names.get(
                        v["source_set_code"], v["source_set_code"]
                    ),
                    "card_number": v["card_number"],
                    "front_image_url": front,
                    "back_image_url": back,
                    "front_images": same_origin_renditions(front) if front else None,
                    "back_images": same_origin_renditions(back) if back else None,
                    "stamp_group": v["stamp_group"],
                    "price": price,
                }
            )
        uuid = b["swuapi_id"]
        cards.append(
            {
                "id": base_id if base_id is not None else next_stand_in,
                "set_code": b["set_code"],
                "set_name": set_names.get(b["set_code"], b["set_code"]),
                "base_card_number": b["base_card_number"],
                "name": b["name"],
                "subtitle": b["subtitle"],
                "type": b["type"],
                "type2": b["type2"],
                "double_sided": b["double_sided"],
                "rarity": b["rarity"],
                "cost": b["cost"],
                "power": b["power"],
                "hp": b["hp"],
                "arena": b["arena"],
                "is_unique": b["is_unique"],
                "front_text": b["front_text"],
                "back_text": b["back_text"],
                "epic_action": b["epic_action"],
                "artist": b["artist"],
                "is_token": False,
                "aspects": result.aspects.get(uuid, []),
                "keywords": result.keywords.get(uuid, []),
                "traits": result.traits.get(uuid, []),
                "variants": variants,
            }
        )
        if base_id is None:
            next_stand_in -= 1

    return {
        "build_sha": "local-export",
        "sets": [
            {
                "code": s["code"],
                "name": s["name"],
                "is_base_set": s["is_base_set"],
                "release_date": s["release_date"],
            }
            for s in result.sets
        ],
        "counts": dict(sorted(counts.items())),
        "cards": cards,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("export", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", help="comma-separated SET:NUMBER list, e.g. SOR:5,TWI:15")
    ap.add_argument("--prices-from", help="an environment's GET /api/base-cards URL")
    args = ap.parse_args()

    export = json.loads(args.export.read_text(encoding="utf-8"))
    only = None
    if args.only:
        only = {tuple(x.strip().upper().split(":", 1)) for x in args.only.split(",")}
    overlay = _list_overlay(args.prices_from) if args.prices_from else None
    doc = build(export, only, overlay)
    doc["source"] = {"export": args.export.name, "prices_from": args.prices_from}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    found = {(c["set_code"], c["base_card_number"]) for c in doc["cards"]}
    missing = sorted(only - found) if only else []
    print(
        f"wrote {len(doc['cards'])} cards to {args.out}"
        + (f"; not found: {missing}" if missing else "")
    )


if __name__ == "__main__":
    main()
