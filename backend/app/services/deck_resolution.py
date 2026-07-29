"""BL-137 D1: SET_NUM -> base_card_id resolution, per the load-bearing rule
already specified in SWU_Application_Spec.md §15.3 and independently
re-derived by specification_documents/analysis/Spike_CardNumber_Resolution_
2026-07-16.md §6: parse `SET_CODE` + integer (accept unpadded/zero-padded)
-> match a non-token base card by (set_code, base_card_number) -> no match
-> unresolved, never guessed.

The spike's "exceptions list" step (§6 step 3) is folded into step 1 here
rather than re-implemented as a separate lookup: every current exception
(including the one true orphan, Zam Wesell/C26_3) is already re-anchored
into its own correct `base_cards` row at ingestion time (BL-27), so a plain
(set_code, base_card_number, is_token=false) query against `base_cards`
already resolves it -- there is no case today where a real deck-citable id
needs a second, separate lookup. If a future ingestion run ever introduces
a genuine two-step exception, app.repositories.deck_check.resolve_base_cards
is the single place that would grow a fallback query.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.repositories import deck_check as deck_check_repo
from app.services.deck_parse import DeckCardRef, ParsedDeck

SLOT_LEADER = "leader"
SLOT_SECOND_LEADER = "second_leader"
SLOT_BASE = "base"
SLOT_MAIN = "main"
SLOT_SIDEBOARD = "sideboard"


@dataclass(frozen=True)
class SlottedRef:
    slot: str
    ref: DeckCardRef


@dataclass(frozen=True)
class ResolvedCardRef:
    slot: str
    raw_id: str
    count: int
    base_card_id: int


@dataclass(frozen=True)
class UnrecognizedRef:
    id: str
    count: int


def parse_set_num(
    raw_id: str, known_set_codes: frozenset[str]
) -> tuple[str, int] | None:
    """Accepts "SOR_162", "SOR162", "SOR_0162" -- matched against known
    catalog set codes (longest first) rather than a fixed regex boundary,
    because several real set codes contain digits themselves (TS26, C26,
    GG) which would make a generic alpha/digit split ambiguous. A token id
    ("ASH_T001") never parses here: the remainder after stripping the set
    code and an optional underscore must be pure digits, and "T001" isn't
    -- it correctly falls through to unrecognized rather than needing a
    separate token filter (belt-and-suspenders is_token=false still applies
    at the DB layer too)."""
    candidate = raw_id.strip()
    if not candidate:
        return None
    upper = candidate.upper()
    for code in sorted(known_set_codes, key=len, reverse=True):
        if code and upper.startswith(code):
            rest = candidate[len(code) :].lstrip("_")
            if rest and rest.isdigit():
                return code, int(rest)
    return None


def build_slotted_refs(deck: ParsedDeck) -> list[SlottedRef]:
    """Flattens a parsed deck into every card reference that needs
    resolving, tagged with which scope pool it belongs to (Definition_
    DeckCheck §4: main scope = leader + base + second_leader + main deck;
    side scope = sideboard only)."""
    refs = [SlottedRef(SLOT_LEADER, deck.leader), SlottedRef(SLOT_BASE, deck.base)]
    if deck.second_leader is not None:
        refs.append(SlottedRef(SLOT_SECOND_LEADER, deck.second_leader))
    refs.extend(SlottedRef(SLOT_MAIN, r) for r in deck.main)
    refs.extend(SlottedRef(SLOT_SIDEBOARD, r) for r in deck.sideboard)
    return refs


def resolve_slotted_refs(
    db: Session, slotted: list[SlottedRef]
) -> tuple[list[ResolvedCardRef], list[UnrecognizedRef]]:
    """One batched DB round-trip for every id in the deck. A ref whose
    SET_NUM can't even be parsed against a known set code, and a ref that
    parses but matches no non-token base card, both land in `unrecognized`
    -- indistinguishable to the caller, both are "never guessed"."""
    known_set_codes = deck_check_repo.get_known_set_codes(db)
    parsed_by_index: list[tuple[str, int] | None] = [
        parse_set_num(sref.ref.id, known_set_codes) for sref in slotted
    ]
    pairs_to_resolve = [p for p in parsed_by_index if p is not None]
    lookup = deck_check_repo.resolve_base_cards(db, pairs_to_resolve)

    resolved: list[ResolvedCardRef] = []
    unrecognized: list[UnrecognizedRef] = []
    for sref, parsed in zip(slotted, parsed_by_index):
        base_card_id = lookup.get(parsed) if parsed is not None else None
        if base_card_id is None:
            unrecognized.append(UnrecognizedRef(id=sref.ref.id, count=sref.ref.count))
        else:
            resolved.append(
                ResolvedCardRef(
                    slot=sref.slot,
                    raw_id=sref.ref.id,
                    count=sref.ref.count,
                    base_card_id=base_card_id,
                )
            )
    return resolved, unrecognized
