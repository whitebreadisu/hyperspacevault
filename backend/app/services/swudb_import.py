"""SWUDB.com collection-export import adapter (App Spec §17.5).

SWUDB's own export/import CSV (`Set,CardNumber,Count,IsFoil,Stamp` -- Stamp
optional, SWUDB's own *import* format is the 4-column subset) carries none
of the identity swu-inv/1 relies on (no uuid, no variant_type) -- its raw
identity is entirely `(Set, CardNumber, IsFoil, Stamp)`. Resolving that
against `card_variants` requires the DB, so unlike parse_json/parse_csv
(inventory_io.py, pure text -> ParsedRow, no DB access at all -- see that
module's own docstring scope line), this parser takes `db` and does its
own resolution inline at parse time -- there's no canonical (set_code,
card_number, variant_type) triple to hand off to inventory_import.py's own
resolution engine, because SWUDB never carries a variant_type.

A row this module resolves carries `swuapi_uuid` on its returned
ParsedRow (set_code/card_number/variant_type stay None, plus
preresolved_mismatch when IsFoil/Stamp disagree with the match) and flows
through `app.services.inventory_import.compute_import` UNCHANGED, via that
module's "uuid known -> resolved" step. An unresolved/ambiguous row
carries its verdict on ParsedRow.preresolved_reason/preresolved_candidates
instead -- inventory_import.py's `_resolve_row` trusts those fields
verbatim rather than re-deriving them. Both fields are None on every row
parse_json/parse_csv produce, so canonical-format resolution is untouched
by this module.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.ingestion.swuapi_classify import PRESTIGE_FOIL_FAMILY
from app.repositories import inventory_import as inventory_import_repo
from app.repositories.inventory_import import VariantMatch
from app.services.inventory_io import (
    ParsedRow,
    ParseNotes,
    ParseResult,
    UnparseableFileError,
    _decode,
    _merge_duplicates,
    _parse_quantity_str,
)

# The 5-column export header; Stamp is optional -- SWUDB's own
# *import* format (as opposed to its export) is the 4-column subset. Used
# both by parse_swudb_csv's own header check and by the router's format-
# detection seam (app/routers/inventory.py imports REQUIRED_COLUMNS to
# sniff a file's header before it's known whether it's canonical or
# SWUDB).
KNOWN_COLUMNS = {"Set", "CardNumber", "Count", "IsFoil", "Stamp"}
REQUIRED_COLUMNS = {"Set", "CardNumber", "Count", "IsFoil"}

# Deliberately incomplete set-code translation table -- an unmapped code is
# refused (reason "unmapped_set", shared with swunlimiteddb_import), NEVER
# guessed (App Spec §17.5).
# Extension policy (ADR-0028): a new set's PRINTED codes -- the base code
# and its Weekly Play <CODE>P -- are added at onboarding behind a 2-3 card
# (code, number) spot-check against the catalog (App Spec §17.5). Every
# other code (SWUDB's synthetic/renamed containers,
# convention/judge/gift-box series) is added only once a real SWUDB-format
# export has shown it -- never extrapolated.
SET_CODE_MAP: dict[str, str] = {
    # Direct (SWUDB's code already matches our set_code) -- confirmed
    # against the live catalog.
    "ASH": "ASH",
    "C26": "C26",
    "IBH": "IBH",
    # IC27 (2026-11-08): spot-checked before street date -- all 57
    # numbered rows SWUDB lists (api.swu-db.com/cards/ic27) match the
    # catalog's (number, name), e.g. #10 Echo Base, #57 Director Krennic,
    # #150 Frozen in Carbonite. No Weekly Play program, so no IC27P.
    "IC27": "IC27",
    "J25": "J25",
    "JTL": "JTL",
    "JTLP": "JTLP",
    "LAW": "LAW",
    "P25": "P25",
    "SEC": "SEC",
    "SHD": "SHD",
    "SOR": "SOR",
    "TS26": "TS26",
    # Base sets not confirmed by a real export but direct by the pattern
    # every confirmed base set follows -- flagged here rather than silently
    # assumed.
    "TWI": "TWI",
    "LOF": "LOF",
    # Renames -- SWUDB uses a code different from our set_code.
    "CE25": "C25",
    "GGTS": "GG",
    # Confirmed by a real HoloScan export (HoloScan writes SWUDB-format
    # CSV): every code below appears verbatim as the printed set code, and
    # their rows resolve 1:1 through _resolve_candidates (no ambiguous
    # rows, no foil mismatches). Together with JTLP above, the Weekly Play
    # codes confirm the printed-code pattern across two tools.
    "HMW": "HMW",
    "ASHP": "ASHP",
    "LAWP": "LAWP",
    "LOFP": "LOFP",
    "SECP": "SECP",
    "CST": "CST",
    "G25": "G25",
    # HMWP: a printed Weekly Play code, mapped under ADR-0028's
    # printed-code rule (HoloScan's swudb CSV export includes Homeworlds Weekly
    # Play, and every Weekly Play set exports its printed code unchanged).
    # SORP/SHDP/TWIP (the Hyperspace-only promo sets of the first three
    # base sets) stay OUT: never observed in any export from either tool.
    "HMWP": "HMWP",
    # Synthetic container code: no real SORPR set exists in our model --
    # SOR_1's Prerelease Promo/Prerelease Judge rows live directly inside
    # the base SOR set. Mapping SORPR -> SOR is what makes both
    # rows reach the (set, number) candidate lookup at all; Stamp is what
    # then tells them apart (see _stamp_matches).
    "SORPR": "SOR",
}


def _parse_is_foil(raw: str | None) -> bool:
    """SWUDB's Python-style `True`/`False` string. Case-normalized for
    robustness; anything else (missing/garbled) degrades to False rather
    than failing the row -- IsFoil is a disambiguation SIGNAL, never
    part of a row's core identity the way Count is."""
    return (raw or "").strip().lower() == "true"


def _normalize_number(raw: str) -> str:
    """SWUDB zero-pads CardNumber (2 or 3 digits depending on set);
    our own card_number column never does. Int-cast/re-stringify strips
    the padding. Falls back to the raw (stripped) string when it isn't
    purely numeric -- never raises; an unparseable number just fails to
    find any candidate downstream (unknown_set_and_number), the same
    refuse-don't-guess posture as the rest of this module."""
    stripped = raw.strip()
    try:
        return str(int(stripped))
    except ValueError:
        return stripped


def _is_foilish(variant_type: str) -> bool:
    """Whether a candidate LOOKS foil,
    for matching SWUDB's IsFoil flag. Showcase is always foil as a domain
    fact (no non-foil Showcase printing exists) even though the string
    "Showcase" doesn't itself contain "Foil" -- treating it as non-foil
    here would make a genuine Showcase match register as a mismatch.
    Serialized Prestige is the same trap: it's in PRESTIGE_FOIL_FAMILY
    (app/ingestion/swuapi_classify.py) alongside Foil Prestige, but its
    name doesn't contain "Foil" either -- reusing that curated table
    instead of a bare substring check avoids re-deriving (and getting
    wrong) domain knowledge that already lives there."""
    return (
        "Foil" in variant_type
        or "Showcase" in variant_type
        or variant_type in PRESTIGE_FOIL_FAMILY
    )


# The tournament-ladder stamp vocabulary observed in real SWUDB exports,
# keyed by SWUDB's Stamp value -> the substring expected in a
# candidate's variant_type. Deliberately small and only meaningful once
# the foil split AND the (set, number) family have already narrowed the
# field -- SS/GC/RQ/SQ/PQ tiers all reuse this same tier vocabulary
# (Top 8/Champion/Judge/...), so this table is NOT a general variant_type
# classifier on its own.
_STAMP_KEYWORDS: dict[str, str] = {
    "Judge": "Judge",
    "Champion": "Champion",
    "Top8": "Top 8",
    "Serialized": "Serialized",
}


# The main-set printing vocabulary -- the variant_types a SWUDB row's plain
# (Set, CardNumber) identity actually means when promo-run printings
# (Prerelease/Judge/SS/Weekly Play, numbered run-locally under the base
# set) share its number. Same vocabulary as the XLSX adapter's clean-column
# targets (swunlimiteddb_import._CLEAN_COLUMN_TO_TYPE values): SWUDB gives
# promo-tier printings their own Set codes (SORPR) and Stamp values, so a
# row that says neither means the main-set card.
_MAIN_SET_TYPES = frozenset(
    {
        "Standard",
        "Standard Foil",
        "Hyperspace",
        "Hyperspace Foil",
        "Showcase",
        "Standard Prestige",
        "Foil Prestige",
        "Serialized Prestige",
    }
)


def _stamp_matches(stamp: str | None, variant_type: str) -> bool:
    """Stamp matching (App Spec §17.5): a BLANK Stamp is itself
    informative, not merely "no signal"
    -- it means "the plain (non-tournament-tiered) printing", so it
    matches any candidate whose variant_type carries none of the known
    stamp keywords (this is what separates SOR_1's "Prerelease Promo" from
    "Prerelease Judge" -- blank vs "Judge" is the ONLY thing that tells
    them apart). A known Stamp value matches candidates carrying its
    keyword; an unrecognized Stamp value (future SWUDB vocabulary this
    table hasn't caught up to yet) falls back to a direct substring check
    rather than refusing outright."""
    if stamp is None:
        return not any(kw in variant_type for kw in _STAMP_KEYWORDS.values())
    keyword = _STAMP_KEYWORDS.get(stamp, stamp)
    return keyword in variant_type


@dataclass(frozen=True)
class _Outcome:
    swuapi_uuid: str | None
    mismatch: bool
    reason: str | None
    # Full VariantMatch tuples, not bare swuapi_id strings -- see
    # inventory_io.ParsedRow.preresolved_candidates' own doc comment.
    candidates: list[VariantMatch]


def _resolve_candidates(
    candidates: list[VariantMatch], *, is_foil: bool, stamp: str | None
) -> _Outcome:
    """Steps (a)-(d) below, applied to every candidate sharing one
    (mapped_set, normalized_number) family."""
    if not candidates:
        return _Outcome(None, False, "unknown_set_and_number", [])

    if len(candidates) == 1:
        variant = candidates[0][0]
        mismatch = _is_foilish(variant.variant_type) != is_foil or (
            stamp is not None and not _stamp_matches(stamp, variant.variant_type)
        )
        return _Outcome(variant.swuapi_id, mismatch, None, [])

    # Step (a): split by foilishness against the file's IsFoil.
    foil_matches = [c for c in candidates if _is_foilish(c[0].variant_type) == is_foil]
    if len(foil_matches) == 1:
        return _Outcome(foil_matches[0][0].swuapi_id, False, None, [])

    # Step (b): stamp keyword match. Narrows WITHIN the foil split when it
    # actually narrowed anything (>=2 left); falls back to the FULL
    # candidate set when the foil split left nothing at all -- the SORPR
    # case, where IsFoil=True on both rows but neither "Prerelease Promo"
    # nor "Prerelease Judge" reads as foilish, so foil_matches is empty and
    # would otherwise strand a resolvable row.
    base = foil_matches if foil_matches else candidates
    stamp_matches = [c for c in base if _stamp_matches(stamp, c[0].variant_type)]
    if len(stamp_matches) == 1:
        return _Outcome(stamp_matches[0][0].swuapi_id, False, None, [])

    # Step (c): before falling into the ambiguous bucket, prefer the sole
    # MAIN-SET printing over run-locally-numbered promo-tier printings (see
    # _MAIN_SET_TYPES). The SOR 1 shape: after the blank-stamp filter,
    # Krennic (Standard) still shares the family with Vader's Prerelease
    # Promo, Takedown's SS Participation and Battlefield Marine's Weekly
    # Play -- all run-local number-1s the file's plain "SOR,1" never means.
    # Fires only when exactly ONE main-set candidate remains, so a genuine
    # main-set collision (the SEC Serialized Prestige trio) still lands in
    # ambiguous_triple below. Mismatch semantics mirror the
    # single-candidate step: resolve, flag any foil/stamp disagreement.
    pool = stamp_matches if stamp_matches else base
    main_set = [c for c in pool if c[0].variant_type in _MAIN_SET_TYPES]
    if len(main_set) == 1:
        variant = main_set[0][0]
        mismatch = _is_foilish(variant.variant_type) != is_foil or (
            stamp is not None and not _stamp_matches(stamp, variant.variant_type)
        )
        return _Outcome(variant.swuapi_id, mismatch, None, [])

    # Step (d): still ambiguous -- the same ambiguous bucket and reason code
    # inventory_import.py's own triple collisions use (no new UX).
    sorted_candidates = sorted(candidates, key=lambda c: c[0].swuapi_id)
    return _Outcome(None, False, "ambiguous_triple", sorted_candidates)


@dataclass(frozen=True)
class _RawRow:
    row_number: int
    raw_set: str | None
    raw_number: str | None
    quantity: int | None
    malformed_quantity: bool
    is_foil: bool
    stamp: str | None


def parse_swudb_csv(content: str | bytes, db: Session) -> ParseResult:
    """Refuses outright (never best-effort parsed) when the content
    isn't readable CSV at all, or its header is missing a required column
    -- same posture as parse_csv/parse_json. Row-level resolution failures
    (unmapped set, unknown number, ambiguous candidates) are NOT refused --
    they surface as unresolved/ambiguous report rows exactly like any
    other import problem row, never a 422."""
    text = _decode(content)
    if not text.strip():
        raise UnparseableFileError("empty file")

    reader = csv.DictReader(io.StringIO(text))
    try:
        fieldnames = reader.fieldnames or []
    except csv.Error as exc:
        raise UnparseableFileError(f"malformed CSV header: {exc}") from exc

    if not REQUIRED_COLUMNS.issubset(fieldnames):
        raise UnparseableFileError(
            "not a recognizable SWUDB export (need Set, CardNumber, Count, IsFoil)"
        )

    unrecognized = [c for c in fieldnames if c not in KNOWN_COLUMNS]

    raw_rows: list[_RawRow] = []
    try:
        for row_number, record in enumerate(reader, start=1):
            quantity, malformed = _parse_quantity_str(record.get("Count"))
            raw_rows.append(
                _RawRow(
                    row_number=row_number,
                    raw_set=(record.get("Set") or "").strip() or None,
                    raw_number=(record.get("CardNumber") or "").strip() or None,
                    quantity=quantity,
                    malformed_quantity=malformed,
                    is_foil=_parse_is_foil(record.get("IsFoil")),
                    stamp=(record.get("Stamp") or "").strip() or None,
                )
            )
    except csv.Error as exc:
        raise UnparseableFileError(f"malformed CSV row: {exc}") from exc

    # Map every row's raw (Set, CardNumber) to (our set_code,
    # normalized number) up front, so every distinct pair can be looked up
    # in ONE bulk query below (mirrors compute_import's own bulk-lookup-
    # then-per-row-resolve shape). Rows with a malformed Count or an
    # unmapped set never reach the DB at all.
    pairs: set[tuple[str, str]] = set()
    mapped: dict[int, tuple[str, str] | None] = {}
    # A row with a valid Count but a BLANK Set or
    # CardNumber carries no usable identity at all -- that's not "we don't
    # recognize this set" (unmapped_set), it's "this row doesn't say enough
    # about which card it is", the same incomplete_identity bucket the
    # canonical/triple resolver already uses for its own partial-identity
    # rows. Tracked separately from a genuinely-unmapped-but-PRESENT set
    # code below so the two get honest, distinct reason codes instead of
    # both falling into unmapped_set's "a set we don't have" copy.
    blank_identity_rows: set[int] = set()
    for raw in raw_rows:
        if raw.malformed_quantity:
            mapped[raw.row_number] = None
            continue
        if raw.raw_set is None or raw.raw_number is None:
            mapped[raw.row_number] = None
            blank_identity_rows.add(raw.row_number)
            continue
        set_code = SET_CODE_MAP.get(raw.raw_set)
        if set_code is None:
            mapped[raw.row_number] = None
            continue
        number = _normalize_number(raw.raw_number)
        mapped[raw.row_number] = (set_code, number)
        pairs.add((set_code, number))

    candidate_map = inventory_import_repo.get_variants_by_set_and_number(
        db, list(pairs)
    )

    parsed_rows: list[ParsedRow] = []
    for raw in raw_rows:
        if raw.malformed_quantity:
            parsed_rows.append(
                ParsedRow(
                    row_number=raw.row_number,
                    swuapi_uuid=None,
                    set_code=None,
                    card_number=None,
                    variant_type=None,
                    quantity=None,
                    malformed_quantity=True,
                )
            )
            continue

        pair = mapped[raw.row_number]
        if pair is None:
            if raw.row_number in blank_identity_rows:
                # Blank Set or CardNumber -- no identity to resolve at all,
                # distinct from an unmapped-but-present set code below.
                parsed_rows.append(
                    ParsedRow(
                        row_number=raw.row_number,
                        swuapi_uuid=None,
                        set_code=raw.raw_set,
                        card_number=raw.raw_number,
                        variant_type=None,
                        quantity=raw.quantity,
                        malformed_quantity=False,
                        preresolved_reason="incomplete_identity",
                    )
                )
                continue
            # Unmapped SWUDB set code -- never guessed. The raw SWUDB set
            # is carried verbatim (there's no "our" set_code to show --
            # ImportRowCard's contract is "only whatever raw identity
            # fragments the file actually carried"). The reason code
            # "unmapped_set" is format-agnostic, shared with
            # app/services/swunlimiteddb_import.py's identical failure mode.
            parsed_rows.append(
                ParsedRow(
                    row_number=raw.row_number,
                    swuapi_uuid=None,
                    set_code=raw.raw_set,
                    card_number=raw.raw_number,
                    variant_type=None,
                    quantity=raw.quantity,
                    malformed_quantity=False,
                    preresolved_reason="unmapped_set",
                )
            )
            continue

        set_code, number = pair
        outcome = _resolve_candidates(
            candidate_map.get(pair, []), is_foil=raw.is_foil, stamp=raw.stamp
        )
        parsed_rows.append(
            ParsedRow(
                row_number=raw.row_number,
                swuapi_uuid=outcome.swuapi_uuid,
                set_code=None if outcome.swuapi_uuid else set_code,
                card_number=None if outcome.swuapi_uuid else number,
                variant_type=None,
                quantity=raw.quantity,
                malformed_quantity=False,
                preresolved_reason=outcome.reason,
                preresolved_candidates=outcome.candidates or None,
                preresolved_mismatch=outcome.mismatch,
            )
        )

    notes = ParseNotes(unrecognized_columns=unrecognized)
    # Reuses inventory_io's own duplicate-identity fold rather than
    # reimplementing it -- a resolved SWUDB row already carries a
    # swuapi_uuid by this point, so two file rows resolving to the same
    # variant get summed exactly like two canonical rows sharing a raw
    # uuid would (inventory_io._merge_duplicates). Unresolved/ambiguous
    # rows carry no uuid and no full triple (variant_type is always None
    # here), so _merge_duplicates' own "no usable identity -> never merged"
    # rule keeps distinct problem rows from silently collapsing.
    rows = _merge_duplicates(parsed_rows, notes)
    return ParseResult(rows=rows, notes=notes)
