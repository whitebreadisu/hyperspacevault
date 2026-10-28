"""BL-279 WS-3 fold-in 1: build the small swuapi export the CI local stack boots.

One-off, run from backend/ when the journey card list changes:

    python scripts/trim_export_fixture.py [--source PATH]

Reads the newest capture under app/ingestion/data/ (gitignored; same order as
app/ingestion/bootstrap.py: swuapi_export_current.json, else the newest dated
capture) and writes app/ingestion/data/fixtures/swuapi_export_journeys.json in
the export's own shape ({"meta", "sets", "cards"}), so the ingestion accepts it
unchanged. Kept: the journey cards (Standard rows named below), the full
variant family of each (the root and every record whose variant_of_uuid chain
reaches it; the bulky unread rules/art fields are dropped), the Standard card a non-Standard root re-anchors to (mapping spec
section 10.6) with its family, and the set records for every set code kept.
The variant-graph invariant is asserted: every variant_of_uuid resolves inside
the fixture.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "ingestion" / "data"
OUT = DATA_DIR / "fixtures" / "swuapi_export_journeys.json"

# (set_code, card_number), all variant_type "Standard".
JOURNEY_CARDS: dict[str, list[tuple[str, str]]] = {
    # frontend/e2e/journeys/seed-a.csv (J3 = SOR 5, J7 owned = SOR 10, SOR 50, SHD 13)
    "seed": [
        ("SOR", "5"),
        ("SOR", "10"),
        ("SOR", "20"),
        ("SOR", "50"),
        ("SOR", "100"),
        ("SHD", "1"),
        ("SHD", "13"),
        ("SHD", "30"),
        ("SHD", "50"),
        ("SHD", "100"),
    ],
    # J2 (search + add) and J6 (scan: Cell Block Guard, SOR 229)
    "j2_j6": [("SOR", "200"), ("SOR", "229")],
    # spares for W3-08: J7's two missing deck cards, J5's disjoint import rows
    "spares": [
        ("SOR", "8"),
        ("SOR", "9"),
        ("SOR", "11"),
        ("SOR", "12"),
        ("SOR", "13"),
        ("SOR", "14"),
        ("SOR", "15"),
        ("SOR", "16"),
    ],
}


DROPPED = {"rules", "art_metadata", "additionalRulings"}


def newest_export() -> Path:
    current = DATA_DIR / "swuapi_export_current.json"
    if current.exists():
        return current
    dated = sorted(p for p in DATA_DIR.glob("swuapi_export_*.json") if p != current)
    if not dated:
        raise SystemExit("no swuapi export under app/ingestion/data/")
    return dated[-1]


def norm(value: str | None) -> str:
    return (value or "").strip().casefold()


def trim(export: dict) -> dict:
    cards = export["cards"]
    by_uuid = {c["uuid"]: c for c in cards}
    children: dict[str, list[dict]] = {}
    for c in cards:
        if c["variant_of_uuid"]:
            children.setdefault(c["variant_of_uuid"], []).append(c)

    def root_of(card: dict) -> dict:
        while card["variant_of_uuid"]:
            card = by_uuid[card["variant_of_uuid"]]
        return card

    def family(root: dict) -> list[dict]:
        out, stack = [], [root]
        while stack:
            cur = stack.pop()
            out.append(cur)
            stack.extend(children.get(cur["uuid"], []))
        return out

    wanted = [rc for group in JOURNEY_CARDS.values() for rc in group]
    keep: dict[str, dict] = {}
    roots: list[dict] = []
    for set_code, number in wanted:
        hits = [
            c
            for c in cards
            if c["set_code"] == set_code
            and c["card_number"] == number
            and c["variant_type"] == "Standard"
            # tokens share card numbers (SHD_T001 is card_number "1")
            and c["collector_number"] == f"{set_code}_{int(number):03d}"
        ]
        if len(hits) != 1:
            raise SystemExit(f"{set_code} {number}: {len(hits)} Standard matches")
        roots.append(root_of(hits[0]))

    while roots:
        root = roots.pop()
        if root["uuid"] in keep:
            continue
        for member in family(root):
            keep[member["uuid"]] = member
        # Section 10.6: a non-Standard, non-linked root re-anchors to the
        # Standard card of the same name/subtitle; keep that card's family.
        if root["variant_type"] != "Standard":
            for c in cards:
                if (
                    c["variant_type"] == "Standard"
                    and norm(c["name"]) == norm(root["name"])
                    and norm(c.get("subtitle")) == norm(root.get("subtitle"))
                ):
                    roots.append(root_of(c))

    # Bulky fields nothing in the backend reads.
    kept = [
        {k: v for k, v in c.items() if k not in DROPPED}
        for c in cards
        if c["uuid"] in keep
    ]
    unresolved = [
        c["uuid"]
        for c in kept
        if c["variant_of_uuid"] and c["variant_of_uuid"] not in keep
    ]
    assert not unresolved, f"variant_of_uuid not in fixture: {unresolved}"
    n_links = sum(1 for c in kept if c["variant_of_uuid"])
    print(f"variant_of_uuid check: all {n_links} links resolve inside the fixture")

    codes = {c["set_code"] for c in kept}
    sets = [s for s in export["sets"] if s["code"] in codes]
    assert {s["code"] for s in sets} == codes, "a kept card's set record is missing"
    meta = dict(export["meta"])
    meta["totalCards"], meta["totalSets"] = len(kept), len(sets)
    return {"meta": meta, "sets": sets, "cards": kept}


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    source = args.source or newest_export()
    export = json.loads(source.read_text(encoding="utf-8"))
    out = trim(export)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"source {source.name}: {len(export['cards'])} cards")
    print(
        f"wrote {OUT.name}: {len(out['cards'])} cards, {len(out['sets'])} sets, "
        f"{OUT.stat().st_size} bytes"
    )


if __name__ == "__main__":
    main()
