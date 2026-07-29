"""BL-158 (Definition_ImportExport_2026-07-22.md §3/§7.2; audit A4-03/A4-04):
the import surface's abuse-case test suite. Two families:

- Parse-layer abuse (pure unit tests, no DB needed) -- inventory_io.parse_
  csv/parse_json fed binary garbage, truncated JSON, wrong format_version,
  empty/BOM-only files, and a pathologically huge single field. These run
  everywhere (local, CI), same as test_inventory_io.py.
- Upload-boundary abuse (needs DATABASE_URL/APP_DATABASE_URL, same skip
  gate as test_inventory_import_api.py) -- the exact-cap / cap+1 edges of
  the router's 10 MB / 20,000-row gate (IMPORT_MAX_UPLOAD_BYTES/
  IMPORT_MAX_ROWS, owned by app/routers/inventory.py -- imported read-only
  here, never modified). "cap+1 rejects" is already covered by
  test_inventory_import_api.py::TestUploadLimits; this file's addition is
  the other half of the boundary, "exactly at the cap succeeds", which
  wasn't previously exercised.

Also covers BL-158's CSV formula-escape (serialize_csv neutralizing a
leading =/+/-/@ on name/subtitle, A4-04) with a round-trip test proving the
escape can't corrupt a re-import's quantities -- name/subtitle are cosmetic-
only on import (inventory_io's module docstring, P4/§3.1), never consulted
for identity resolution or merge/cap math.

Run:
    docker compose exec backend pytest app/tests/test_inventory_import_abuse.py -v
"""

from __future__ import annotations

import csv
import json
import os
import uuid
from io import StringIO

import pytest
from sqlalchemy import text

from app.services import inventory_io as io

# ---------------------------------------------------------------------------
# Part 1: parse-layer abuse -- pure unit tests, no DB required.
# ---------------------------------------------------------------------------


class TestBinaryGarbage:
    """Random non-UTF-8 bytes at the parse layer -- broader/noisier than
    test_inventory_io.py::TestInvalidUtf8Bytes' minimal fixture, standing in
    for a genuinely garbled/binary upload (e.g. a stray image or archive
    dropped on the import picker)."""

    GARBAGE = bytes([0xDE, 0xAD, 0xBE, 0xEF, 0xFF, 0xFE, 0x00, 0x01, 0x80, 0x81]) * 200

    def test_parse_csv_refuses(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(self.GARBAGE)

    def test_parse_json_refuses(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(self.GARBAGE)


class TestTruncatedJson:
    """A JSON upload cut off mid-stream (e.g. a client-side abort or a
    proxy truncating the body) must refuse cleanly, not raise a raw
    json.JSONDecodeError past the module's documented failure surface."""

    def test_truncated_mid_object_refused(self):
        content = (
            '{"format_version": "swu-inv/1", "exported_at": '
            '"2026-07-22T00:00:00Z", "source": "hyperspacevault", "cards": '
            '[{"swuapi_uuid": "u1", "quant'
        )
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(content)

    def test_truncated_mid_array_refused(self):
        content = (
            '{"format_version": "swu-inv/1", "cards": '
            '[{"swuapi_uuid": "u1", "quantity": 1}, {"swuapi_uuid": "u2"'
        )
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(content)

    def test_truncated_before_any_closing_brace_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json('{"format_version": "swu-inv/1"')


class TestWrongVersion:
    def test_bytes_input_wrong_version_refused(self):
        content = b'{"format_version": "swu-inv/2", "cards": []}'
        with pytest.raises(io.UnsupportedFormatVersionError) as exc_info:
            io.parse_json(content)
        assert exc_info.value.reason == "unsupported_format_version"
        assert exc_info.value.version == "swu-inv/2"

    def test_garbage_version_string_carried_in_error(self):
        content = '{"format_version": "not-even-close", "cards": []}'
        with pytest.raises(io.UnsupportedFormatVersionError) as exc_info:
            io.parse_json(content)
        assert exc_info.value.version == "not-even-close"

    def test_non_string_version_is_unparseable_not_unsupported(self):
        """A non-string format_version (e.g. a stray number) fails the
        `isinstance(version, str)` guard before the equality check ever
        runs -- UnparseableFileError, not UnsupportedFormatVersionError."""
        content = '{"format_version": 1, "cards": []}'
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(content)


class TestEmptyFile:
    def test_parse_csv_empty_string_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv("")

    def test_parse_csv_empty_bytes_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(b"")

    def test_parse_json_empty_string_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json("")

    def test_parse_json_empty_bytes_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(b"")

    def test_parse_csv_whitespace_only_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv("   \n\n  \n")

    def test_parse_json_whitespace_only_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json("   \n\n  \n")


class TestBomOnlyFile:
    """A file that's nothing but a UTF-8 BOM (three bytes, no content at
    all) -- an edge a spreadsheet app or a broken export pipeline could
    plausibly produce. _decode strips the BOM either way, so this must
    collapse to the same "empty file" refusal as a genuinely empty upload,
    not a different/confusing error."""

    BOM_BYTES = b"\xef\xbb\xbf"

    def test_parse_csv_bom_only_bytes_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(self.BOM_BYTES)

    def test_parse_json_bom_only_bytes_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(self.BOM_BYTES)

    def test_parse_csv_bom_only_str_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv("﻿")

    def test_parse_json_bom_only_str_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json("﻿")


class TestHugeSingleField:
    """A pathologically huge single field (e.g. a hostile/broken client
    stuffing megabytes into `name`) shouldn't crash or hang the parser.

    JSON has no such limit (json.loads handles a multi-megabyte string
    field fine, bounded only by memory) -- documents that as intentional,
    not a gap.

    CSV is different: this abuse case exposed a real gap (BL-158 fix, same
    commit) -- the stdlib `csv` module enforces its own 128 KB/field limit
    independent of the router's 10 MB whole-file cap, and a field past that
    used to raise a raw `_csv.Error` straight through parse_csv as an
    unhandled 500 on a user-input path. parse_csv now catches `csv.Error`
    and refuses with the module's normal UnparseableFileError, same
    treatment as the existing UnicodeDecodeError/JSONDecodeError wrapping."""

    HUGE = "x" * (5 * 1024 * 1024)  # 5 MB single field, well under the
    # router's 10 MB whole-file cap -- exercises the module in isolation.

    def test_parse_json_huge_name_field_parses(self):
        content = json.dumps(
            {
                "format_version": "swu-inv/1",
                "cards": [{"swuapi_uuid": "u1", "quantity": 1, "name": self.HUGE}],
            }
        )
        result = io.parse_json(content)
        assert len(result.rows) == 1
        assert result.rows[0].name == self.HUGE
        assert result.rows[0].quantity == 1

    def test_parse_csv_field_over_csv_module_limit_is_refused_not_500(self):
        content = f"# swu-inv-export v1\nswuapi_uuid,quantity,name\nu1,1,{self.HUGE}\n"
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(content)

    def test_parse_csv_field_just_under_csv_module_limit_still_parses(self):
        """Bounds the fix precisely -- a large-but-reasonable field (well
        under the stdlib csv module's 128 KB/field default) must keep
        working exactly as before; this isn't a general field-length cap,
        only a graceful-refusal fix for the one pathological edge."""
        comfortably_under_limit = "x" * 100_000
        content = (
            "# swu-inv-export v1\n"
            "swuapi_uuid,quantity,name\n"
            f"u1,1,{comfortably_under_limit}\n"
        )
        result = io.parse_csv(content)
        assert len(result.rows) == 1
        assert result.rows[0].name == comfortably_under_limit
        assert result.rows[0].quantity == 1


# ---------------------------------------------------------------------------
# Part 2: CSV formula-escape (export) + round-trip safety.
# ---------------------------------------------------------------------------


def _row(**overrides) -> io.InventoryRow:
    defaults = dict(
        swuapi_uuid="uuid-1",
        set_code="SOR",
        card_number="237",
        variant_type="Standard",
        quantity=3,
        name="Alliance X-Wing",
        subtitle=None,
    )
    defaults.update(overrides)
    return io.InventoryRow(**defaults)


def _parsed_data_rows(content: str) -> list[list[str]]:
    """Reads exported CSV content back with csv.reader (skipping the meta
    line), returning each data row's already-unquoted/unescaped column
    values. Deliberately not naive string.splitlines()/split(",") -- a
    quoted field can legitimately contain a raw "\\r" or "," of its own
    (e.g. the tab/CR-prefixed formula-escape cases below), which a manual
    split would misparse as an extra row/column boundary. csv.reader is a
    real CSV parser and handles that correctly; serialize_csv's own choice
    of lineterminator="\\n" means "\\n" is never ambiguous as a row
    separator here."""
    header_and_body = content.split("\n", 1)[1]
    rows = list(csv.reader(StringIO(header_and_body)))
    return rows[1:]  # drop the header row


class TestCsvFormulaEscape:
    @pytest.mark.parametrize(
        "hostile",
        [
            "=1+1",
            "=cmd|'/c calc'!A1",
            "+1+1",
            "-1+1",
            "@SUM(A1:A9)",
            "\t=evil()",
            "\r=evil()",
        ],
    )
    def test_leading_trigger_char_is_quote_prefixed(self, hostile):
        content = io.serialize_csv([_row(name=hostile)])
        data_rows = _parsed_data_rows(content)
        assert len(data_rows) == 1
        name_cell = data_rows[0][5]  # name is CSV_COLUMNS[5]
        assert name_cell.startswith("'"), name_cell
        assert name_cell == "'" + hostile

    def test_subtitle_also_escaped(self):
        content = io.serialize_csv([_row(subtitle='=HYPERLINK("http://evil")')])
        data_rows = _parsed_data_rows(content)
        assert data_rows[0][6] == '\'=HYPERLINK("http://evil")'

    def test_benign_name_untouched(self):
        content = io.serialize_csv([_row(name="Alliance X-Wing")])
        data_rows = _parsed_data_rows(content)
        assert data_rows[0][5] == "Alliance X-Wing"

    def test_empty_name_untouched(self):
        content = io.serialize_csv([_row(name=None)])
        data_rows = _parsed_data_rows(content)
        assert data_rows[0][5] == ""

    @pytest.mark.parametrize(
        "benign_leading", ["*starred", "#tagged", " leading space"]
    )
    def test_non_trigger_leading_chars_untouched(self, benign_leading):
        content = io.serialize_csv([_row(name=benign_leading)])
        data_rows = _parsed_data_rows(content)
        assert data_rows[0][5] == benign_leading

    def test_round_trip_preserves_quantity_and_identity_not_name(self):
        """The whole point of the escape: it must not corrupt a re-import.
        inventory_io's module docstring is explicit that name/subtitle are
        cosmetic-only on import -- never consulted for resolution or merge
        math -- so quantity/identity survive the export->reimport loop
        unchanged even though the escaped name/subtitle text itself
        (deliberately) no longer matches byte-for-byte."""
        hostile_row = _row(
            swuapi_uuid="uuid-hostile",
            quantity=7,
            name="=cmd|'/c calc'!A1",
            subtitle="@SUM(A1:A9)",
        )
        benign_row = _row(
            swuapi_uuid="uuid-benign",
            set_code="SEC",
            card_number="1127",
            variant_type="Serialized Prestige",
            quantity=2,
            name="Queen Amidala",
            subtitle="Championing Her People",
        )
        exported = io.serialize_csv([hostile_row, benign_row])
        parsed = io.parse_csv(exported)

        assert len(parsed.rows) == 2
        by_uuid = {r.swuapi_uuid: r for r in parsed.rows}

        # Identity and quantity: unaffected by the escape.
        assert by_uuid["uuid-hostile"].quantity == 7
        assert by_uuid["uuid-hostile"].set_code == "SOR"
        assert by_uuid["uuid-hostile"].card_number == "237"
        assert by_uuid["uuid-hostile"].variant_type == "Standard"
        assert by_uuid["uuid-hostile"].malformed_quantity is False

        assert by_uuid["uuid-benign"].quantity == 2
        assert by_uuid["uuid-benign"].name == "Queen Amidala"
        assert by_uuid["uuid-benign"].subtitle == "Championing Her People"

        # The hostile name/subtitle come back quote-prefixed (never
        # evaluated as a formula on reopen) rather than the original raw
        # string -- expected, since name/subtitle are cosmetic-only.
        assert by_uuid["uuid-hostile"].name == "'=cmd|'/c calc'!A1"
        assert by_uuid["uuid-hostile"].subtitle == "'@SUM(A1:A9)"

    def test_round_trip_via_json_does_not_escape(self):
        """serialize_json is deliberately untouched by this fix -- the
        formula-injection vector is specific to files reopened in a
        spreadsheet app, not the JSON canonical format. Documents the
        boundary so a future reader doesn't assume JSON needs the same
        treatment."""
        content = io.serialize_json([_row(name="=1+1")])
        card = json.loads(content)["cards"][0]
        assert card["name"] == "=1+1"


# ---------------------------------------------------------------------------
# Part 3: upload-boundary abuse -- exact-cap edges of the router's size/row
# gates. Needs the live app + DB (same gate as test_inventory_import_api.py);
# app/routers/inventory.py's IMPORT_MAX_UPLOAD_BYTES/IMPORT_MAX_ROWS are
# imported read-only for the boundary math, never modified here (owned by
# another BL-158 agent).
# ---------------------------------------------------------------------------

pytestmark_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


def _post_import(client, *, content, filename, mode, cap_handling, stage):
    if isinstance(content, str):
        content = content.encode("utf-8")
    return client.post(
        "/api/inventory/import",
        files={"file": (filename, content)},
        data={"mode": mode, "cap_handling": cap_handling, "stage": stage},
    )


def _json_doc(cards: list[dict], format_version: str = "swu-inv/1") -> str:
    return json.dumps(
        {
            "format_version": format_version,
            "exported_at": "2026-07-22T00:00:00Z",
            "source": "test",
            "cards": cards,
        }
    )


def _exact_size_csv(byte_count: int) -> tuple[bytes, int]:
    """A structurally valid (meta-line, many small rows, unresolvable
    identities) CSV that lands at exactly `byte_count` bytes -- for probing
    the router's file_too_large gate at its precise boundary rather than an
    arbitrarily-oversized blob. Returns (content, row_count).

    Deliberately spreads the padding across many ~600-byte rows rather
    than one giant field: a single field anywhere near 10 MB trips the
    stdlib csv module's own 128 KB/field limit (see TestHugeSingleField --
    that's the real gap this abuse suite found and inventory_io.parse_csv
    now refuses cleanly for), and this helper's job is the whole-file byte
    boundary, not that one. 10 MB / ~620 bytes-per-row keeps the row count
    comfortably under the router's separate 20,000-row cap too."""
    header = (
        "# swu-inv-export v1\n"
        "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle\n"
    )
    row_prefix_tpl = "boundary-{:06d},,,,1,"
    row_suffix = ",\n"
    row_overhead = len((row_prefix_tpl.format(0) + row_suffix).encode("utf-8"))
    standard_fill = 600  # far under the csv module's 128 KB/field limit
    standard_row_bytes = row_overhead + standard_fill

    remaining = byte_count - len(header.encode("utf-8"))
    assert remaining > 0, "byte_count too small for a valid boundary CSV"

    rows: list[str] = []
    idx = 0
    while remaining > standard_row_bytes + row_overhead:
        idx += 1
        rows.append(row_prefix_tpl.format(idx) + ("x" * standard_fill) + row_suffix)
        remaining -= standard_row_bytes

    # Final row absorbs the exact remainder.
    idx += 1
    final_fill = remaining - row_overhead
    assert 0 <= final_fill <= 100_000, (
        "final field must stay under the csv module's limit"
    )
    rows.append(row_prefix_tpl.format(idx) + ("x" * final_fill) + row_suffix)

    content = header + "".join(rows)
    encoded = content.encode("utf-8")
    assert len(encoded) == byte_count, (len(encoded), byte_count)
    assert len(rows) <= 20_000, "row count must itself stay under the router's row cap"
    return encoded, len(rows)


@pytestmark_db
class TestUploadSizeBoundaryExactlyAtCap:
    """Complements test_inventory_import_api.py::TestUploadLimits, which
    already covers the reject side (cap+1). The accept side -- a file of
    exactly IMPORT_MAX_UPLOAD_BYTES -- was previously unexercised; the
    router's check is a strict `>`, so the exact boundary must succeed."""

    @pytest.fixture
    def tenant_client(self, db, make_client):
        from app.routers.inventory import IMPORT_MAX_UPLOAD_BYTES

        suffix = uuid.uuid4().hex[:12]
        uid = f"test-bl158-{suffix}"
        email = f"bl158-{suffix}@example.com"
        tenant_id = db.execute(
            text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
            {"name": f"BL-158 Test Tenant {suffix}"},
        ).scalar()
        db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES (:uid, :tenant_id, :email)"
            ),
            {"uid": uid, "tenant_id": tenant_id, "email": email},
        )
        db.commit()
        client = make_client(uid, email, True)
        try:
            yield client, IMPORT_MAX_UPLOAD_BYTES
        finally:
            db.rollback()
            db.execute(
                text("DELETE FROM inventory WHERE tenant_id = :t"), {"t": tenant_id}
            )
            db.execute(
                text("DELETE FROM tenant_card_limits WHERE tenant_id = :t"),
                {"t": tenant_id},
            )
            db.execute(
                text("DELETE FROM tenant_settings WHERE tenant_id = :t"),
                {"t": tenant_id},
            )
            db.execute(
                text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid}
            )
            db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
            db.commit()

    def test_exactly_at_cap_bytes_is_accepted(self, tenant_client):
        client, cap = tenant_client
        content, row_count = _exact_size_csv(cap)
        assert len(content) == cap
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200, resp.text
        report = resp.json()
        assert report["totals"]["rows"] == row_count

    def test_one_byte_over_cap_is_rejected(self, tenant_client):
        client, cap = tenant_client
        content, _row_count = _exact_size_csv(cap)
        content = content + b"z"
        assert len(content) == cap + 1
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "file_too_large"


@pytestmark_db
class TestUploadRowCountBoundaryExactlyAtCap:
    """Same shape, for IMPORT_MAX_ROWS: the reject side (cap+1, both CSV and
    JSON) is already covered by test_inventory_import_api.py::
    TestUploadLimits. The accept side -- exactly IMPORT_MAX_ROWS rows --
    was previously unexercised."""

    @pytest.fixture
    def tenant_client(self, db, make_client):
        from app.routers.inventory import IMPORT_MAX_ROWS

        suffix = uuid.uuid4().hex[:12]
        uid = f"test-bl158rows-{suffix}"
        email = f"bl158rows-{suffix}@example.com"
        tenant_id = db.execute(
            text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
            {"name": f"BL-158 Rows Test Tenant {suffix}"},
        ).scalar()
        db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES (:uid, :tenant_id, :email)"
            ),
            {"uid": uid, "tenant_id": tenant_id, "email": email},
        )
        db.commit()
        client = make_client(uid, email, True)
        try:
            yield client, IMPORT_MAX_ROWS
        finally:
            db.rollback()
            db.execute(
                text("DELETE FROM inventory WHERE tenant_id = :t"), {"t": tenant_id}
            )
            db.execute(
                text("DELETE FROM tenant_card_limits WHERE tenant_id = :t"),
                {"t": tenant_id},
            )
            db.execute(
                text("DELETE FROM tenant_settings WHERE tenant_id = :t"),
                {"t": tenant_id},
            )
            db.execute(
                text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid}
            )
            db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
            db.commit()

    def test_exactly_at_row_cap_is_accepted(self, tenant_client):
        client, cap = tenant_client
        cards = [
            {"swuapi_uuid": f"bl158-garbage-{n}", "quantity": 1} for n in range(cap)
        ]
        resp = _post_import(
            client,
            content=_json_doc(cards),
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["totals"]["rows"] == cap
