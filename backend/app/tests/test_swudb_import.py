"""BL-185: app/services/swudb_import.py -- SWUDB collection-export import
adapter. Pure unit tests only (set-code table, normalization, foil/stamp
disambiguation, format detection) -- no DATABASE_URL required, mirroring
test_inventory_io.py's posture. DB-backed resolution/API-level coverage
(parse_swudb_csv against real card_variants rows, POST /api/inventory/
import end to end) lives in test_inventory_import_api.py alongside the
rest of the import API tests, reusing its existing tenant/catalog fixture
plumbing.

Run:
    docker compose exec backend pytest app/tests/test_swudb_import.py -v
"""

from app.models.card_variant import CardVariant
from app.services import swudb_import as swudb


def _variant(variant_type: str, swuapi_id: str, source_set_code="SOR", card_number="1"):
    """A bare (unpersisted) CardVariant plus the (name, subtitle, type)
    triple _resolve_candidates expects -- VariantMatch's shape, built
    without touching the DB (matches test_inventory_io.py's no-DB
    posture)."""
    cv = CardVariant(
        variant_type=variant_type,
        swuapi_id=swuapi_id,
        source_set_code=source_set_code,
        card_number=card_number,
    )
    return (cv, "Test Card", None, "Unit")


class TestSetCodeMap:
    def test_direct_codes(self):
        for code in (
            "ASH",
            "C26",
            "IBH",
            "J25",
            "JTL",
            "JTLP",
            "LAW",
            "P25",
            "SEC",
            "SHD",
            "SOR",
            "TS26",
            "TWI",
            "LOF",
        ):
            assert swudb.SET_CODE_MAP[code] == code

    def test_renames(self):
        assert swudb.SET_CODE_MAP["CE25"] == "C25"
        assert swudb.SET_CODE_MAP["GGTS"] == "GG"

    def test_sorpr_synthetic_code_maps_to_sor(self):
        assert swudb.SET_CODE_MAP["SORPR"] == "SOR"

    def test_unmapped_code_absent(self):
        """GC23 (BL-185 definition doc §3.4) is deliberately NOT in the
        table -- never guessed."""
        assert "GC23" not in swudb.SET_CODE_MAP


class TestNormalizeNumber:
    def test_strips_three_digit_padding(self):
        assert swudb._normalize_number("001") == "1"

    def test_strips_two_digit_padding(self):
        assert swudb._normalize_number("08") == "8"

    def test_no_padding_is_a_no_op(self):
        assert swudb._normalize_number("1127") == "1127"

    def test_non_numeric_falls_back_to_raw_stripped(self):
        assert swudb._normalize_number(" T2 ") == "T2"


class TestIsFoilish:
    def test_plain_standard_is_not_foilish(self):
        assert swudb._is_foilish("Standard") is False

    def test_standard_foil_is_foilish(self):
        assert swudb._is_foilish("Standard Foil") is True

    def test_showcase_is_foilish_despite_no_foil_substring(self):
        """§7 locked decision (5): Showcase is always foil as a domain
        fact, even though the string "Showcase" never contains "Foil"."""
        assert swudb._is_foilish("Showcase") is True

    def test_serialized_prestige_is_foilish_via_prestige_foil_family(self):
        assert swudb._is_foilish("Serialized Prestige") is True

    def test_standard_prestige_is_not_foilish(self):
        assert swudb._is_foilish("Standard Prestige") is False


class TestStampMatches:
    def test_blank_stamp_matches_the_untiered_candidate(self):
        assert swudb._stamp_matches(None, "Prerelease Promo") is True

    def test_blank_stamp_rejects_a_judge_candidate(self):
        assert swudb._stamp_matches(None, "Prerelease Judge") is False

    def test_judge_stamp_matches_judge_candidate(self):
        assert swudb._stamp_matches("Judge", "Prerelease Judge") is True

    def test_top8_stamp_matches_top_8_text(self):
        assert swudb._stamp_matches("Top8", "GC Top 8") is True

    def test_unrecognized_stamp_falls_back_to_substring(self):
        assert swudb._stamp_matches("Finalist", "GC Finalist") is True


class TestResolveCandidates:
    def test_zero_candidates_unknown_set_and_number(self):
        outcome = swudb._resolve_candidates([], is_foil=False, stamp=None)
        assert outcome.swuapi_uuid is None
        assert outcome.reason == "unknown_set_and_number"
        assert outcome.candidates == []

    def test_single_candidate_resolves_with_no_mismatch(self):
        candidates = [_variant("Standard", "uuid-a")]
        outcome = swudb._resolve_candidates(candidates, is_foil=False, stamp=None)
        assert outcome.swuapi_uuid == "uuid-a"
        assert outcome.mismatch is False
        assert outcome.reason is None

    def test_single_candidate_foil_mismatch_is_a_soft_warning(self):
        """IsFoil disagrees with the sole candidate's finish -- still
        resolved, just flagged (§6 step 3 / §7): never a failure."""
        candidates = [_variant("Standard", "uuid-a")]
        outcome = swudb._resolve_candidates(candidates, is_foil=True, stamp=None)
        assert outcome.swuapi_uuid == "uuid-a"
        assert outcome.mismatch is True

    def test_single_showcase_candidate_with_is_foil_true_is_not_a_mismatch(self):
        """§7 locked decision (5), applied at the 1-candidate step too --
        the file agreeing that a Showcase card is foil is consistent, not
        a mismatch."""
        candidates = [_variant("Showcase", "uuid-showcase")]
        outcome = swudb._resolve_candidates(candidates, is_foil=True, stamp=None)
        assert outcome.mismatch is False

    def test_foil_split_resolves_standard_vs_standard_foil(self):
        candidates = [
            _variant("Standard", "uuid-std"),
            _variant("Standard Foil", "uuid-foil"),
        ]
        resolved_std = swudb._resolve_candidates(candidates, is_foil=False, stamp=None)
        resolved_foil = swudb._resolve_candidates(candidates, is_foil=True, stamp=None)
        assert resolved_std.swuapi_uuid == "uuid-std"
        assert resolved_foil.swuapi_uuid == "uuid-foil"

    def test_sorpr_pair_resolved_by_stamp_when_foil_split_is_empty(self):
        """§3.3/§4's worked example: both candidates have IsFoil=True in
        the file, but neither variant_type reads as foilish -- the foil
        split leaves zero matches, so resolution falls back to stamp
        matching against the full candidate set."""
        candidates = [
            _variant("Prerelease Promo", "uuid-promo"),
            _variant("Prerelease Judge", "uuid-judge"),
        ]
        blank_stamp = swudb._resolve_candidates(candidates, is_foil=True, stamp=None)
        judge_stamp = swudb._resolve_candidates(candidates, is_foil=True, stamp="Judge")
        assert blank_stamp.swuapi_uuid == "uuid-promo"
        assert judge_stamp.swuapi_uuid == "uuid-judge"

    def test_main_set_tier_resolves_the_real_sor_1_shape(self):
        """BL-199 step (c): the owner's real SOR 1 family (post token
        exclusion) -- Krennic's Standard sharing its number with four
        run-locally numbered promo printings of OTHER cards. A plain
        no-foil, no-stamp row means the main-set card."""
        candidates = [
            _variant("Standard", "uuid-krennic"),
            _variant("Prerelease Promo", "uuid-vader-promo"),
            _variant("Prerelease Judge", "uuid-vader-judge"),
            _variant("SS Judge", "uuid-takedown-judge"),
            _variant("SS Participation", "uuid-takedown-part"),
            _variant("Weekly Play", "uuid-marine-wp"),
        ]
        outcome = swudb._resolve_candidates(candidates, is_foil=False, stamp=None)
        assert outcome.swuapi_uuid == "uuid-krennic"
        assert outcome.mismatch is False
        assert outcome.reason is None

    def test_main_set_tier_foil_disagreement_is_a_soft_mismatch(self):
        """IsFoil=True against a family whose only main-set printing is
        non-foil -- still resolves (same posture as the single-candidate
        step), flagged as a mismatch, never a failure."""
        candidates = [
            _variant("Standard", "uuid-krennic"),
            _variant("Prerelease Promo", "uuid-vader-promo"),
            _variant("Weekly Play", "uuid-marine-wp"),
        ]
        outcome = swudb._resolve_candidates(candidates, is_foil=True, stamp=None)
        assert outcome.swuapi_uuid == "uuid-krennic"
        assert outcome.mismatch is True

    def test_main_set_tier_never_steals_a_stamped_row(self):
        """A Judge stamp narrows to the promo side before the tier runs --
        two Judge printings of different cards at one number stay
        ambiguous (the file genuinely can't tell them apart), and the
        main-set card is never resolved for a stamped row."""
        candidates = [
            _variant("Standard", "uuid-krennic"),
            _variant("Prerelease Judge", "uuid-vader-judge"),
            _variant("SS Judge", "uuid-takedown-judge"),
        ]
        outcome = swudb._resolve_candidates(candidates, is_foil=False, stamp="Judge")
        assert outcome.swuapi_uuid is None
        assert outcome.reason == "ambiguous_triple"

    def test_still_ambiguous_after_foil_and_stamp_lists_all_candidates(self):
        """The SEC_1127 Serialized Prestige trio shape: identical foil-ness
        and identical stamp keyword across every candidate -- irreducibly
        ambiguous, routed into the EXISTING ambiguous_triple reason (§7
        locked decision (4): no new UX)."""
        candidates = [
            _variant("Serialized Prestige", "uuid-c1"),
            _variant("Serialized Prestige", "uuid-c2"),
            _variant("Serialized Prestige", "uuid-c3"),
        ]
        outcome = swudb._resolve_candidates(
            candidates, is_foil=True, stamp="Serialized"
        )
        assert outcome.swuapi_uuid is None
        assert outcome.reason == "ambiguous_triple"
        # BL-200 PORT: `.candidates` widened from bare swuapi_id strings to
        # full VariantMatch tuples -- see _Outcome's own doc comment.
        assert [c[0].swuapi_id for c in outcome.candidates] == [
            "uuid-c1",
            "uuid-c2",
            "uuid-c3",
        ]


class TestFormatDetection:
    """The router's _detect_import_format seam (app/routers/inventory.py)
    -- pure functions, no DB. Confirms canonical files still route to the
    existing parsers and the SWUDB header (4- or 5-column) routes to the
    new branch."""

    def test_five_column_swudb_header_detected(self):
        from app.routers.inventory import _detect_import_format

        text = "Set,CardNumber,Count,IsFoil,Stamp\nASH,001,1,False,\n"
        assert _detect_import_format("collection.csv", text) == "swudb"

    def test_four_column_swudb_header_detected(self):
        """SWUDB's own import format is the 4-column subset (no Stamp)."""
        from app.routers.inventory import _detect_import_format

        text = "Set,CardNumber,Count,IsFoil\nASH,001,1,False\n"
        assert _detect_import_format("collection.csv", text) == "swudb"

    def test_swudb_header_detected_even_without_csv_extension(self):
        from app.routers.inventory import _detect_import_format

        text = "Set,CardNumber,Count,IsFoil,Stamp\nASH,001,1,False,\n"
        assert _detect_import_format("upload", text) == "swudb"

    def test_canonical_csv_with_meta_line_still_routes_to_csv(self):
        from app.routers.inventory import _detect_import_format

        text = "# swu-inv-export v1\nswuapi_uuid,quantity\nx,1\n"
        assert _detect_import_format("upload.csv", text) == "csv"

    def test_canonical_csv_header_without_meta_line_still_routes_to_csv(self):
        from app.routers.inventory import _detect_import_format

        text = "set_code,card_number,variant_type,quantity\nSOR,1,Standard,1\n"
        assert _detect_import_format("upload.csv", text) == "csv"

    def test_canonical_json_still_routes_to_json(self):
        from app.routers.inventory import _detect_import_format

        text = '{"format_version": "swu-inv/1", "cards": []}'
        assert _detect_import_format("upload.json", text) == "json"

    def test_json_extension_trusted_even_over_swudb_looking_body(self):
        """.json is never sniffed for a SWUDB header -- SWUDB has no JSON
        export, so the extension is trusted outright, same as before
        BL-185."""
        from app.routers.inventory import _detect_import_format

        text = "Set,CardNumber,Count,IsFoil,Stamp\nASH,001,1,False,\n"
        assert _detect_import_format("upload.json", text) == "json"
