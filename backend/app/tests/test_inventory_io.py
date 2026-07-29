"""BL-54 S1: app/services/inventory_io.py -- the swu-inv/1 canonical
format's serialize/parse boundary (Definition_ImportExport_2026-07-22.md
§3). Pure unit tests, no DATABASE_URL required -- this module never touches
the DB, so these run everywhere (local, CI) without the backend container.

Run:
    docker compose exec backend pytest app/tests/test_inventory_io.py -v
"""

from datetime import datetime, timezone

import pytest

from app.services import inventory_io as io


def make_row(**overrides) -> io.InventoryRow:
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


class TestSerializeJson:
    def test_golden_shape(self):
        row = make_row(
            derived=io.DerivedInfo(finish="Standard", channel="Retail", stamped=False)
        )
        content = io.serialize_json(
            [row],
            source="hyperspacevault",
            exported_at=datetime(2026, 7, 22, 23, 50, 0, tzinfo=timezone.utc),
        )
        import json

        payload = json.loads(content)
        assert payload == {
            "format_version": "swu-inv/1",
            "exported_at": "2026-07-22T23:50:00Z",
            "source": "hyperspacevault",
            "cards": [
                {
                    "swuapi_uuid": "uuid-1",
                    "set_code": "SOR",
                    "card_number": "237",
                    "variant_type": "Standard",
                    "quantity": 3,
                    "name": "Alliance X-Wing",
                    "subtitle": None,
                    "_derived": {
                        "finish": "Standard",
                        "channel": "Retail",
                        "stamped": False,
                    },
                }
            ],
        }

    def test_omits_derived_block_when_absent(self):
        """derived is export-only/optional -- a row built without one (e.g.
        a round-trip-comparison row from parsed data) serializes with no
        _derived key at all, not a null one."""
        content = io.serialize_json([make_row(derived=None)])
        import json

        card = json.loads(content)["cards"][0]
        assert "_derived" not in card

    def test_default_exported_at_is_close_to_now(self):
        before = datetime.now(timezone.utc)
        content = io.serialize_json([])
        after = datetime.now(timezone.utc)
        import json

        exported_at = datetime.strptime(
            json.loads(content)["exported_at"], "%Y-%m-%dT%H:%M:%SZ"
        ).replace(tzinfo=timezone.utc)
        assert (
            before <= exported_at <= after or (after - exported_at).total_seconds() < 2
        )


class TestSerializeCsv:
    def test_golden_shape(self):
        rows = [
            make_row(),
            make_row(
                swuapi_uuid=None,
                set_code="SEC",
                card_number="1127",
                variant_type="Serialized Prestige",
                quantity=1,
                name="Queen Amidala",
                subtitle="Championing Her People",
            ),
        ]
        content = io.serialize_csv(rows)
        lines = content.splitlines()
        assert lines[0] == "# swu-inv-export v1"
        assert (
            lines[1]
            == "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle"
        )
        assert lines[2] == "uuid-1,SOR,237,Standard,3,Alliance X-Wing,"
        assert lines[3] == (
            ",SEC,1127,Serialized Prestige,1,Queen Amidala,Championing Her People"
        )

    def test_comma_in_name_is_quoted(self):
        content = io.serialize_csv([make_row(name="Vader's Castle, Mustafar")])
        assert '"Vader\'s Castle, Mustafar"' in content


class TestParseCsvMetaLinePolicy:
    def test_meta_line_accepted(self):
        content = (
            "# swu-inv-export v1\n"
            "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle\n"
            "uuid-1,SOR,237,Standard,3,Alliance X-Wing,\n"
        )
        result = io.parse_csv(content)
        assert len(result.rows) == 1
        assert result.rows[0].quantity == 3

    def test_header_only_with_uuid_column_accepted_without_meta_line(self):
        """§6: the catalog reference CSV (no meta line) plus a hand-added
        quantity column must parse -- this is the whole point of the
        meta-line-optional rule."""
        content = "swuapi_uuid,set_code,card_number,variant_type,name,subtitle,quantity\nuuid-1,SOR,237,Standard,Alliance X-Wing,,2\n"
        result = io.parse_csv(content)
        assert len(result.rows) == 1
        assert result.rows[0].quantity == 2
        assert result.rows[0].swuapi_uuid == "uuid-1"

    def test_header_only_with_full_triple_accepted_without_meta_line(self):
        content = "set_code,card_number,variant_type,quantity\nSOR,237,Standard,2\n"
        result = io.parse_csv(content)
        assert len(result.rows) == 1
        assert result.rows[0].set_code == "SOR"

    def test_header_missing_quantity_refused(self):
        content = (
            "swuapi_uuid,set_code,card_number,variant_type\nuuid-1,SOR,237,Standard\n"
        )
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(content)

    def test_header_with_quantity_but_no_identity_scheme_refused(self):
        content = "quantity,name\n3,Alliance X-Wing\n"
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(content)

    def test_partial_triple_without_meta_line_refused(self):
        """set_code + card_number but no variant_type is not a usable
        identity scheme -- §2's foil-collision rule requires all three."""
        content = "set_code,card_number,quantity\nSOR,237,3\n"
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(content)

    def test_empty_file_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv("")

    def test_meta_line_with_no_header_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv("# swu-inv-export v1\n")

    def test_bytes_input_with_bom_accepted(self):
        """.encode("utf-8-sig") prepends the BOM itself -- exercises a real
        Excel-style export without hand-embedding the BOM character in the
        test source."""
        content = (
            "# swu-inv-export v1\n"
            "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle\n"
            "uuid-1,SOR,237,Standard,3,Alliance X-Wing,\n"
        ).encode("utf-8-sig")
        result = io.parse_csv(content)
        assert len(result.rows) == 1


class TestParseCsvUnknownColumns:
    def test_unknown_column_reported_not_refused(self):
        content = (
            "# swu-inv-export v1\n"
            "swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle,condition\n"
            "uuid-1,SOR,237,Standard,3,Alliance X-Wing,,Near Mint\n"
        )
        result = io.parse_csv(content)
        assert result.notes.unrecognized_columns == ["condition"]
        assert len(result.rows) == 1
        assert result.rows[0].quantity == 3


class TestParseCsvRowValidity:
    def test_missing_quantity_is_malformed(self):
        content = "set_code,card_number,variant_type,quantity\nSOR,237,Standard,\n"
        result = io.parse_csv(content)
        assert result.rows[0].malformed_quantity is True
        assert result.rows[0].quantity is None

    def test_negative_quantity_is_malformed(self):
        content = "set_code,card_number,variant_type,quantity\nSOR,237,Standard,-1\n"
        result = io.parse_csv(content)
        assert result.rows[0].malformed_quantity is True

    def test_non_integer_quantity_is_malformed(self):
        content = "set_code,card_number,variant_type,quantity\nSOR,237,Standard,abc\n"
        result = io.parse_csv(content)
        assert result.rows[0].malformed_quantity is True

    def test_zero_quantity_is_valid(self):
        content = "set_code,card_number,variant_type,quantity\nSOR,237,Standard,0\n"
        result = io.parse_csv(content)
        assert result.rows[0].malformed_quantity is False
        assert result.rows[0].quantity == 0

    def test_duplicate_uuid_rows_summed(self):
        content = "swuapi_uuid,quantity\nuuid-1,2\nuuid-1,3\n"
        result = io.parse_csv(content)
        assert len(result.rows) == 1
        assert result.rows[0].quantity == 5
        assert result.rows[0].row_number == 1
        assert result.notes.duplicate_rows_merged == 1

    def test_duplicate_triple_rows_summed(self):
        content = (
            "set_code,card_number,variant_type,quantity\n"
            "SOR,237,Standard,1\n"
            "SOR,237,Standard,1\n"
            "SOR,237,Standard,1\n"
        )
        result = io.parse_csv(content)
        assert len(result.rows) == 1
        assert result.rows[0].quantity == 3
        assert result.notes.duplicate_rows_merged == 2

    def test_foil_collision_not_merged(self):
        """§10 case 2: SOR,237,Standard and SOR,237,Standard Foil are
        distinct identities -- the triple's variant_type matters."""
        content = (
            "set_code,card_number,variant_type,quantity\n"
            "SOR,237,Standard,1\n"
            "SOR,237,Standard Foil,1\n"
        )
        result = io.parse_csv(content)
        assert len(result.rows) == 2
        assert result.notes.duplicate_rows_merged == 0

    def test_malformed_quantity_row_never_merged_into_a_group(self):
        content = "swuapi_uuid,quantity\nuuid-1,2\nuuid-1,abc\n"
        result = io.parse_csv(content)
        assert len(result.rows) == 2
        by_row_number = {r.row_number: r for r in result.rows}
        assert by_row_number[1].quantity == 2
        assert by_row_number[2].malformed_quantity is True
        assert result.notes.duplicate_rows_merged == 0

    def test_rows_with_no_identity_never_merged_with_each_other(self):
        # A bare "quantity,name" header (no identity scheme at all) would
        # be refused outright by the meta-line policy before rows are ever
        # read, so exercise this with a meta-line-carrying file whose rows
        # simply leave both identity fields blank.
        content = "# swu-inv-export v1\nswuapi_uuid,quantity\n,3\n,3\n"
        result = io.parse_csv(content)
        assert len(result.rows) == 2
        assert result.notes.duplicate_rows_merged == 0


class TestParseJson:
    def test_golden_shape(self):
        content = (
            '{"format_version": "swu-inv/1", "exported_at": "2026-07-22T23:50:00Z", '
            '"source": "hyperspacevault", "cards": [{"swuapi_uuid": "uuid-1", '
            '"set_code": "SOR", "card_number": "237", "variant_type": "Standard", '
            '"quantity": 3, "name": "Alliance X-Wing", "subtitle": null, '
            '"_derived": {"finish": "Standard", "channel": "Retail", "stamped": false}}]}'
        )
        result = io.parse_json(content)
        assert len(result.rows) == 1
        row = result.rows[0]
        assert row.swuapi_uuid == "uuid-1"
        assert row.quantity == 3
        assert row.malformed_quantity is False
        # _derived is a known key, ignored on import -- never surfaces as
        # unrecognized and never lands on ParsedRow.
        assert result.notes.unrecognized_columns == []

    def test_unrecognized_key_reported(self):
        content = (
            '{"format_version": "swu-inv/1", "cards": '
            '[{"quantity": 1, "swuapi_uuid": "u1", "condition": "NM"}]}'
        )
        result = io.parse_json(content)
        assert result.notes.unrecognized_columns == ["condition"]

    def test_unsupported_format_version_refused(self):
        content = '{"format_version": "swu-inv/2", "cards": []}'
        with pytest.raises(io.UnsupportedFormatVersionError) as exc_info:
            io.parse_json(content)
        assert exc_info.value.reason == "unsupported_format_version"
        assert exc_info.value.version == "swu-inv/2"

    def test_missing_format_version_refused(self):
        content = '{"cards": []}'
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(content)

    def test_missing_cards_array_refused(self):
        content = '{"format_version": "swu-inv/1"}'
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(content)

    def test_malformed_json_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json("{not valid json")

    def test_non_object_root_refused(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json("[1, 2, 3]")

    def test_float_quantity_is_malformed(self):
        """Strict-typing decision (documented in the module docstring): a
        JSON float, even a whole one, is not an "integer" per §3.4."""
        content = '{"format_version": "swu-inv/1", "cards": [{"swuapi_uuid": "u1", "quantity": 3.0}]}'
        result = io.parse_json(content)
        assert result.rows[0].malformed_quantity is True

    def test_bool_quantity_is_malformed(self):
        content = '{"format_version": "swu-inv/1", "cards": [{"swuapi_uuid": "u1", "quantity": true}]}'
        result = io.parse_json(content)
        assert result.rows[0].malformed_quantity is True

    def test_negative_quantity_is_malformed(self):
        content = '{"format_version": "swu-inv/1", "cards": [{"swuapi_uuid": "u1", "quantity": -1}]}'
        result = io.parse_json(content)
        assert result.rows[0].malformed_quantity is True

    def test_duplicate_uuid_cards_summed(self):
        content = (
            '{"format_version": "swu-inv/1", "cards": ['
            '{"swuapi_uuid": "uuid-1", "quantity": 2}, '
            '{"swuapi_uuid": "uuid-1", "quantity": 5}]}'
        )
        result = io.parse_json(content)
        assert len(result.rows) == 1
        assert result.rows[0].quantity == 7
        assert result.notes.duplicate_rows_merged == 1

    def test_ambiguous_triple_case_parses_as_a_single_triple_row(self):
        """§10 case 3: the parser doesn't know about ambiguity (that's S2's
        resolution job) -- it just carries the triple through untouched."""
        content = (
            '{"format_version": "swu-inv/1", "cards": '
            '[{"set_code": "SEC", "card_number": "1127", '
            '"variant_type": "Serialized Prestige", "quantity": 1}]}'
        )
        result = io.parse_json(content)
        assert len(result.rows) == 1
        assert result.rows[0].set_code == "SEC"
        assert result.rows[0].swuapi_uuid is None


class TestRoundTrip:
    def test_serialize_then_parse_json_preserves_identity_and_quantity(self):
        rows = [
            make_row(),
            make_row(
                swuapi_uuid=None,
                set_code="SEC",
                card_number="1127",
                variant_type="Serialized Prestige",
                quantity=1,
                name="Queen Amidala",
                subtitle="Championing Her People",
            ),
        ]
        content = io.serialize_json(rows)
        result = io.parse_json(content)
        assert len(result.rows) == len(rows)
        for original, parsed in zip(rows, result.rows):
            assert parsed.swuapi_uuid == original.swuapi_uuid
            assert parsed.set_code == original.set_code
            assert parsed.card_number == original.card_number
            assert parsed.variant_type == original.variant_type
            assert parsed.quantity == original.quantity
            assert parsed.malformed_quantity is False
            assert parsed.name == original.name
            assert parsed.subtitle == original.subtitle

    def test_serialize_then_parse_csv_preserves_identity_and_quantity(self):
        rows = [
            make_row(),
            make_row(
                swuapi_uuid=None,
                set_code="SEC",
                card_number="1127",
                variant_type="Serialized Prestige",
                quantity=1,
                name="Queen Amidala",
                subtitle="Championing Her People",
            ),
        ]
        content = io.serialize_csv(rows)
        result = io.parse_csv(content)
        assert len(result.rows) == len(rows)
        for original, parsed in zip(rows, result.rows):
            assert parsed.swuapi_uuid == original.swuapi_uuid
            assert parsed.set_code == original.set_code
            assert parsed.card_number == original.card_number
            assert parsed.variant_type == original.variant_type
            assert parsed.quantity == original.quantity
            assert parsed.name == original.name
            assert parsed.subtitle == original.subtitle


class TestInvalidUtf8Bytes:
    """Bytes that aren't valid UTF-8 (a binary or differently-encoded
    upload) must surface as UnparseableFileError -- the module's documented
    parse-failure surface -- never leak UnicodeDecodeError (which S2's
    import router would otherwise turn into an unhandled 500 on a
    user-input path)."""

    INVALID_UTF8 = b"\x89BIN\x00\xff\xfe not utf-8 \x80\x81"

    def test_parse_csv_refuses_invalid_utf8_bytes(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_csv(self.INVALID_UTF8)

    def test_parse_json_refuses_invalid_utf8_bytes(self):
        with pytest.raises(io.UnparseableFileError):
            io.parse_json(self.INVALID_UTF8)
