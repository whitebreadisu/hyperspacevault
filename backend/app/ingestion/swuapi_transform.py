"""Pure transform: a swuapi `/export/all`-shaped export -> base_cards /
card_variants (+ sets, aspects, keywords, traits) row dicts.

No DB access here -- see run_swuapi_ingestion.py for the upsert layer. This
module implements SWU_Catalog_Redesign_Spec.md §10 exactly:
  - variant_of_uuid root resolution (walk to the ultimate root, <=2 hops,
    SWU_Standard_Variant_Mapping_Spec.md §3/§8).
  - the (name, subtitle) fallback re-anchoring for non-Standard roots,
    tokens exempt (§10.6).
  - is_token / is_base_set classification (§10.7, §4.1).
  - stamp_group consolidation (§10.5), via swuapi_classify's curated
    finish/channel/stamp rules.

Being DB-free and dependency-free (stdlib only) keeps it runnable on the
host directly against the captured fixture, without the backend container.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from pathlib import Path

from app.ingestion.swuapi_classify import classify_variant

MAX_HOPS = 2

# Curated, not derived -- redesign spec §4.1: the derived rule ("contains
# >=1 root") misfires on C26 (mostly a container, but holds Zam's orphan root).
BASE_SET_CODES = {
    "SOR",
    "SHD",
    "TWI",
    "JTL",
    "LOF",
    "SEC",
    "LAW",
    "ASH",
    "TS26",
    "IBH",
}

# The swuapi export does not include release_date for most sets. This table
# supplies the canonical dates for the known base sets so that ORDER BY
# release_date works correctly in a fresh DB (otherwise all dates are null
# and ordering falls back to insertion order, which varies by environment).
# Add new base sets here as they are confirmed.
CANONICAL_RELEASE_DATES: dict[str, str] = {
    "SOR": "2024-03-08",
    "SHD": "2024-08-02",
    "TWI": "2024-11-08",
    "JTL": "2025-03-14",
    "LOF": "2025-06-06",
    "SEC": "2025-09-12",
    "LAW": "2025-12-05",
}


class AmbiguousFallbackError(ValueError):
    """Raised when the §10.6 fallback finds 0 or >1 non-token Standard
    matches for a non-Standard root that isn't the known Zam exception --
    per the mapping spec, this must stop ingestion for manual review rather
    than guess."""


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
    for card in cards:
        if card["variant_of_uuid"] is not None or card["variant_type"] == "Standard":
            continue
        if _is_token(card):
            continue
        matches = _fallback_matches(card, cards)
        if len(matches) == 1:
            anchor_uuid[card["uuid"]] = _resolve_root(matches[0], by_uuid)["uuid"]
        elif len(matches) == 0:
            exceptions.append(card)
        else:
            raise AmbiguousFallbackError(
                f"{card['set_code']}_{card['card_number']} ({card['name']!r}) matched "
                f"{len(matches)} non-token Standard roots; expected 0 or 1 -- stop and "
                "decide manually (SWU_Standard_Variant_Mapping_Spec.md §6)"
            )

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
                "name": root["name"],
                "subtitle": root.get("subtitle"),
                "type": root["type"],
                "type2": root.get("type2"),
                "double_sided": bool(root.get("double_sided")),
                "rarity": root["rarity"],
                "cost": root.get("cost"),
                "power": root.get("power"),
                "hp": root.get("hp"),
                "arena": root.get("arena"),
                "is_unique": root.get("unique_flag"),
                "front_text": root.get("front_text"),
                "back_text": root.get("back_text"),
                "epic_action": root.get("epic_action"),
                "artist": root.get("artist"),
                "is_token": _is_token(root),
            }
        )
        aspects[uuid] = list(root.get("aspects") or [])
        keywords[uuid] = list(root.get("keywords") or [])
        traits[uuid] = list(root.get("traits") or [])

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
        release_date = s.get("release_date") or CANONICAL_RELEASE_DATES.get(code)
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
    spec §6; SWU_Backlog.md BL-29). The "Current exceptions" table is fully
    data-driven; the surrounding prose documents the one-time 2026-06-21
    census and fallback decision, so it's kept static here rather than
    re-derived from a single ingestion run."""
    today = datetime.date.today().isoformat()
    lines = [
        "# Standard Variant Mapping — Current Exceptions",
        "",
        f"**Last generated:** {today} (BL-29 ingestion run).",
        "",
        "**Definition (refined 2026-06-21, per BL-27):** a card is a "
        "standard-anchor exception if and only if it is a root "
        "(`variant_of_uuid: null`) whose own `variant_type` is **not** "
        '"Standard" **and** it has **no unique non-token `(name, subtitle)` '
        "match** to a Standard root elsewhere in the corpus (i.e. the "
        "fallback below cannot resolve it). See "
        "[`SWU_Standard_Variant_Mapping_Spec.md`](SWU_Standard_Variant_Mapping_Spec.md) "
        "§6 for the full definition and philosophy.",
        "",
        'The 2026-06-21 census found **15** structural non-`"Standard"` '
        "roots. Per Jeremy's BL-27 decision, **14 are treated as swuapi "
        "data errors** (an unpopulated `variant_of_uuid` link) and "
        "**re-anchored** to their Standard printing via a case-insensitive "
        "`(name, subtitle)` fallback at ingestion — they are *not* "
        "exceptions. One of those 14, `GG_5 Experience`, is a "
        "**duplicate-per-set token** (matched 7 Standards) and stays its "
        "own `base_card` per redesign spec §3.4. Full diagnostic detail for "
        "all 15 is in `swuapi_standard_variant_exceptions_review_2026-06-21.md`.",
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
            "*This file is regenerated by BL-29's ingestion script on each "
            "run. A card lands here only if the §6 fallback finds no unique "
            "non-token Standard match.*",
        ]
    )
    return "\n".join(lines) + "\n"


def regenerate_exceptions_doc(exceptions: list[dict], path: Path) -> None:
    path.write_text(render_exceptions_doc(exceptions), encoding="utf-8")
