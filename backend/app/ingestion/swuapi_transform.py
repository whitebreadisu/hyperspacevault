"""Pure transform: a swuapi `/export/all`-shaped export -> base_cards /
card_variants (+ sets, aspects, keywords, traits) row dicts.

No DB access here -- see run_swuapi_ingestion.py for the upsert layer. This
module implements App Spec §10 exactly:
  - variant_of_uuid root resolution (walk to the ultimate root, <=2 hops,
    SWU_Standard_Variant_Mapping_Spec.md §3/§8).
  - the (name, subtitle) fallback re-anchoring for non-Standard roots,
    tokens exempt (§10.6); several matches -> the earliest-released set
    wins (mapping spec §6, ADR-0039).
  - is_token / is_base_set classification (§10.7, §4.1).
  - stamp_group consolidation (§10.5), via swuapi_classify's curated
    finish/channel/stamp rules.

Being DB-free and dependency-free (stdlib only) keeps it runnable on the
host directly against the captured fixture, without the backend container.
"""

from __future__ import annotations

import contextlib
import datetime
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.ingestion.swuapi_classify import classify_variant

MAX_HOPS = 2

# Curated, not derived -- App Spec §4.1: the derived rule ("contains
# >=1 root") misfires whenever a container set (e.g. C26) carries a stray
# orphan root.
BASE_SET_CODES = {
    "SOR",
    "SHD",
    "TWI",
    "JTL",
    "LOF",
    "SEC",
    "LAW",
    "ASH",
    "HMW",
    "TS26",
    "IBH",
    "IC27",
}

# The swuapi export does not include release_date for most sets. This table
# supplies the canonical dates for the known base sets so that ORDER BY
# release_date works correctly in a fresh DB (otherwise all dates are null
# and ordering falls back to insertion order, which varies by environment),
# and it is the release order the §10.6 fallback tie-break uses
# (_pick_earliest_released, ADR-0039). Every entry is the street date from
# the set's official product page (starwarsunlimited.com/products/<slug>,
# its "releaseDate" field), checked 2026-11-08; SHD, LOF, SEC and LAW were
# corrected that day (they had carried pre-announcement dates).
# Add new base sets here as they are confirmed.
CANONICAL_RELEASE_DATES: dict[str, str] = {
    "SOR": "2024-03-08",
    "SHD": "2024-07-12",
    "TWI": "2024-11-08",
    "JTL": "2025-03-14",
    "LOF": "2025-07-11",
    "IBH": "2025-10-03",
    "SEC": "2025-11-07",
    "LAW": "2026-03-13",
    "TS26": "2026-05-08",
    "ASH": "2026-07-17",
    "HMW": "2026-10-09",
    "IC27": "2026-11-20",
}


class AmbiguousFallbackError(ValueError):
    """Raised when the §10.6 fallback finds more than one non-token
    Standard match for a non-Standard root and the earliest-released-set
    tie-break (mapping spec §6, ADR-0039) cannot pick one: a match's set
    has no known release date, or two matches share the earliest
    (release date, set code) -- i.e. sit in the same set. Ingestion stops
    for manual review rather than guess. Zero matches is not raised: the
    root is recorded as an exception (flagged, never blocked)."""


@dataclass
class IngestionResult:
    sets: list[dict]
    base_cards: list[dict]
    card_variants: list[dict]  # each carries base_card_swuapi_id
    aspects: dict[str, list[str]]  # base_card swuapi_id -> aspect list
    keywords: dict[str, list[str]]
    traits: dict[str, list[str]]
    exceptions: list[dict] = field(default_factory=list)
    duplicate_image_warnings: list[dict] = field(default_factory=list)


# Same census pattern as frontend/src/public/publicCatalog.ts (MOJIBAKE).
_MOJIBAKE = re.compile("Ã|â€|Â|�")

# cp1252 high-range characters -> their byte, built from the codec. The five
# slots cp1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) are absent;
# they are covered by the "code point < 0x100 is its own byte" rule below,
# exactly as in the TS port.
_CP1252_HIGH: dict[str, int] = {}
for _b in range(0x80, 0xA0):
    with contextlib.suppress(UnicodeDecodeError):
        _CP1252_HIGH[bytes([_b]).decode("cp1252")] = _b


def repair_mojibake(text: str | None) -> str | None:
    """Undo UTF-8 text that was decoded as cp1252 upstream (App Spec §10.11; the
    TWI 15 General Grievous text carries ``canâ€™t`` and ``6Â or``).
    Port of repairMojibake in frontend/src/public/publicCatalog.ts: text
    without the census pattern is returned unchanged; otherwise each
    character maps to a byte (code point < 0x100 is its own byte, which also
    covers the five undefined cp1252 slots; a cp1252 high character maps
    through the table; anything else keeps the original), then the bytes are
    decoded as strict UTF-8, keeping the original if that fails."""
    if not text or not _MOJIBAKE.search(text):
        return text
    data = bytearray()
    for ch in text:
        code = ord(ch)
        if code < 0x100:
            data.append(code)
        elif ch in _CP1252_HIGH:
            data.append(_CP1252_HIGH[ch])
        else:
            return text
    try:
        return bytes(data).decode("utf-8")
    except UnicodeDecodeError:
        return text


def _is_token(card: dict) -> bool:
    return "Token" in card["type"]


def _normalize(value: str | None) -> str:
    return (value or "").strip().lower()


def _resolve_root(
    card: dict, by_uuid: dict[str, dict], max_hops: int = MAX_HOPS
) -> dict:
    """Walk variant_of_uuid until a root (variant_of_uuid: null) is found.
    Mapping spec §3/§8: must walk to the *ultimate* root, not assume one hop."""
    seen = {card["uuid"]}
    current = card
    hops = 0
    while current["variant_of_uuid"] is not None:
        parent = by_uuid.get(current["variant_of_uuid"])
        if parent is None:
            raise ValueError(
                f"{card['set_code']}_{card['card_number']} ({card['uuid']}) points to "
                "a variant_of_uuid not present in the export"
            )
        if parent["uuid"] in seen:
            raise ValueError(
                f"cycle detected resolving {card['set_code']}_{card['card_number']}"
            )
        seen.add(parent["uuid"])
        current = parent
        hops += 1
        if hops > max_hops:
            raise ValueError(
                f"{card['set_code']}_{card['card_number']} did not resolve to a root "
                f"within {max_hops} hops"
            )
    return current


def _fallback_matches(root: dict, cards: list[dict]) -> list[dict]:
    """§10.6: non-token cards elsewhere in the corpus, case-insensitively
    matching (name, subtitle), whose own variant_type is "Standard"."""
    name = _normalize(root["name"])
    subtitle = _normalize(root.get("subtitle"))
    return [
        c
        for c in cards
        if c["uuid"] != root["uuid"]
        and _normalize(c["name"]) == name
        and _normalize(c.get("subtitle")) == subtitle
        and c["variant_type"] == "Standard"
        and not _is_token(c)
    ]


def _parse_release_date(value: object) -> datetime.date | None:
    """The date part of an ISO date or timestamp ("2024-03-08" or
    "2024-03-08T00:00:00.000Z"); None for anything else, so a malformed
    upstream value counts as undated rather than mis-ordering a tie."""
    try:
        return datetime.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _set_release_date(code: str, swuapi_value: object) -> object:
    """The one release-date precedence, shared by the sets rows and the
    fallback tie-break (ADR-0039): the curated CANONICAL_RELEASE_DATES first
    (so an upstream edit can never flip a settled tie or the stored date),
    else swuapi's own sets[].release_date as given."""
    return CANONICAL_RELEASE_DATES.get(code) or swuapi_value or None


def _set_release_dates(export_sets: list[dict]) -> dict[str, datetime.date]:
    """set code -> release date for the fallback tie-break, by
    _set_release_date's precedence. A curated date that does not parse is a
    code error and raises; an unparseable upstream date leaves its set
    undated."""
    dates: dict[str, datetime.date] = {}
    for code, curated in CANONICAL_RELEASE_DATES.items():
        parsed = _parse_release_date(curated)
        if parsed is None:
            raise ValueError(f"CANONICAL_RELEASE_DATES[{code!r}] is not an ISO date")
        dates[code] = parsed
    for s in export_sets:
        if s["code"] in dates:
            continue
        parsed = _parse_release_date(s.get("release_date"))
        if parsed is not None:
            dates[s["code"]] = parsed
    return dates


def _pick_earliest_released(
    root: dict, matches: list[dict], release_dates: dict[str, datetime.date]
) -> dict:
    """Mapping spec §6 tie-break (ADR-0039): of several non-token Standard
    (name, subtitle) matches, the one in the earliest-released set wins --
    the original printing, which reprints (IC27 reprinting SOR's Echo Base)
    must not displace. Order key: (release date, set code), set code being
    the stable secondary key for two sets released the same day. Only the
    earliest set's matches matter: one there wins however many later sets
    also match. Raises AmbiguousFallbackError when a match's set has no
    known release date, or when the earliest set holds two or more matches
    -- nothing principled can decide those."""
    label = f"{root['set_code']}_{root['card_number']} ({root['name']!r})"
    undated = sorted({m["set_code"] for m in matches} - release_dates.keys())
    if undated:
        raise AmbiguousFallbackError(
            f"{label} matched {len(matches)} non-token Standard roots and "
            f"set(s) {', '.join(undated)} have no release date for the "
            "earliest-released tie-break -- add it to CANONICAL_RELEASE_DATES "
            "or decide manually (SWU_Standard_Variant_Mapping_Spec.md §6)"
        )
    earliest_set = min(
        {m["set_code"] for m in matches}, key=lambda c: (release_dates[c], c)
    )
    in_earliest = [m for m in matches if m["set_code"] == earliest_set]
    if len(in_earliest) > 1:
        raise AmbiguousFallbackError(
            f"{label} matched {len(matches)} non-token Standard roots, "
            f"{len(in_earliest)} of them in its earliest-released set "
            f"{earliest_set}; expected at most one there -- stop and decide "
            "manually (SWU_Standard_Variant_Mapping_Spec.md §6)"
        )
    return in_earliest[0]


def transform(export: dict) -> IngestionResult:
    cards = export["cards"]
    by_uuid = {c["uuid"]: c for c in cards}

    structural_root_uuid: dict[str, str] = {
        card["uuid"]: _resolve_root(card, by_uuid)["uuid"] for card in cards
    }

    # §10.6 fallback re-anchoring for non-Standard roots. Tokens are exempt
    # (stay their own base_card, §3.4) regardless of how many name/subtitle
    # matches they'd otherwise hit (e.g. GG_5 "Experience" matches 7).
    anchor_uuid: dict[str, str] = {}
    exceptions: list[dict] = []
    release_dates = _set_release_dates(export.get("sets") or [])
    for card in cards:
        if card["variant_of_uuid"] is not None or card["variant_type"] == "Standard":
            continue
        if _is_token(card):
            continue
        matches = _fallback_matches(card, cards)
        if len(matches) == 0:
            exceptions.append(card)
            continue
        match = (
            matches[0]
            if len(matches) == 1
            else _pick_earliest_released(card, matches, release_dates)
        )
        anchor_uuid[card["uuid"]] = _resolve_root(match, by_uuid)["uuid"]

    def final_base_card_uuid(card_uuid: str) -> str:
        root_uuid = structural_root_uuid[card_uuid]
        return anchor_uuid.get(root_uuid, root_uuid)

    base_card_uuids = {final_base_card_uuid(c["uuid"]) for c in cards}
    base_cards: list[dict] = []
    aspects: dict[str, list[str]] = {}
    keywords: dict[str, list[str]] = {}
    traits: dict[str, list[str]] = {}
    for uuid in base_card_uuids:
        root = by_uuid[uuid]
        base_cards.append(
            {
                "swuapi_id": root["uuid"],
                "set_code": root["set_code"],
                "base_card_number": root["card_number"],
                "name": repair_mojibake(root["name"]),
                "subtitle": repair_mojibake(root.get("subtitle")),
                "type": root["type"],
                "type2": root.get("type2"),
                "double_sided": bool(root.get("double_sided")),
                "rarity": root["rarity"],
                "cost": root.get("cost"),
                "power": root.get("power"),
                "hp": root.get("hp"),
                "arena": root.get("arena"),
                "is_unique": root.get("unique_flag"),
                "front_text": repair_mojibake(root.get("front_text")),
                "back_text": repair_mojibake(root.get("back_text")),
                "epic_action": repair_mojibake(root.get("epic_action")),
                "artist": repair_mojibake(root.get("artist")),
                "is_token": _is_token(root),
            }
        )
        aspects[uuid] = list(root.get("aspects") or [])
        keywords[uuid] = [repair_mojibake(k) or k for k in root.get("keywords") or []]
        traits[uuid] = [repair_mojibake(t) or t for t in root.get("traits") or []]

    card_variants: list[dict] = []
    image_groups: dict[str, list[str]] = {}
    for card in cards:
        classification = classify_variant(card["variant_type"], card["set_code"])
        base_uuid = final_base_card_uuid(card["uuid"])
        card_variants.append(
            {
                "swuapi_id": card["uuid"],
                "base_card_swuapi_id": base_uuid,
                "variant_type": card["variant_type"],
                "source_set_code": card["set_code"],
                "card_number": card["card_number"],
                "front_image_url": card.get("front_image_url"),
                "back_image_url": card.get("back_image_url"),
                "stamp_group": (
                    f"{base_uuid}:{classification.stamp_family}"
                    if classification.stamp_family
                    else None
                ),
            }
        )
        image_url = card.get("front_image_url")
        if image_url:
            image_groups.setdefault(image_url, []).append(card["uuid"])

    duplicate_image_warnings = [
        {"front_image_url": url, "swuapi_ids": uuids}
        for url, uuids in image_groups.items()
        if len(uuids) > 1
    ]

    sets: list[dict] = []
    for s in export["sets"]:
        code = s["code"]
        release_date = _set_release_date(code, s.get("release_date"))
        sets.append(
            {
                "code": code,
                "name": s["name"],
                "is_base_set": code in BASE_SET_CODES,
                "release_date": release_date,
                "total_cards": s.get("total_cards"),
                "swuapi_updated_at": s.get("updated_at"),
            }
        )

    return IngestionResult(
        sets=sets,
        base_cards=base_cards,
        card_variants=card_variants,
        aspects=aspects,
        keywords=keywords,
        traits=traits,
        exceptions=[
            {
                "set_code": c["set_code"],
                "card_number": c["card_number"],
                "name": c["name"],
                "subtitle": c.get("subtitle"),
                "variant_type": c["variant_type"],
            }
            for c in exceptions
        ],
        duplicate_image_warnings=duplicate_image_warnings,
    )


#  Hand-authored, per-card context for known exceptions -- a generic
# regeneration can't derive *why* a given card has no anchor, so this stays
# a small static lookup the table rendering consults. New genuine exceptions
# found by a future run and not present here simply render with an empty
# Notes cell rather than blocking regeneration.
_KNOWN_EXCEPTION_NOTES = {
    ("C26", "3"): (
        "The sole true orphan — no Standard `(name, subtitle)` match "
        "anywhere in the corpus. C26 is an in-development preview set (no "
        "release date, 6 total cards); likely previews a printing not yet "
        "revealed."
    ),
}


def render_exceptions_doc(exceptions: list[dict]) -> str:
    """Regenerates swuapi_standard_variant_exceptions.md's content (mapping
    spec §6). The "Current exceptions" table is fully data-driven; the
    surrounding prose documents the one-time census and fallback decision
    (App Spec §10.6), so it's kept static here rather than re-derived from
    a single ingestion run."""
    today = datetime.date.today().isoformat()
    lines = [
        "# Standard Variant Mapping — Current Exceptions",
        "",
        f"**Last generated:** {today} (swuapi ingestion run).",
        "",
        "**Definition:** a card is a "
        "standard-anchor exception if and only if it is a root "
        "(`variant_of_uuid: null`) whose own `variant_type` is **not** "
        '"Standard" **and** the `(name, subtitle)` fallback below finds **no '
        "non-token Standard match** elsewhere in the corpus (several matches "
        "are settled by the earliest-released-set tie-break, ADR-0039, or "
        "stop ingestion when it cannot decide). See "
        "[`SWU_Standard_Variant_Mapping_Spec.md`](SWU_Standard_Variant_Mapping_Spec.md) "
        "§6 for the full definition and philosophy.",
        "",
        "A one-time census of the swuapi export (mapping spec §6) found **15** "
        'structural non-`"Standard"` roots; **14 are treated as swuapi '
        "data errors** (an unpopulated `variant_of_uuid` link) and "
        "**re-anchored** to their Standard printing via a case-insensitive "
        "`(name, subtitle)` fallback at ingestion — they are *not* "
        "exceptions. One of those 14, `GG_5 Experience`, is a "
        "**duplicate-per-set token** (matched 7 Standards) and stays its "
        "own `base_card` (App Spec §3.4).",
        "",
        f"## Current exceptions ({len(exceptions)})",
        "",
    ]
    if exceptions:
        lines.append("| Set | Card # | Name | Subtitle | Variant Type | Notes |")
        lines.append("|-----|--------|------|----------|---------------|-------|")
        for exc in exceptions:
            note = _KNOWN_EXCEPTION_NOTES.get(
                (exc["set_code"], str(exc["card_number"])), ""
            )
            lines.append(
                f"| {exc['set_code']} | {exc['card_number']} | {exc['name']} | "
                f"{exc.get('subtitle') or ''} | {exc['variant_type']} | {note} |"
            )
    else:
        lines.append("_None — every non-Standard root resolved via the §6 fallback._")
    lines.extend(
        [
            "",
            "---",
            "",
            "*This file is regenerated by the swuapi ingestion script on each "
            "run. A card lands here only if the §6 fallback finds no "
            "non-token Standard match.*",
        ]
    )
    return "\n".join(lines) + "\n"


def regenerate_exceptions_doc(exceptions: list[dict], path: Path) -> None:
    path.write_text(render_exceptions_doc(exceptions), encoding="utf-8")
