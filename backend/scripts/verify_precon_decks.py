"""BL-151 S1: standalone verification for frontend/src/data/preconDecks.json.

Reads the precon-deck data (static, checked-in, prep-time-resolved per
specification_documents/planning/Definition_BulkAddPrecons_2026-07-24.md
S3) and asserts it is safe to ship:

  1. every card's swuapi_uuid exists in card_variants (a stale/typo'd uuid
     would silently 404 or mis-add at import time otherwise);
  2. per-deck physical totals match the research doc's counts -- 50-card
     precons sum to 52 physical cards (50 main + 1 leader + 1 base), the
     TS26 Twin Suns decks sum to 83 (80 main + 2 leaders + 1 base). Any
     deck whose set_code == "IBH" is also expected to total 52, but is
     additionally held to a stronger rule (see #5 below) since IBH's
     collector numbers double as quantity slots rather than the usual
     one-number-per-design convention (see
     specification_documents/analysis/IBH_Intro_Deck_Lists_Research_2026-07-24.md);
  3. swuapi_uuid values are unique within a single deck (a repeated uuid
     would mean two rows silently collapsing into one import line, or a
     copy/paste bug during data prep);
  4. every row's quantity is >= 1 (a zero/negative quantity is meaningless
     for an "add cards" payload);
  5. IBH-only: every quantity is exactly 1, and the union of both IBH
     decks' uuids is exactly the catalog's full IBH card_variants set --
     no gaps, no overlap between the two decks (the 104-card set is
     supposed to partition perfectly across Leia's deck (1-52) and
     Vader's deck (53-104)).

Usage:
    python backend/scripts/verify_precon_decks.py [path/to/preconDecks.json]

    Default path (when omitted): ../frontend/src/data/preconDecks.json,
    resolved relative to the repo root (this script's grandparent
    directory), so it works whether invoked from the repo root or from
    backend/.

Requires DATABASE_URL in the environment (same convention as
app/database.py) pointing at a Postgres instance whose card_variants table
reflects the current catalog. Exits non-zero with a clear per-deck failure
list on any violation; prints a one-line summary and exits 0 on success.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import create_engine, text

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JSON_PATH = REPO_ROOT / "frontend" / "src" / "data" / "preconDecks.json"

STANDARD_DECK_PHYSICAL_TOTAL = 52  # 50 main deck + 1 leader + 1 base
TS26_DECK_PHYSICAL_TOTAL = 83  # 80 main deck + 2 leaders + 1 base


@dataclass
class DeckFailures:
    code: str
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def expected_total_for(deck: dict) -> int:
    return TS26_DECK_PHYSICAL_TOTAL if deck.get("set_code") == "TS26" else STANDARD_DECK_PHYSICAL_TOTAL


def check_deck(deck: dict, known_uuids: set[str]) -> DeckFailures:
    code = deck.get("code", "<missing code>")
    result = DeckFailures(code=code)
    cards = deck.get("cards", [])

    if not cards:
        result.problems.append("deck has zero card rows")
        return result

    seen_uuids: set[str] = set()
    total_qty = 0
    for i, card in enumerate(cards):
        uuid = card.get("swuapi_uuid")
        qty = card.get("quantity")
        label = f"row {i} ({card.get('name', '?')} {card.get('set_code', '?')}#{card.get('card_number', '?')})"

        if not uuid:
            result.problems.append(f"{label}: missing swuapi_uuid")
            continue
        if uuid not in known_uuids:
            result.problems.append(f"{label}: swuapi_uuid {uuid!r} not found in card_variants")

        if uuid in seen_uuids:
            result.problems.append(f"{label}: swuapi_uuid {uuid!r} is duplicated within this deck")
        seen_uuids.add(uuid)

        if not isinstance(qty, int) or qty < 1:
            result.problems.append(f"{label}: quantity {qty!r} is not an integer >= 1")
        else:
            total_qty += qty

    expected = expected_total_for(deck)
    if total_qty != expected:
        result.problems.append(
            f"physical total {total_qty} != expected {expected} "
            f"({'TS26 (80 + 2 leaders + base)' if expected == TS26_DECK_PHYSICAL_TOTAL else '50-card deck (50 + leader + base)'})"
        )

    return result


def check_ibh_partition(decks: list[dict], known_uuids: set[str], ibh_catalog_uuids: set[str]) -> list[str]:
    """IBH-specific: every quantity == 1, and the union of all IBH decks'
    uuids equals exactly the catalog's IBH card_variants set (no gaps, no
    overlap across decks)."""
    problems: list[str] = []
    ibh_decks = [d for d in decks if d.get("set_code") == "IBH"]
    if not ibh_decks:
        return problems

    per_deck_uuids: dict[str, set[str]] = {}
    for deck in ibh_decks:
        code = deck.get("code", "<missing code>")
        uuids = set()
        for card in deck.get("cards", []):
            uuid = card.get("swuapi_uuid")
            qty = card.get("quantity")
            if qty != 1:
                problems.append(f"IBH deck {code}: row {card.get('name', '?')} has quantity {qty!r}, expected exactly 1")
            if uuid:
                uuids.add(uuid)
        per_deck_uuids[code] = uuids

    all_codes = list(per_deck_uuids)
    for i, code_a in enumerate(all_codes):
        for code_b in all_codes[i + 1 :]:
            overlap = per_deck_uuids[code_a] & per_deck_uuids[code_b]
            if overlap:
                problems.append(f"IBH decks {code_a} and {code_b} share {len(overlap)} uuid(s) -- decks must partition the set")

    union_uuids = set().union(*per_deck_uuids.values()) if per_deck_uuids else set()
    missing_from_json = ibh_catalog_uuids - union_uuids
    extra_in_json = union_uuids - ibh_catalog_uuids
    if missing_from_json:
        problems.append(
            f"IBH decks are missing {len(missing_from_json)} uuid(s) present in the catalog's IBH set: "
            f"{sorted(missing_from_json)[:5]}{'...' if len(missing_from_json) > 5 else ''}"
        )
    if extra_in_json:
        problems.append(
            f"IBH decks reference {len(extra_in_json)} uuid(s) not in the catalog's IBH set (or not IBH-sourced): "
            f"{sorted(extra_in_json)[:5]}{'...' if len(extra_in_json) > 5 else ''}"
        )

    return problems


def load_known_uuids(engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT swuapi_id FROM card_variants")).fetchall()
    return {r[0] for r in rows}


def load_ibh_catalog_uuids(engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT swuapi_id FROM card_variants WHERE source_set_code = 'IBH'")
        ).fetchall()
    return {r[0] for r in rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "json_path",
        nargs="?",
        default=str(DEFAULT_JSON_PATH),
        help="path to preconDecks.json (default: ../frontend/src/data/preconDecks.json relative to the repo root)",
    )
    args = parser.parse_args()

    json_path = Path(args.json_path)
    if not json_path.is_file():
        print(f"ABORT: no such file: {json_path}", file=sys.stderr)
        return 2

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    decks = payload.get("decks", [])
    if not decks:
        print("ABORT: JSON has zero decks", file=sys.stderr)
        return 2

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ABORT: DATABASE_URL is not set", file=sys.stderr)
        return 2

    engine = create_engine(database_url)
    known_uuids = load_known_uuids(engine)
    ibh_catalog_uuids = load_ibh_catalog_uuids(engine)

    deck_results = [check_deck(deck, known_uuids) for deck in decks]
    ibh_problems = check_ibh_partition(decks, known_uuids, ibh_catalog_uuids)

    failures = [r for r in deck_results if not r.ok]

    print(f"Checked {len(decks)} deck(s) from {json_path}")
    for r in deck_results:
        status = "OK" if r.ok else "FAIL"
        card_count = len(next(d for d in decks if d.get("code") == r.code).get("cards", []))
        print(f"  [{status}] {r.code} ({card_count} rows)")

    if not failures and not ibh_problems:
        print("PASS: all decks verified clean.")
        return 0

    print("\n=== FAILURES ===")
    for r in failures:
        print(f"\n{r.code}:")
        for p in r.problems:
            print(f"  - {p}")

    if ibh_problems:
        print("\nIBH partition check:")
        for p in ibh_problems:
            print(f"  - {p}")

    print(
        f"\nFAIL: {len(failures)}/{len(decks)} deck(s) with problems"
        + (f", {len(ibh_problems)} IBH partition issue(s)" if ibh_problems else "")
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
