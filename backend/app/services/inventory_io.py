"""The `swu-inv/1` canonical inventory format (App Spec §17.1) -- one
internal representation, serialized to/from both JSON (canonical/lossless)
and CSV (derived, spreadsheet-friendly).

Scope: this module owns the wire-format <-> internal-representation
boundary ONLY. It does NOT:
- resolve a row's `swuapi_uuid`/triple against `card_variants`
  (inventory_import.py's resolution engine consumes the ParsedRow objects
  parse_json/parse_csv return).
- apply merge-mode or cap-handling math (also inventory_import.py).

Contract with inventory_import.py and the import router:
- `parse_json`/`parse_csv` return a `ParseResult` (`rows: list[ParsedRow]`,
  `notes: ParseNotes`). `ParsedRow.row_number` is 1-based over the file's
  data rows (meta/header excluded) -- it feeds the import report's
  `row_number` field directly.
- A row with `malformed_quantity=True` has `quantity=None` -- the
  resolution pass treats that as the `malformed_row` reason code before
  attempting identity resolution.
- Duplicate identities are already summed by the time rows come back --
  `notes.duplicate_rows_merged` is the count to surface in the report
  totals. This fold is representation-level (same raw uuid or same raw
  triple); inventory_import._fold_post_resolution_duplicates folds the
  cross-scheme duplicates resolution reveals. See `_merge_duplicates`.
- `notes.unrecognized_columns` is the raw list for the report's
  `totals.unrecognized_columns` -- already deduplicated, insertion order.
- `parse_json`/`parse_csv` raise `UnsupportedFormatVersionError` or
  `UnparseableFileError` (both `ValueError` subclasses, both carry a
  `.reason` class attribute matching the 422 detail strings --
  `"unsupported_format_version"` / `"unparseable_file"`) -- the router
  catches these and maps status_code=422, detail=exc.reason. Upload-size/
  row-count limits (`file_too_large`/`too_many_rows`) are NOT this
  module's concern -- the router checks the upload size before parsing and
  the row count on the returned ParseResult.
- `name`/`subtitle`/`derived` are cosmetic/informational only -- never
  consulted for resolution or merge math. `InventoryRow.derived` is
  export-only (there is deliberately no parse-side equivalent -- `_derived`
  keys arriving on import are accepted as a known JSON key and ignored;
  see _JSON_KNOWN_CARD_KEYS).
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # Type-only -- ParsedRow.preresolved_candidates names VariantMatch's
    # shape so both adapters (swudb_import.py/swunlimiteddb_import.py) can
    # stash the full match tuple rather than a bare uuid string (candidates
    # render as real cards, not UUIDs -- see inventory_import.py's
    # report-building side). `from __future__ import annotations` above
    # makes every annotation in this module a lazy string, so this import
    # never runs at module load time -- this module stays free of DB access
    # at runtime; only static type checkers resolve this name.
    from app.repositories.inventory_import import VariantMatch

FORMAT_VERSION = "swu-inv/1"
META_LINE = "# swu-inv-export v1"

# Fixed export column order; import matches columns by header name, not
# position.
CSV_COLUMNS = [
    "swuapi_uuid",
    "set_code",
    "card_number",
    "variant_type",
    "quantity",
    "name",
    "subtitle",
]

# Meta-line policy (App Spec §17.1): a header row is "recognizable"
# (accepted without a meta line) only if it carries quantity plus at least
# one full identity scheme (uuid, or the whole triple).
_TRIPLE_COLUMNS = {"set_code", "card_number", "variant_type"}

# JSON: keys a `cards[]` entry may carry without being reported as
# unrecognized. `_derived` is a known key -- it's ignored on import, not
# "unknown".
_JSON_KNOWN_CARD_KEYS = {
    "swuapi_uuid",
    "set_code",
    "card_number",
    "variant_type",
    "quantity",
    "name",
    "subtitle",
    "_derived",
}


class UnsupportedFormatVersionError(ValueError):
    """JSON `format_version` present but not FORMAT_VERSION -- refuse
    outright, never best-effort parsed. `.version` carries the offending
    value for the router's error detail/logging."""

    reason = "unsupported_format_version"

    def __init__(self, version: object):
        self.version = version
        super().__init__(f"unsupported format_version: {version!r}")


class UnparseableFileError(ValueError):
    """The file is neither valid `swu-inv/1` JSON nor a CSV with
    a meta line or a recognizable header -- refuse outright."""

    reason = "unparseable_file"


@dataclass(frozen=True)
class DerivedInfo:
    """Export-only informational block -- ignored on import."""

    finish: str | None
    channel: str
    stamped: bool


@dataclass(frozen=True)
class InventoryRow:
    """One card in the internal representation, serialized to JSON and/or
    CSV by serialize_json/serialize_csv. `derived` is export-only (None on
    anything built for import/round-trip comparison)."""

    swuapi_uuid: str | None
    set_code: str | None
    card_number: str | None
    variant_type: str | None
    quantity: int
    name: str | None = None
    subtitle: str | None = None
    derived: DerivedInfo | None = None


@dataclass(frozen=True)
class ParsedRow:
    """One row as read back off a file by parse_json/parse_csv -- NOT yet
    resolved against `card_variants` (inventory_import.py's job).
    `quantity` is None exactly when `malformed_quantity` is True; never
    infer 0."""

    row_number: int
    swuapi_uuid: str | None
    set_code: str | None
    card_number: str | None
    variant_type: str | None
    quantity: int | None
    malformed_quantity: bool
    name: str | None = None
    subtitle: str | None = None
    # The preresolved_* fields are set only by the foreign-format adapters
    # (swudb_import.parse_swudb_csv, swunlimiteddb_import.
    # parse_swunlimiteddb_xlsx; App Spec §17.5) -- None/False on every row
    # parse_json/parse_csv produce (this module's own two parsers never
    # touch card_variants, see the module docstring's scope line). A
    # foreign row's raw identity doesn't fit either the uuid or triple
    # scheme, so the adapter resolves it at parse time and stashes the
    # verdict here; inventory_import.py's _resolve_row trusts a non-None
    # preresolved_reason verbatim instead of re-deriving it. A row an
    # adapter resolved carries swuapi_uuid with preresolved_reason and
    # preresolved_candidates at their defaults (a SWUDB row may also set
    # preresolved_mismatch) and takes _resolve_row's normal uuid path.
    preresolved_reason: str | None = None
    # The full VariantMatch tuple, not a bare swuapi UUID -- both adapters
    # have the whole match in hand at parse time (a bulk-fetched
    # CardVariant + name/subtitle/type), so carrying it through lets the
    # report render "SET number · variant type · name" instead of an opaque
    # UUID. Converted to ImportRowCard only at report-building time
    # (inventory_import.py), same as every other resolved-variant
    # rendering.
    preresolved_candidates: list[VariantMatch] | None = None
    preresolved_mismatch: bool = False


@dataclass
class ParseNotes:
    """Parse-level notes -- format-wide, not per-row."""

    unrecognized_columns: list[str] = field(default_factory=list)
    duplicate_rows_merged: int = 0


@dataclass
class ParseResult:
    rows: list[ParsedRow]
    notes: ParseNotes


def _decode(content: str | bytes) -> str:
    """Accepts either a str or the raw bytes of an uploaded file. Strips a
    leading UTF-8 BOM either way -- common on CSV exports from spreadsheet
    tools, and would otherwise corrupt the first header name (the meta-line/
    header check would see e.g. '\\ufeffswuapi_uuid' where nothing matches).

    Bytes that aren't valid UTF-8 (a binary upload, some other encoding)
    raise UnparseableFileError rather than leaking UnicodeDecodeError --
    parse_json/parse_csv's documented contract is that the two ValueError
    subclasses above are their entire parse-failure surface (the same way
    json.JSONDecodeError is wrapped in parse_json, callers should never
    need to know decoding internals)."""
    if isinstance(content, bytes):
        try:
            return content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise UnparseableFileError(f"not valid UTF-8: {exc}") from exc
    return content.lstrip("﻿")


# ---------------------------------------------------------------------------
# Duplicate-identity summing (App Spec §17.2), shared by every parser.
# ---------------------------------------------------------------------------


def _identity_key(row: ParsedRow) -> tuple | None:
    """The raw (pre-resolution) identity a row is keyed on for duplicate
    detection: its swuapi_uuid if present, else the full triple. None means
    the row has no usable identity at all (the resolution pass flags it
    incomplete_identity on its own -- never merged with anything)."""
    if row.swuapi_uuid:
        return ("uuid", row.swuapi_uuid)
    if row.set_code and row.card_number and row.variant_type:
        return ("triple", row.set_code, row.card_number, row.variant_type)
    return None


def _merge_duplicates(rows: list[ParsedRow], notes: ParseNotes) -> list[ParsedRow]:
    """Rows sharing an identity are summed into one row (quantities added)
    before anything downstream sees them, and the merge count is recorded
    on `notes` -- never treated as an error.

    Deliberately representation-level, not resolved-variant-level: two rows
    are "duplicates" here only if they carry the literal same raw uuid, or
    the literal same raw triple, exactly as written in the file. A uuid-only
    row and a triple-only row that resolve to the same variant are NOT
    caught by this pass -- catching that needs a DB lookup, so
    inventory_import._fold_post_resolution_duplicates folds them after
    resolution.

    A row whose quantity is already malformed is never folded into a group
    -- there's no valid quantity to sum, and it still needs to surface on
    its own as `malformed_row`. Rows with no identity at all are likewise
    never merged with each other: two distinct "garbage" rows collapsing
    into one would misreport the file's row count and hide a row the
    resolution pass flags as `incomplete_identity`.
    """
    groups: dict[tuple, list[ParsedRow]] = {}
    order: list[tuple] = []
    passthrough: list[ParsedRow] = []

    for row in rows:
        if row.malformed_quantity:
            passthrough.append(row)
            continue
        key = _identity_key(row)
        if key is None:
            passthrough.append(row)
            continue
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)

    merged_by_row_number: dict[int, ParsedRow] = {}
    for key in order:
        group = groups[key]
        first = group[0]
        if len(group) == 1:
            merged_by_row_number[first.row_number] = first
            continue
        # quantity is int | None; malformed rows are set aside above, so it is an int here.
        total_quantity = sum(r.quantity for r in group)  # type: ignore[misc]
        notes.duplicate_rows_merged += len(group) - 1
        merged_by_row_number[first.row_number] = ParsedRow(
            row_number=first.row_number,
            swuapi_uuid=first.swuapi_uuid,
            set_code=first.set_code,
            card_number=first.card_number,
            variant_type=first.variant_type,
            quantity=total_quantity,
            malformed_quantity=False,
            name=first.name,
            subtitle=first.subtitle,
            # Carried through so a SWUDB duplicate-uuid merge doesn't
            # silently drop the first row's confirmatory mismatch flag --
            # reason/candidates are always None here regardless (only a
            # resolved row, which never sets them, has a usable uuid
            # identity key to merge on in the first place).
            preresolved_reason=first.preresolved_reason,
            preresolved_candidates=first.preresolved_candidates,
            preresolved_mismatch=first.preresolved_mismatch,
        )

    for row in passthrough:
        merged_by_row_number[row.row_number] = row

    return [merged_by_row_number[rn] for rn in sorted(merged_by_row_number)]


# ---------------------------------------------------------------------------
# Serialization (export).
# ---------------------------------------------------------------------------


def serialize_json(
    rows: list[InventoryRow],
    *,
    source: str = "hyperspacevault",
    exported_at: datetime | None = None,
) -> str:
    """The canonical JSON document. `exported_at` defaults to now (UTC);
    tests that need a fixed timestamp pass one explicitly."""
    ts = exported_at or datetime.now(UTC)
    payload = {
        "format_version": FORMAT_VERSION,
        "exported_at": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "cards": [_card_to_json(row) for row in rows],
    }
    return json.dumps(payload, indent=2)


def _card_to_json(row: InventoryRow) -> dict:
    card: dict = {
        "swuapi_uuid": row.swuapi_uuid,
        "set_code": row.set_code,
        "card_number": row.card_number,
        "variant_type": row.variant_type,
        "quantity": row.quantity,
        "name": row.name,
        "subtitle": row.subtitle,
    }
    if row.derived is not None:
        card["_derived"] = {
            "finish": row.derived.finish,
            "channel": row.derived.channel,
            "stamped": row.derived.stamped,
        }
    return card


# Leading characters spreadsheet apps (Excel/Sheets/LO Calc)
# treat a cell as a formula -- '=', '+', '-', '@' are the classic OWASP CSV-
# injection set; tab/CR are included too since some parsers strip leading
# whitespace before that check, letting "\t=cmd(...)" slip past a naive
# "starts with one of these four chars" guard.
_CSV_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@", "\t", "\r")


def _escape_csv_formula(value: str) -> str:
    """Prefix a single quote when `value` starts with a formula-trigger
    character, forcing spreadsheet apps to treat the reopened cell as text
    instead of evaluating it. Import-safe: name/subtitle are cosmetic-only
    on import (module docstring) -- never consulted for identity
    resolution or merge/cap math -- so a re-imported quoted value changes
    only what's cosmetically displayed, never a quantity or which variant a
    row resolves to."""
    if value and value[0] in _CSV_FORMULA_TRIGGER_CHARS:
        return "'" + value
    return value


def serialize_csv(rows: list[InventoryRow]) -> str:
    """The derived CSV. Always emits the meta line -- app-generated exports
    are the canonical producer of this format; the meta-line-optional
    acceptance rule (parse_csv) exists for hand-authored/reference-derived
    files, not for what this function writes.

    `name`/`subtitle` are neutralized against formula injection -- see
    `_escape_csv_formula`."""
    buffer = io.StringIO()
    buffer.write(META_LINE + "\n")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow(
            [
                row.swuapi_uuid or "",
                row.set_code or "",
                row.card_number or "",
                row.variant_type or "",
                row.quantity,
                _escape_csv_formula(row.name or ""),
                _escape_csv_formula(row.subtitle or ""),
            ]
        )
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Parsing (import) -- consumed by inventory_import.py.
# ---------------------------------------------------------------------------


def _clean_str(value: object) -> str | None:
    """Blank/whitespace-only -> None (absent), never an empty-string
    identity fragment. Non-string JSON values (e.g. a stray number where a
    string was expected) are treated as absent rather than raising --
    malformed input degrades to "no identity here", which the resolution
    pass has a reason code for (incomplete_identity), rather than a 500."""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _parse_quantity_str(raw: str | None) -> tuple[int | None, bool]:
    """Integer >= 0, else malformed (quantity=None, malformed=True).
    CSV values are always strings coming off csv.DictReader."""
    if raw is None:
        return None, True
    raw = raw.strip()
    if raw == "":
        return None, True
    try:
        value = int(raw)
    except ValueError:
        return None, True
    if value < 0:
        return None, True
    return value, False


def _parse_quantity_json(raw: object) -> tuple[int | None, bool]:
    """Same contract as _parse_quantity_str, for JSON's already-typed
    values. Deliberately strict on type: a JSON float (even a whole one
    like 3.0) is non-integer and so malformed, and `bool` is
    excluded despite being an `int` subclass in Python -- `true`/`false`
    are never a valid quantity."""
    if isinstance(raw, bool):
        return None, True
    if isinstance(raw, int) and raw >= 0:
        return raw, False
    return None, True


def parse_csv(content: str | bytes) -> ParseResult:
    """Accepts a CSV if the meta line is present OR the header row contains
    `quantity` plus at least one identity scheme (`swuapi_uuid` or the full
    triple) -- refuses (UnparseableFileError) otherwise, never best-effort
    parsed (App Spec §17.1)."""
    text = _decode(content)
    if not text.strip():
        raise UnparseableFileError("empty file")

    lines = text.splitlines()
    meta_line_present = bool(lines) and lines[0].strip() == META_LINE
    body = "\n".join(lines[1:]) if meta_line_present else text

    reader = csv.DictReader(io.StringIO(body))
    # The stdlib csv module enforces its own field-size
    # limit (128 KB/field by default) independent of the router's whole-
    # file byte cap -- a single pathological field (e.g. a multi-megabyte
    # `name`) trips it as a raw `_csv.Error` from *either* the fieldnames
    # access below or the row-iteration loop, which would otherwise leak
    # past this module's documented parse-failure surface as an unhandled
    # 500 on a user-input path -- same treatment as the UnicodeDecodeError/
    # JSONDecodeError wrapping in _decode/parse_json.
    try:
        fieldnames = reader.fieldnames or []
    except csv.Error as exc:
        raise UnparseableFileError(f"malformed CSV header: {exc}") from exc

    header_recognizable = "quantity" in fieldnames and (
        "swuapi_uuid" in fieldnames or _TRIPLE_COLUMNS.issubset(fieldnames)
    )
    if not meta_line_present and not header_recognizable:
        raise UnparseableFileError(
            "no '# swu-inv-export v1' meta line and no recognizable header "
            "(need quantity + swuapi_uuid or the full set_code/card_number/"
            "variant_type triple)"
        )
    if meta_line_present and not fieldnames:
        raise UnparseableFileError("meta line present but no header row followed it")

    unrecognized: list[str] = [c for c in fieldnames if c not in CSV_COLUMNS]

    raw_rows: list[ParsedRow] = []
    try:
        for row_number, record in enumerate(reader, start=1):
            quantity, malformed = _parse_quantity_str(record.get("quantity"))
            raw_rows.append(
                ParsedRow(
                    row_number=row_number,
                    swuapi_uuid=_clean_str(record.get("swuapi_uuid")),
                    set_code=_clean_str(record.get("set_code")),
                    card_number=_clean_str(record.get("card_number")),
                    variant_type=_clean_str(record.get("variant_type")),
                    quantity=quantity,
                    malformed_quantity=malformed,
                    name=_clean_str(record.get("name")),
                    subtitle=_clean_str(record.get("subtitle")),
                )
            )
    except csv.Error as exc:
        raise UnparseableFileError(f"malformed CSV row: {exc}") from exc

    notes = ParseNotes(unrecognized_columns=unrecognized)
    rows = _merge_duplicates(raw_rows, notes)
    return ParseResult(rows=rows, notes=notes)


def parse_json(content: str | bytes) -> ParseResult:
    """Refuses (never best-effort parses) when the JSON is
    malformed, isn't shaped like a `swu-inv/1` document, or carries an
    unrecognized `format_version`."""
    text = _decode(content)
    if not text.strip():
        raise UnparseableFileError("empty file")

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise UnparseableFileError(f"invalid JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise UnparseableFileError("root JSON value must be an object")

    version = payload.get("format_version")
    if not isinstance(version, str) or not version:
        raise UnparseableFileError("missing 'format_version'")
    if version != FORMAT_VERSION:
        raise UnsupportedFormatVersionError(version)

    cards = payload.get("cards")
    if not isinstance(cards, list):
        raise UnparseableFileError("missing 'cards' array")

    unrecognized: list[str] = []
    raw_rows: list[ParsedRow] = []
    for row_number, card in enumerate(cards, start=1):
        if not isinstance(card, dict):
            raise UnparseableFileError(f"cards[{row_number - 1}] is not an object")
        for key in card:
            if key not in _JSON_KNOWN_CARD_KEYS and key not in unrecognized:
                unrecognized.append(key)
        quantity, malformed = _parse_quantity_json(card.get("quantity"))
        raw_rows.append(
            ParsedRow(
                row_number=row_number,
                swuapi_uuid=_clean_str(card.get("swuapi_uuid")),
                set_code=_clean_str(card.get("set_code")),
                card_number=_clean_str(card.get("card_number")),
                variant_type=_clean_str(card.get("variant_type")),
                quantity=quantity,
                malformed_quantity=malformed,
                name=_clean_str(card.get("name")),
                subtitle=_clean_str(card.get("subtitle")),
            )
        )

    notes = ParseNotes(unrecognized_columns=unrecognized)
    rows = _merge_duplicates(raw_rows, notes)
    return ParseResult(rows=rows, notes=notes)
