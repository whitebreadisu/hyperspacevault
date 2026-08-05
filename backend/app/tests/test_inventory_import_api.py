"""BL-54 S2 (Definition_ImportExport_2026-07-22.md §4/§5/§7.2/§7.3):
POST /api/inventory/import -- resolution engine, merge/cap math, dry_run vs
commit, and the report shape. Covers every named case in §10 (the backend
halves), plus RLS/tenant isolation and transactionality.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_inventory_import_api.py -v
"""

import json
import os
import uuid

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)


# ---------------------------------------------------------------------------
# Fixture catalog: BL-54 S2's own small, self-contained set of variants
# (CI runs against a trimmed catalog, not the full bootstrap set -- see
# conftest.seed_minimal_catalog and CLAUDE.md's testing note).
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def bl54s2_catalog(db):
    """
    - card A (base "BL54S2 Trooper Alpha", card_number 9711): one Standard
      variant -- bucket "Standard" / category "standard" / default limit 3,
      used by the trim/ceiling/fallback/mismatch cases.
    - card B (base "BL54S2 Officer Beta", card_number 9712): a Standard +
      Standard Foil pair sharing the SAME card_number -- §10 case 2's foil
      collision (set+number alone is never enough; variant_type is what
      disambiguates).
    - card C (base "BL54S2 Prestige Gamma", card_number 9713): three
      variants that all carry the literal identical triple
      (SOR, "9713", "Serialized Prestige") -- the Serialized Prestige
      landmine shape (§10 case 3), reproduced here since card_variants has
      no uniqueness constraint on that triple (only on swuapi_id).

    Card numbers are deliberately in a 97xx range not used by any other
    test file's fixture (test_inventory_export_api.py's 9301/9302/9402,
    test_catalog_reference_api.py's 9601, test_inventory_limits_api.py's
    9301) -- CI runs every test module against the same shared DB, so a
    (source_set_code, card_number, variant_type) collision with another
    file's fixture would silently make an unrelated triple ambiguous here
    (this stumbled the first draft of this file: card_number 9402 collided
    with test_inventory_export_api.py's Standard Foil fixture row).
    """
    sor_id = db.execute(text("SELECT id FROM sets WHERE code = 'SOR'")).scalar()

    def _upsert_base_card(swuapi_id, number, name):
        row = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id) "
                "VALUES (:set_id, :number, :name, 'Unit', 'Common', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {"set_id": sor_id, "number": number, "name": name, "swuapi_id": swuapi_id},
        ).first()
        return row.id

    def _upsert_variant(swuapi_id, base_card_id, card_number, variant_type):
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, 'SOR', :card_number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).first()
        return row.id

    bc_a = _upsert_base_card("bl54s2-bc-a", "9711", "BL54S2 Trooper Alpha")
    bc_b = _upsert_base_card("bl54s2-bc-b", "9712", "BL54S2 Officer Beta")
    bc_c = _upsert_base_card("bl54s2-bc-c", "9713", "BL54S2 Prestige Gamma")

    a_standard = _upsert_variant("bl54s2-v-a-standard", bc_a, "9711", "Standard")
    b_standard = _upsert_variant("bl54s2-v-b-standard", bc_b, "9712", "Standard")
    b_foil = _upsert_variant("bl54s2-v-b-foil", bc_b, "9712", "Standard Foil")
    c1 = _upsert_variant("bl54s2-v-c1", bc_c, "9713", "Serialized Prestige")
    _upsert_variant("bl54s2-v-c2", bc_c, "9713", "Serialized Prestige")
    _upsert_variant("bl54s2-v-c3", bc_c, "9713", "Serialized Prestige")
    db.commit()

    return {
        "a_standard": {"id": a_standard, "uuid": "bl54s2-v-a-standard"},
        "b_standard": {"id": b_standard, "uuid": "bl54s2-v-b-standard"},
        "b_foil": {"id": b_foil, "uuid": "bl54s2-v-b-foil"},
        "c_uuids": ["bl54s2-v-c1", "bl54s2-v-c2", "bl54s2-v-c3"],
        "c1": {"id": c1, "uuid": "bl54s2-v-c1"},
    }


# ---------------------------------------------------------------------------
# BL-185: SWUDB import adapter fixture catalog. Separate from bl54s2_catalog
# above (which lives entirely in SOR) because the SWUDB adapter's whole
# point is exercising the set-code translation table -- these rows span
# ASH/TS26/SEC/C25/GG plus two more SOR families, all at high, unclaimed
# card_numbers (mirroring bl54s2_catalog's own "97xx dodges every other
# fixture" convention, widened here to also dodge any REAL catalog number a
# persistent dev DB might carry for SOR/SEC -- the design doc's own worked
# examples (SOR_193, SOR_1, SEC_1127) are real production collisions,
# exactly the shape a synthetic fixture must NOT reuse verbatim).
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def bl185_catalog(db):
    """
    - ash_standard (ASH, card_number "9826"): one Standard variant --
      zero-pad normalization ("09826" -> "9826"). BL-199 moved this (and
      ts26_standard) off the original low numbers ("5"/"8"): the LIVE dev
      catalog grew real cards there (Luke Skywalker landed on ASH 5), and
      a second Standard at the fixture's number makes these tests
      env-dependently ambiguous -- the 98xx unclaimed-range convention the
      other fixtures already follow applies here too. The leading-zero
      strip these rows exist to prove is width-independent, so the padded
      file forms below keep exercising the same normalization path.
    - ts26_standard (TS26, card_number "9827"): one Standard variant --
      zero-pad normalization ("09827" -> "9827").
    - sorpr_promo / sorpr_judge (SOR, card_number "9820"): "Prerelease
      Promo" + "Prerelease Judge" -- the SORPR synthetic-code pair,
      separated only by Stamp (blank vs "Judge"), §3.3/§4.
    - sor_std / sor_foil (SOR, card_number "9821"): "Standard" + "Standard
      Foil" sharing one card_number -- the IsFoil tiebreak shape (mirrors
      the real SOR_193/SOR_237 collisions without reusing their numbers).
    - sec_serialized_uuids (SEC, card_number "9822"): three "Serialized
      Prestige" variants sharing one card_number -- the irreducibly
      ambiguous shape (mirrors real SEC_1127 without reusing its number).
    - c25_convention (C25, card_number "9823"): one "Convention Exclusive"
      variant -- the CE25 -> C25 rename target.
    - gg_token (GG, card_number "9824"): one "Standard" variant -- the
      GGTS -> GG rename target.
    - ash_token (ASH, card_number "5", is_token=true): a run-locally
      numbered TOKEN sharing ash_standard's exact (set, number) -- the
      BL-199 collision shape (the real ASH 1 Armorer/Mandalorian-token
      pair). Must never enter a SWUDB row's candidate family.
    - sor_wp_interloper (SOR, card_number "9821", "Weekly Play"): a
      promo-run printing of a DIFFERENT base card sharing sor_std's
      number -- BL-199's main-set-tier shape (the real SOR 1
      Krennic-vs-Weekly-Play-Marine collision).
    """
    for code, name in (("ASH", "Ash of the Empire"), ("TS26", "2026 Twin Suns")):
        db.execute(
            text(
                "INSERT INTO sets (code, name, is_base_set) "
                "VALUES (:code, :name, false) ON CONFLICT (code) DO NOTHING"
            ),
            {"code": code, "name": name},
        )
    for code, name in (("C25", "Convention Exclusive 2025"), ("GG", "Gamegenic")):
        db.execute(
            text(
                "INSERT INTO sets (code, name, is_base_set) "
                "VALUES (:code, :name, false) ON CONFLICT (code) DO NOTHING"
            ),
            {"code": code, "name": name},
        )
    db.commit()

    def _upsert_base_card(swuapi_id, set_code, number, name, is_token=False):
        set_id = db.execute(
            text("SELECT id FROM sets WHERE code = :code"), {"code": set_code}
        ).scalar()
        row = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id, is_token) "
                "VALUES (:set_id, :number, :name, 'Unit', 'Common', :swuapi_id, "
                ":is_token) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name, "
                "base_card_number = EXCLUDED.base_card_number "
                "RETURNING id"
            ),
            {
                "set_id": set_id,
                "number": number,
                "name": name,
                "swuapi_id": swuapi_id,
                "is_token": is_token,
            },
        ).first()
        return row.id

    def _upsert_variant(swuapi_id, base_card_id, set_code, card_number, variant_type):
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :set_code, :card_number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "set_code": set_code,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).first()
        return row.id

    bc_ash = _upsert_base_card("bl185-bc-ash", "ASH", "9826", "BL185 Ash Trooper")
    bc_ts26 = _upsert_base_card("bl185-bc-ts26", "TS26", "9827", "BL185 TS26 Trooper")
    bc_sorpr = _upsert_base_card(
        "bl185-bc-sorpr", "SOR", "9820", "BL185 Prerelease Hero"
    )
    bc_sorfoil = _upsert_base_card("bl185-bc-sorfoil", "SOR", "9821", "BL185 Foil Hero")
    bc_sec = _upsert_base_card(
        "bl185-bc-sec", "SEC", "9822", "BL185 Serialized Senator"
    )
    bc_c25 = _upsert_base_card("bl185-bc-c25", "C25", "9823", "BL185 Convention Hero")
    bc_gg = _upsert_base_card("bl185-bc-gg", "GG", "9824", "BL185 Gamegenic Token")
    bc_showcase = _upsert_base_card(
        "bl185-bc-showcase", "SOR", "9825", "BL185 Showcase Hero"
    )

    ash_standard = _upsert_variant("bl185-v-ash", bc_ash, "ASH", "9826", "Standard")
    ts26_standard = _upsert_variant("bl185-v-ts26", bc_ts26, "TS26", "9827", "Standard")
    sorpr_promo = _upsert_variant(
        "bl185-v-sorpr-promo", bc_sorpr, "SOR", "9820", "Prerelease Promo"
    )
    sorpr_judge = _upsert_variant(
        "bl185-v-sorpr-judge", bc_sorpr, "SOR", "9820", "Prerelease Judge"
    )
    sor_std = _upsert_variant("bl185-v-sor-std", bc_sorfoil, "SOR", "9821", "Standard")
    sor_foil = _upsert_variant(
        "bl185-v-sor-foil", bc_sorfoil, "SOR", "9821", "Standard Foil"
    )
    sec_c1 = _upsert_variant(
        "bl185-v-sec-c1", bc_sec, "SEC", "9822", "Serialized Prestige"
    )
    sec_c2 = _upsert_variant(
        "bl185-v-sec-c2", bc_sec, "SEC", "9822", "Serialized Prestige"
    )
    sec_c3 = _upsert_variant(
        "bl185-v-sec-c3", bc_sec, "SEC", "9822", "Serialized Prestige"
    )
    c25_convention = _upsert_variant(
        "bl185-v-c25", bc_c25, "C25", "9823", "Convention Exclusive"
    )
    gg_token = _upsert_variant("bl185-v-gg", bc_gg, "GG", "9824", "Standard")
    showcase = _upsert_variant(
        "bl185-v-showcase", bc_showcase, "SOR", "9825", "Showcase"
    )
    bc_ash_token = _upsert_base_card(
        "bl185-bc-ash-token", "ASH", "9826", "BL185 Ash Trooper Token", is_token=True
    )
    ash_token = _upsert_variant(
        "bl185-v-ash-token", bc_ash_token, "ASH", "9826", "Standard"
    )
    bc_sor_wp = _upsert_base_card(
        "bl185-bc-sor-wp", "SOR", "9821", "BL185 WP Interloper"
    )
    sor_wp_interloper = _upsert_variant(
        "bl185-v-sor-wp", bc_sor_wp, "SOR", "9821", "Weekly Play"
    )
    db.commit()

    return {
        "ash_standard": {"id": ash_standard, "uuid": "bl185-v-ash"},
        "ts26_standard": {"id": ts26_standard, "uuid": "bl185-v-ts26"},
        "sorpr_promo": {"id": sorpr_promo, "uuid": "bl185-v-sorpr-promo"},
        "sorpr_judge": {"id": sorpr_judge, "uuid": "bl185-v-sorpr-judge"},
        "sor_std": {"id": sor_std, "uuid": "bl185-v-sor-std"},
        "sor_foil": {"id": sor_foil, "uuid": "bl185-v-sor-foil"},
        "sec_uuids": ["bl185-v-sec-c1", "bl185-v-sec-c2", "bl185-v-sec-c3"],
        "sec_ids": [sec_c1, sec_c2, sec_c3],
        "c25_convention": {"id": c25_convention, "uuid": "bl185-v-c25"},
        "gg_token": {"id": gg_token, "uuid": "bl185-v-gg"},
        "showcase": {"id": showcase, "uuid": "bl185-v-showcase"},
        "ash_token": {"id": ash_token, "uuid": "bl185-v-ash-token"},
        "sor_wp_interloper": {"id": sor_wp_interloper, "uuid": "bl185-v-sor-wp"},
    }


def _swudb_csv(header: str, rows: list[str]) -> str:
    """SWUDB's own export/import CSV never carries a meta line."""
    return "\n".join([header, *rows]) + "\n"


# ---------------------------------------------------------------------------
# BL-186: sw-unlimited-db (XLSX) import adapter fixture catalog. Base-card-
# first resolution needs container/promo source_set_codes that live on a
# base card whose OWN identity is a DIFFERENT (set, number) -- unlike
# bl185_catalog (whose promo/container rows are entirely synthetic set
# codes with no FK to satisfy), card_variants.source_set_code is an actual
# FK to sets.code, so the container codes exercised here (SORP, LAWP, P25)
# need their own `sets` rows first, same as bl185_catalog's ASH/TS26/C25/GG
# inserts. High, unclaimed card_numbers (98xx), same dodge-every-other-
# fixture convention as bl54s2_catalog/bl185_catalog.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def bl186_catalog(db):
    """
    - multi (SOR, "9841"): Standard + Standard Foil + Hyperspace -- the
      multi-column melt fixture (one spreadsheet row, several positive
      quantity columns) and the compute_import trim/ceiling integration
      case. Also the base card Event Exclusive's "even with a plausible
      candidate" test uses (Standard exists, still unmapped_column).
    - prerelease_proof (SOR, "9836"): Standard + a Prerelease Promo variant
      living at a COMPLETELY different own (source_set_code, card_number)
      -- (P25, "9736") -- the base-card-first proof case (§10 owner
      finding): resolution must find it via base_card_id, not via any
      (set, number) pair derived from the row's own identity.
    - prerelease_pair (SOR, "9837"): Prerelease Promo + Prerelease Judge,
      same (source_set_code, card_number) -- exact-match preference over
      ambiguity.
    - wp_home (LAW, "9838"): two "Weekly Play" variants, one source_set_code
      LAW (home), one LAWP (container) -- home-set preference.
    - wp_early (SOR, "9839"): Standard + a "Hyperspace"-typed variant living
      in the SORP container -- the early-era root-coded Weekly Play case
      (BL-183), resolved via the source_set_code leg of the family
      predicate rather than variant_type.
    - serialized (SEC, "9840"): three "Serialized Prestige" variants, same
      triple -- irreducibly ambiguous (mirrors bl185_catalog's SEC family).
    - tokencollide real/token pair (LAW, "9842"): a real base card AND an
      is_token base card sharing one bare (set, number) -- BL-199's token-
      routing shape: the raw id's T- prefix (T9842 vs 9842) is the row's
      only token signal, and each side must resolve only among its own
      kind (the real LAW 1 Saw-Gerrera/Credit-token collision).
    """
    for code, name in (("SORP", "SOR Weekly Play"), ("LAWP", "LAW Weekly Play")):
        db.execute(
            text(
                "INSERT INTO sets (code, name, is_base_set) "
                "VALUES (:code, :name, false) ON CONFLICT (code) DO NOTHING"
            ),
            {"code": code, "name": name},
        )
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) "
            "VALUES ('P25', 'Prerelease 2025', false) ON CONFLICT (code) DO NOTHING"
        )
    )
    db.commit()

    def _upsert_base_card(swuapi_id, set_code, number, name, is_token=False):
        set_id = db.execute(
            text("SELECT id FROM sets WHERE code = :code"), {"code": set_code}
        ).scalar()
        row = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id, is_token) "
                "VALUES (:set_id, :number, :name, 'Unit', 'Common', :swuapi_id, "
                ":is_token) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name, "
                "base_card_number = EXCLUDED.base_card_number "
                "RETURNING id"
            ),
            {
                "set_id": set_id,
                "number": number,
                "name": name,
                "swuapi_id": swuapi_id,
                "is_token": is_token,
            },
        ).first()
        return row.id

    def _upsert_variant(swuapi_id, base_card_id, set_code, card_number, variant_type):
        row = db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_card_id, :variant_type, :set_code, :card_number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET card_number = EXCLUDED.card_number "
                "RETURNING id"
            ),
            {
                "base_card_id": base_card_id,
                "variant_type": variant_type,
                "set_code": set_code,
                "card_number": card_number,
                "swuapi_id": swuapi_id,
            },
        ).first()
        return row.id

    bc_multi = _upsert_base_card(
        "bl186-bc-multi", "SOR", "9841", "BL186 Multi Melt Hero"
    )
    bc_prerelease_proof = _upsert_base_card(
        "bl186-bc-prerelease-proof", "SOR", "9836", "BL186 Prerelease Proof Hero"
    )
    bc_prerelease_pair = _upsert_base_card(
        "bl186-bc-prerelease-pair", "SOR", "9837", "BL186 Prerelease Pair Hero"
    )
    bc_wp_home = _upsert_base_card(
        "bl186-bc-wp-home", "LAW", "9838", "BL186 WP Home Hero"
    )
    bc_wp_early = _upsert_base_card(
        "bl186-bc-wp-early", "SOR", "9839", "BL186 WP Early Hero"
    )
    bc_serialized = _upsert_base_card(
        "bl186-bc-serialized", "SEC", "9840", "BL186 Serialized Hero"
    )

    multi_standard = _upsert_variant(
        "bl186-v-multi-standard", bc_multi, "SOR", "9841", "Standard"
    )
    multi_foil = _upsert_variant(
        "bl186-v-multi-foil", bc_multi, "SOR", "9841", "Standard Foil"
    )
    multi_hyperspace = _upsert_variant(
        "bl186-v-multi-hyperspace", bc_multi, "SOR", "9841", "Hyperspace"
    )
    _upsert_variant(
        "bl186-v-prerelease-proof-standard",
        bc_prerelease_proof,
        "SOR",
        "9836",
        "Standard",
    )
    prerelease_proof_promo = _upsert_variant(
        "bl186-v-prerelease-proof-promo",
        bc_prerelease_proof,
        "P25",
        "9736",
        "Prerelease Promo",
    )
    prerelease_pair_promo = _upsert_variant(
        "bl186-v-prerelease-pair-promo",
        bc_prerelease_pair,
        "SOR",
        "9837",
        "Prerelease Promo",
    )
    _upsert_variant(
        "bl186-v-prerelease-pair-judge",
        bc_prerelease_pair,
        "SOR",
        "9837",
        "Prerelease Judge",
    )
    wp_home_home = _upsert_variant(
        "bl186-v-wp-home-home", bc_wp_home, "LAW", "9838", "Weekly Play"
    )
    _upsert_variant("bl186-v-wp-home-other", bc_wp_home, "LAWP", "9838", "Weekly Play")
    _upsert_variant("bl186-v-wp-early-standard", bc_wp_early, "SOR", "9839", "Standard")
    wp_early_container = _upsert_variant(
        "bl186-v-wp-early-container", bc_wp_early, "SORP", "9839", "Hyperspace"
    )
    serialized_c1 = _upsert_variant(
        "bl186-v-serialized-c1", bc_serialized, "SEC", "9840", "Serialized Prestige"
    )
    _upsert_variant(
        "bl186-v-serialized-c2", bc_serialized, "SEC", "9840", "Serialized Prestige"
    )
    _upsert_variant(
        "bl186-v-serialized-c3", bc_serialized, "SEC", "9840", "Serialized Prestige"
    )
    bc_tokencollide_real = _upsert_base_card(
        "bl186-bc-tokencollide-real", "LAW", "9842", "BL186 Real At Shared Number"
    )
    tokencollide_real = _upsert_variant(
        "bl186-v-tokencollide-real", bc_tokencollide_real, "LAW", "9842", "Standard"
    )
    bc_tokencollide_token = _upsert_base_card(
        "bl186-bc-tokencollide-token",
        "LAW",
        "9842",
        "BL186 Token At Shared Number",
        is_token=True,
    )
    tokencollide_token = _upsert_variant(
        "bl186-v-tokencollide-token", bc_tokencollide_token, "LAW", "9842", "Standard"
    )
    db.commit()

    return {
        "multi_standard": {"id": multi_standard, "uuid": "bl186-v-multi-standard"},
        "multi_foil": {"id": multi_foil, "uuid": "bl186-v-multi-foil"},
        "multi_hyperspace": {
            "id": multi_hyperspace,
            "uuid": "bl186-v-multi-hyperspace",
        },
        "prerelease_proof_promo": {
            "id": prerelease_proof_promo,
            "uuid": "bl186-v-prerelease-proof-promo",
        },
        "prerelease_pair_promo": {
            "id": prerelease_pair_promo,
            "uuid": "bl186-v-prerelease-pair-promo",
        },
        "wp_home_home": {"id": wp_home_home, "uuid": "bl186-v-wp-home-home"},
        "wp_early_container": {
            "id": wp_early_container,
            "uuid": "bl186-v-wp-early-container",
        },
        "serialized_uuids": [
            "bl186-v-serialized-c1",
            "bl186-v-serialized-c2",
            "bl186-v-serialized-c3",
        ],
        "serialized_ids": [serialized_c1],
        "tokencollide_real": {
            "id": tokencollide_real,
            "uuid": "bl186-v-tokencollide-real",
        },
        "tokencollide_token": {
            "id": tokencollide_token,
            "uuid": "bl186-v-tokencollide-token",
        },
    }


def _xlsx_bytes(header: list[str], rows: list[list]) -> bytes:
    """One in-memory "Data"-sheet XLSX workbook, built via openpyxl -- the
    same construction the sw-unlimited-db export itself uses (Definition
    doc §1: "read via openpyxl")."""
    import io

    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(header)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Tenant provisioning -- every test runs under its own throwaway tenant
# (mirrors test_inventory_limits_api.py's bl24_tenant), so the many varied
# starting-quantity scenarios below (trim/ceiling/replace_all/partial
# commit/...) can never pollute each other.
# ---------------------------------------------------------------------------


def _create_tenant_rows(db) -> tuple[int, str, str]:
    suffix = uuid.uuid4().hex[:12]
    uid = f"test-bl54s2-{suffix}"
    email = f"bl54s2-{suffix}@example.com"
    tenant_id = db.execute(
        text("INSERT INTO tenants (name) VALUES (:name) RETURNING id"),
        {"name": f"BL-54 S2 Test Tenant {suffix}"},
    ).scalar()
    db.execute(
        text(
            "INSERT INTO users (firebase_uid, tenant_id, email) "
            "VALUES (:uid, :tenant_id, :email)"
        ),
        {"uid": uid, "tenant_id": tenant_id, "email": email},
    )
    db.commit()
    return tenant_id, uid, email


def _teardown_tenant(db, tenant_id: int, uid: str) -> None:
    db.rollback()
    db.execute(text("DELETE FROM inventory WHERE tenant_id = :t"), {"t": tenant_id})
    db.execute(
        text("DELETE FROM tenant_card_limits WHERE tenant_id = :t"), {"t": tenant_id}
    )
    db.execute(
        text("DELETE FROM tenant_settings WHERE tenant_id = :t"), {"t": tenant_id}
    )
    db.execute(text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid})
    db.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant_id})
    db.commit()


@pytest.fixture
def bl54s2_tenant(db, make_client):
    tenant_id, uid, email = _create_tenant_rows(db)
    client = make_client(uid, email, True)
    try:
        yield client, tenant_id
    finally:
        _teardown_tenant(db, tenant_id, uid)


def _set_quantity(db, tenant_id: int, variant_id: int, quantity: int) -> None:
    db.execute(
        text(
            "INSERT INTO inventory (tenant_id, variant_id, quantity) "
            "VALUES (:tenant_id, :variant_id, :quantity) "
            "ON CONFLICT (tenant_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity"
        ),
        {"tenant_id": tenant_id, "variant_id": variant_id, "quantity": quantity},
    )
    db.commit()


def _get_quantity(db, tenant_id: int, variant_id: int) -> int:
    return (
        db.execute(
            text(
                "SELECT quantity FROM inventory "
                "WHERE tenant_id = :tenant_id AND variant_id = :variant_id"
            ),
            {"tenant_id": tenant_id, "variant_id": variant_id},
        ).scalar()
        or 0
    )


# ---------------------------------------------------------------------------
# Upload helpers.
# ---------------------------------------------------------------------------


def _post_import(client, *, content, filename, mode, cap_handling, stage):
    if isinstance(content, str):
        content = content.encode("utf-8")
    return client.post(
        "/api/inventory/import",
        files={"file": (filename, content)},
        data={"mode": mode, "cap_handling": cap_handling, "stage": stage},
    )


def _csv(header: str, rows: list[str], *, meta_line: bool = True) -> str:
    lines = []
    if meta_line:
        lines.append("# swu-inv-export v1")
    lines.append(header)
    lines.extend(rows)
    return "\n".join(lines) + "\n"


def _json_doc(cards: list[dict], format_version: str = "swu-inv/1") -> str:
    return json.dumps(
        {
            "format_version": format_version,
            "exported_at": "2026-07-22T00:00:00Z",
            "source": "test",
            "cards": cards,
        }
    )


def _row_by_number(report: dict, row_number: int) -> dict:
    return next(r for r in report["rows"] if r["row_number"] == row_number)


# ---------------------------------------------------------------------------
# §10 case 8: auth gates.
# ---------------------------------------------------------------------------


class TestImportAuthGates:
    def _valid_upload_kwargs(self):
        return dict(
            content=_csv("swuapi_uuid,quantity", ["bl54s2-v-a-standard,1"]),
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )

    def test_anonymous_returns_401(self):
        from fastapi.testclient import TestClient

        from app.main import app

        response = TestClient(app).post(
            "/api/inventory/import",
            files={"file": ("upload.csv", b"quantity,swuapi_uuid\n1,x\n")},
            data={"mode": "merge_add", "cap_handling": "add_above", "stage": "dry_run"},
        )
        assert response.status_code == 401

    def test_unverified_returns_403(self, make_client, db):
        from .conftest import delete_provisioned_identity

        uid = "test-bl54s2-unverified"
        unverified = make_client(uid, "bl54s2-unverified@example.com", False)
        try:
            response = _post_import(unverified, **self._valid_upload_kwargs())
            assert response.status_code == 403
            assert response.json()["detail"] == "email_not_verified"
        finally:
            delete_provisioned_identity(db, uid)

    def test_verified_returns_200(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        response = _post_import(client, **self._valid_upload_kwargs())
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# §10 case 2: foil collision -- set+number alone is never used.
# ---------------------------------------------------------------------------


class TestFoilCollision:
    def test_standard_and_standard_foil_resolve_distinctly(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        client, _ = bl54s2_tenant
        content = _csv(
            "set_code,card_number,variant_type,quantity",
            ["SOR,9712,Standard,1", "SOR,9712,Standard Foil,2"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        report = resp.json()
        row1, row2 = report["rows"][0], report["rows"][1]
        assert row1["status"] == row2["status"] == "resolved"
        assert row1["card"]["swuapi_uuid"] == bl54s2_catalog["b_standard"]["uuid"]
        assert row2["card"]["swuapi_uuid"] == bl54s2_catalog["b_foil"]["uuid"]
        assert row1["card"]["swuapi_uuid"] != row2["card"]["swuapi_uuid"]


# ---------------------------------------------------------------------------
# §10 case 3: Serialized Prestige landmine.
# ---------------------------------------------------------------------------


class TestAmbiguousTriple:
    def test_triple_only_is_ambiguous_with_three_candidates(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        client, _ = bl54s2_tenant
        content = _csv(
            "set_code,card_number,variant_type,quantity",
            ["SOR,9713,Serialized Prestige,1"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "ambiguous"
        assert row["reason"] == "ambiguous_triple"
        assert sorted(row["candidates"]) == sorted(bl54s2_catalog["c_uuids"])
        assert (
            "swuapi_uuid" not in row["card"] or row["card"].get("swuapi_uuid") is None
        )

    def test_same_triple_with_uuid_resolves(self, bl54s2_tenant, bl54s2_catalog):
        client, _ = bl54s2_tenant
        target_uuid = bl54s2_catalog["c1"]["uuid"]
        content = _csv(
            "swuapi_uuid,set_code,card_number,variant_type,quantity",
            [f"{target_uuid},SOR,9713,Serialized Prestige,1"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == target_uuid


# ---------------------------------------------------------------------------
# §10 case 4: fallback + uuid/triple mismatch.
# ---------------------------------------------------------------------------


class TestFallbackAndMismatch:
    def test_unknown_uuid_with_valid_triple_resolves_via_fallback(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        client, _ = bl54s2_tenant
        content = _csv(
            "swuapi_uuid,set_code,card_number,variant_type,quantity",
            ["garbage-unknown-uuid,SOR,9711,Standard,1"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["matched_by_fallback"] is True
        assert row["card"]["swuapi_uuid"] == bl54s2_catalog["a_standard"]["uuid"]

    def test_uuid_and_triple_pointing_at_different_variants_uuid_wins(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        client, _ = bl54s2_tenant
        a_uuid = bl54s2_catalog["a_standard"]["uuid"]
        # Triple points at card B's Standard variant -- deliberately NOT
        # where a_uuid actually resolves.
        content = _csv(
            "swuapi_uuid,set_code,card_number,variant_type,quantity",
            [f"{a_uuid},SOR,9712,Standard,1"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["uuid_triple_mismatch"] is True
        # uuid wins -- resolved identity is card A, not card B.
        assert row["card"]["swuapi_uuid"] == a_uuid


class TestIncompleteIdentity:
    def test_partial_triple_with_no_uuid_is_incomplete_identity(self, bl54s2_tenant):
        """§4 step 3: a triple missing even one of its three fields is never
        treated as resolvable -- distinct from `unknown_triple` (a complete
        triple matching zero variants)."""
        client, _ = bl54s2_tenant
        content = _csv(
            "set_code,card_number,quantity",
            ["SOR,9711,1"],  # variant_type column entirely absent
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "incomplete_identity"


# ---------------------------------------------------------------------------
# §10 cases 5/6/7: merge + cap math.
# ---------------------------------------------------------------------------


class TestMergeCapMath:
    def test_trim_clamps_to_keep_limit_and_itemizes(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        """Case 5: limit 3 (code default for standard/Standard), current 2,
        merge_add file 3, trim -> resulting 3, 2 copies not added."""
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 2)

        content = _csv("swuapi_uuid,quantity", [f"{variant['uuid']},3"])
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="trim",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["current_quantity"] == 2
        assert row["file_quantity"] == 3
        assert row["resulting_quantity"] == 3
        assert row["copies_not_added"] == 2
        assert row["trim_reason"] == "keep_limit"

    def test_add_above_bypasses_keep_limit(self, db, bl54s2_tenant, bl54s2_catalog):
        """Case 5, add_above half: same setup, resulting 5 (uncapped)."""
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 2)

        content = _csv("swuapi_uuid,quantity", [f"{variant['uuid']},3"])
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["resulting_quantity"] == 5
        assert row["copies_not_added"] == 0
        assert row.get("trim_reason") is None

    def test_trim_never_cuts_owned_stock(self, db, bl54s2_tenant, bl54s2_catalog):
        """Case 6: limit 3, current 5 (already above limit), merge_add file
        2, trim -> resulting stays 5, added 0, row itemized."""
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 5)

        content = _csv("swuapi_uuid,quantity", [f"{variant['uuid']},2"])
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="trim",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["current_quantity"] == 5
        assert row["resulting_quantity"] == 5
        assert row["copies_not_added"] == 2
        assert row["trim_reason"] == "keep_limit"

    def test_replace_mode_trim_ignores_current_entirely(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        """§5: replace/replace_all's target is `file` alone (never
        `current + file`) -- trim clamps the file value straight to the
        limit, regardless of what `current` was."""
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 2)

        content = _csv("swuapi_uuid,quantity", [f"{variant['uuid']},10"])
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="replace",
            cap_handling="trim",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["current_quantity"] == 2
        assert row["file_quantity"] == 10
        assert row["resulting_quantity"] == 3  # min(file=10, limit=3)
        assert row["copies_not_added"] == 7  # 10 - 3, not 2-relative
        assert row["trim_reason"] == "keep_limit"

    def test_ceiling_applies_in_both_cap_modes(self, db, bl54s2_tenant, bl54s2_catalog):
        """Case 7: an explicitly unlimited bucket, file quantity 1500 ->
        999 in both cap_handling values, trim_reason "ceiling"."""
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 0)

        put_resp = client.put(
            "/api/settings/limits",
            json={
                "limits": [
                    {
                        "type_category": "standard",
                        "limit_bucket": "Standard",
                        "max_quantity": None,
                    }
                ]
            },
        )
        assert put_resp.status_code == 200

        content = _csv("swuapi_uuid,quantity", [f"{variant['uuid']},1500"])
        for cap_handling in ("trim", "add_above"):
            resp = _post_import(
                client,
                content=content,
                filename="upload.csv",
                mode="merge_add",
                cap_handling=cap_handling,
                stage="dry_run",
            )
            assert resp.status_code == 200
            row = resp.json()["rows"][0]
            assert row["resulting_quantity"] == 999, cap_handling
            assert row["trim_reason"] == "ceiling", cap_handling
            assert row["copies_not_added"] == 1500 - 999, cap_handling


# ---------------------------------------------------------------------------
# §10 case 9: upload limits.
# ---------------------------------------------------------------------------


class TestUploadLimits:
    def test_file_too_large_returns_422(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        oversized = b"x" * (10 * 1024 * 1024 + 1)
        resp = _post_import(
            client,
            content=oversized,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "file_too_large"

    def test_too_many_rows_returns_422(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        header = "quantity,set_code,card_number,variant_type"
        rows = [f"1,SOR,{n},Standard" for n in range(20_001)]
        content = _csv(header, rows)
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "too_many_rows"

    def test_too_many_rows_returns_422_for_json_too(self, bl54s2_tenant):
        """The row-count gate applies to JSON uploads too, not just CSV --
        counted off the `cards` array length before the real parse builds
        one ParsedRow per card."""
        client, _ = bl54s2_tenant
        cards = [{"swuapi_uuid": f"garbage-{n}", "quantity": 1} for n in range(20_001)]
        resp = _post_import(
            client,
            content=_json_doc(cards),
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "too_many_rows"


class TestFormatDetection:
    """The endpoint has no explicit `format` field (unlike export's ?format=
    query param) -- §8.2's file picker accepts .json/.csv, and the router
    trusts the filename extension, sniffing content only as a fallback."""

    def test_content_sniffing_without_a_recognized_extension(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        client, _ = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        content = _json_doc([{"swuapi_uuid": variant["uuid"], "quantity": 2}])
        resp = _post_import(
            client,
            content=content,
            filename="upload",  # no .json/.csv extension at all
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["file_quantity"] == 2


# ---------------------------------------------------------------------------
# §10 case 10: version refusal.
# ---------------------------------------------------------------------------


class TestVersionRefusal:
    def test_unsupported_format_version_returns_422_and_parses_nothing(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 1)

        content = _json_doc(
            [{"swuapi_uuid": variant["uuid"], "quantity": 5}],
            format_version="swu-inv/2",
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="commit",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "unsupported_format_version"
        # Nothing best-effort parsed/applied -- quantity untouched.
        assert _get_quantity(db, tenant_id, variant["id"]) == 1


class TestInvalidUtf8Upload:
    """Review fix (PR #390): a binary/non-UTF-8 upload must get the same
    422 unparseable_file as any other unreadable file -- inventory_io's
    _decode wraps UnicodeDecodeError in UnparseableFileError, so the
    router's existing except clause catches it (previously it leaked as an
    unhandled 500 on a user-input path)."""

    INVALID_UTF8 = b"\x89BIN\x00\xff\xfe not utf-8 \x80\x81"

    def test_invalid_utf8_csv_returns_422(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        resp = _post_import(
            client,
            content=self.INVALID_UTF8,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "unparseable_file"

    def test_invalid_utf8_json_returns_422(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        resp = _post_import(
            client,
            content=self.INVALID_UTF8,
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "unparseable_file"


# ---------------------------------------------------------------------------
# §10 case 11: unknown column.
# ---------------------------------------------------------------------------


class TestUnknownColumn:
    def test_extra_column_imports_fine_and_is_reported(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        client, _ = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        content = _csv(
            "swuapi_uuid,quantity,condition",
            [f"{variant['uuid']},2,Near Mint"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["rows"][0]["status"] == "resolved"
        assert "condition" in report["totals"]["unrecognized_columns"]


class TestDuplicateRowsMerged:
    def test_duplicate_identity_summed_and_reported(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        variant = bl54s2_catalog["a_standard"]
        client, _ = bl54s2_tenant
        content = _csv(
            "swuapi_uuid,quantity",
            [f"{variant['uuid']},2", f"{variant['uuid']},3"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["totals"]["duplicate_rows_merged"] == 1
        assert report["totals"]["rows"] == 1
        assert report["rows"][0]["file_quantity"] == 5


class TestCrossSchemeDuplicateFold:
    """Review fix (PR #390): the same card carried once by uuid and once by
    triple is invisible to inventory_io's §3.4 raw-identity pass (different
    schemes, different raw keys) but both rows resolve to the SAME
    variant_id. The post-resolution fold in inventory_import must sum them
    into the first row -- one report row whose numbers match the actual
    write (§7.3 "preview shows exact outcomes"), instead of two report rows
    with a last-write-wins plan."""

    def _content(self):
        # Row 1 identifies card A by uuid; row 2 identifies the SAME
        # variant by its full triple -- no raw key in common.
        return _csv(
            "swuapi_uuid,set_code,card_number,variant_type,quantity",
            ["bl54s2-v-a-standard,,,,2", ",SOR,9711,Standard,3"],
        )

    def test_merge_add_folds_to_one_row_and_write_matches_report(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 1)

        resp = _post_import(
            client,
            content=self._content(),
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="commit",
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["totals"]["rows"] == 1
        assert report["totals"]["resolved"] == 1
        assert report["totals"]["duplicate_rows_merged"] == 1
        assert len(report["rows"]) == 1
        row = report["rows"][0]
        assert row["row_number"] == 1  # first row's number survives
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == variant["uuid"]
        assert row["file_quantity"] == 5  # 2 + 3, summed
        assert row["current_quantity"] == 1
        assert row["resulting_quantity"] == 6
        # The write matches the report row exactly -- not a last-write-wins
        # 1 + 3 = 4.
        assert _get_quantity(db, tenant_id, variant["id"]) == 6

    def test_replace_folds_before_file_wins_math(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        _set_quantity(db, tenant_id, variant["id"], 4)

        resp = _post_import(
            client,
            content=self._content(),
            filename="upload.csv",
            mode="replace",
            cap_handling="add_above",
            stage="commit",
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["totals"]["rows"] == 1
        assert report["totals"]["duplicate_rows_merged"] == 1
        assert len(report["rows"]) == 1
        row = report["rows"][0]
        assert row["file_quantity"] == 5
        assert row["resulting_quantity"] == 5  # file wins with the SUMMED file value
        # Not the bare last row's 3 (the pre-fix last-write-wins outcome).
        assert _get_quantity(db, tenant_id, variant["id"]) == 5


# ---------------------------------------------------------------------------
# §10 case 12: replace_all preview completeness.
# ---------------------------------------------------------------------------


class TestReplaceAllPreview:
    def test_removals_itemized_in_dry_run_before_any_commit(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        client, tenant_id = bl54s2_tenant
        a = bl54s2_catalog["a_standard"]
        b = bl54s2_catalog["b_standard"]
        _set_quantity(db, tenant_id, a["id"], 4)
        _set_quantity(db, tenant_id, b["id"], 1)

        # File mentions only card A -- card B is absent, so replace_all
        # would remove it.
        content = _csv("swuapi_uuid,quantity", [f"{a['uuid']},4"])
        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="replace_all",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["committed"] is False
        assert report["totals"]["removed_by_replace_all"] == 1
        assert len(report["removed"]) == 1
        assert report["removed"][0]["card"]["swuapi_uuid"] == b["uuid"]
        assert report["removed"][0]["quantity"] == 1

        # dry_run must not have written anything.
        assert _get_quantity(db, tenant_id, b["id"]) == 1
        assert _get_quantity(db, tenant_id, a["id"]) == 4


# ---------------------------------------------------------------------------
# §10 case 13: partial commit.
# ---------------------------------------------------------------------------


class TestPartialCommit:
    def test_good_rows_commit_bad_rows_reported_and_never_written(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        client, tenant_id = bl54s2_tenant
        a = bl54s2_catalog["a_standard"]
        b = bl54s2_catalog["b_standard"]

        header = "swuapi_uuid,set_code,card_number,variant_type,quantity"
        rows = [
            f"{a['uuid']},,,,3",  # good: row 1, resolved by uuid
            f"{b['uuid']},,,,2",  # good: row 2, resolved by uuid
            ",SOR,9999,Standard,abc",  # bad: row 3, malformed quantity
            ",SOR,9999,NoSuchVariant,1",  # bad: row 4, unknown_triple
        ]
        content = _csv(header, rows)

        resp = _post_import(
            client,
            content=content,
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="commit",
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["committed"] is True
        assert report["totals"]["resolved"] == 2
        assert report["totals"]["unresolved"] == 2

        bad_rows = [r for r in report["rows"] if r["status"] == "unresolved"]
        reasons = {r["reason"] for r in bad_rows}
        assert reasons == {"malformed_row", "unknown_triple"}

        assert _get_quantity(db, tenant_id, a["id"]) == 3
        assert _get_quantity(db, tenant_id, b["id"]) == 2


# ---------------------------------------------------------------------------
# §10 case 1: round-trip idempotency (export -> import replace_all).
# ---------------------------------------------------------------------------


class TestRoundTrip:
    def test_export_then_replace_all_dry_run_shows_zero_net_change(
        self, db, bl54s2_tenant, bl54s2_catalog
    ):
        client, tenant_id = bl54s2_tenant
        a = bl54s2_catalog["a_standard"]
        b = bl54s2_catalog["b_standard"]
        f = bl54s2_catalog["b_foil"]
        _set_quantity(db, tenant_id, a["id"], 2)
        _set_quantity(db, tenant_id, b["id"], 1)
        _set_quantity(db, tenant_id, f["id"], 3)

        export_resp = client.get("/api/inventory/export?format=json")
        assert export_resp.status_code == 200

        resp = client.post(
            "/api/inventory/import",
            files={"file": ("export.json", export_resp.content)},
            data={
                "mode": "replace_all",
                "cap_handling": "add_above",
                "stage": "dry_run",
            },
        )
        assert resp.status_code == 200
        report = resp.json()
        assert report["totals"]["removed_by_replace_all"] == 0
        for row in report["rows"]:
            assert row["status"] == "resolved"
            assert row["resulting_quantity"] == row["current_quantity"]


# ---------------------------------------------------------------------------
# RLS / tenant isolation.
# ---------------------------------------------------------------------------


class TestTenantIsolation:
    def test_commit_only_touches_the_caller_tenant(
        self, db, make_client, bl54s2_catalog
    ):
        tenant_a, uid_a, email_a = _create_tenant_rows(db)
        tenant_b, uid_b, email_b = _create_tenant_rows(db)
        variant = bl54s2_catalog["a_standard"]
        try:
            client_a = make_client(uid_a, email_a)
            resp = _post_import(
                client_a,
                content=_csv("swuapi_uuid,quantity", [f"{variant['uuid']},7"]),
                filename="upload.csv",
                mode="merge_add",
                cap_handling="add_above",
                stage="commit",
            )
            assert resp.status_code == 200
            assert _get_quantity(db, tenant_a, variant["id"]) == 7
            assert _get_quantity(db, tenant_b, variant["id"]) == 0

            client_b = make_client(uid_b, email_b)
            quantities_b = {
                row["variant_id"]: row["quantity"]
                for row in client_b.get("/api/inventory/quantities").json()
            }
            assert quantities_b.get(variant["id"], 0) == 0
        finally:
            _teardown_tenant(db, tenant_a, uid_a)
            _teardown_tenant(db, tenant_b, uid_b)

    def test_replace_all_removal_preview_is_tenant_scoped(
        self, db, make_client, bl54s2_catalog
    ):
        tenant_a, uid_a, email_a = _create_tenant_rows(db)
        tenant_b, uid_b, email_b = _create_tenant_rows(db)
        variant = bl54s2_catalog["a_standard"]
        try:
            _set_quantity(db, tenant_a, variant["id"], 5)

            client_b = make_client(uid_b, email_b)
            resp = _post_import(
                client_b,
                content=_csv("swuapi_uuid,quantity", []),
                filename="upload.csv",
                mode="replace_all",
                cap_handling="add_above",
                stage="dry_run",
            )
            assert resp.status_code == 200
            report = resp.json()
            # Tenant B owns nothing -- tenant A's row must never surface as
            # a removal candidate on tenant B's preview.
            assert report["totals"]["removed_by_replace_all"] == 0
            assert report["removed"] == []
        finally:
            _teardown_tenant(db, tenant_a, uid_a)
            _teardown_tenant(db, tenant_b, uid_b)


# ---------------------------------------------------------------------------
# Transactionality: an induced mid-commit failure leaves inventory
# unchanged.
# ---------------------------------------------------------------------------


class TestTransactionality:
    def test_induced_failure_mid_commit_leaves_inventory_unchanged(
        self, db, bl54s2_tenant, bl54s2_catalog, monkeypatch
    ):
        client, tenant_id = bl54s2_tenant
        a = bl54s2_catalog["a_standard"]
        b = bl54s2_catalog["b_standard"]
        _set_quantity(db, tenant_id, a["id"], 1)
        _set_quantity(db, tenant_id, b["id"], 1)

        from app.repositories import inventory_import as inventory_import_repo

        def _apply_first_row_then_explode(db_session, plan):
            # Simulate a partial write within the same (uncommitted)
            # request transaction, then blow up before the router's single
            # db.commit() -- the whole transaction must roll back, so even
            # this "successful" partial write must never persist.
            first_variant_id, first_quantity = next(iter(plan.updates.items()))
            inventory_import_repo.apply_quantities(
                db_session, {first_variant_id: first_quantity}
            )
            raise RuntimeError("induced failure for BL-54 S2 transactionality test")

        monkeypatch.setattr(
            "app.services.inventory_import.apply_write_plan",
            _apply_first_row_then_explode,
        )

        content = _csv(
            "swuapi_uuid,quantity",
            [f"{a['uuid']},9", f"{b['uuid']},9"],
        )
        with pytest.raises(RuntimeError):
            _post_import(
                client,
                content=content,
                filename="upload.csv",
                mode="merge_add",
                cap_handling="add_above",
                stage="commit",
            )

        # Neither row changed -- the partial write inside the induced
        # failure never committed, since get_db's session closes without
        # committing on an unhandled exception.
        assert _get_quantity(db, tenant_id, a["id"]) == 1


# ---------------------------------------------------------------------------
# BL-53 (revised scope, A4-13/A4-04): per-tenant rate limit.
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_limit_trips_after_max_calls_and_carries_retry_after(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        from app.routers.inventory import IMPORT_RATE_LIMIT_CALLS

        client, _ = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        content = _json_doc([{"swuapi_uuid": variant["uuid"], "quantity": 1}])

        for _ in range(IMPORT_RATE_LIMIT_CALLS):
            resp = _post_import(
                client,
                content=content,
                filename="upload.json",
                mode="merge_add",
                cap_handling="add_above",
                stage="dry_run",
            )
            assert resp.status_code == 200

        limited = _post_import(
            client,
            content=content,
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert limited.status_code == 429
        assert limited.json()["detail"]["error"] == "rate_limited"
        retry_after = int(limited.headers["Retry-After"])
        assert retry_after > 0

    def test_rate_limit_is_scoped_per_tenant(self, db, make_client, bl54s2_catalog):
        """Tenant A exhausting the import budget must never limit tenant
        B -- check_tenant_rate_limit keys on request.state.tenant_id, never
        on anything shared across tenants.

        make_client(...) overrides get_current_identity on the shared
        `app` object -- the override is live at CALL time, not at the
        TestClient's construction time, so a second make_client() call
        would silently re-point an already-built client's identity too.
        Tenant A's client is therefore fully exhausted (built AND used)
        before tenant B's client is even constructed, never interleaved.
        """
        from app.routers.inventory import IMPORT_RATE_LIMIT_CALLS

        tenant_a_id, uid_a, email_a = _create_tenant_rows(db)
        tenant_b_id, uid_b, email_b = _create_tenant_rows(db)
        try:
            variant = bl54s2_catalog["a_standard"]
            content = _json_doc([{"swuapi_uuid": variant["uuid"], "quantity": 1}])

            client_a = make_client(uid_a, email_a, True)
            for _ in range(IMPORT_RATE_LIMIT_CALLS):
                resp = _post_import(
                    client_a,
                    content=content,
                    filename="upload.json",
                    mode="merge_add",
                    cap_handling="add_above",
                    stage="dry_run",
                )
                assert resp.status_code == 200

            exhausted = _post_import(
                client_a,
                content=content,
                filename="upload.json",
                mode="merge_add",
                cap_handling="add_above",
                stage="dry_run",
            )
            assert exhausted.status_code == 429

            client_b = make_client(uid_b, email_b, True)
            still_fine = _post_import(
                client_b,
                content=content,
                filename="upload.json",
                mode="merge_add",
                cap_handling="add_above",
                stage="dry_run",
            )
            assert still_fine.status_code == 200
        finally:
            _teardown_tenant(db, tenant_a_id, uid_a)
            _teardown_tenant(db, tenant_b_id, uid_b)


# ---------------------------------------------------------------------------
# BL-53/A4-03: single-parse regression (the JSON body used to be
# json.loads-ed twice per request).
# ---------------------------------------------------------------------------


class TestSingleParse:
    def test_json_upload_calls_json_loads_exactly_once(
        self, bl54s2_tenant, bl54s2_catalog, monkeypatch
    ):
        from app.services import inventory_io as inventory_io_module

        call_count = {"n": 0}
        original_loads = inventory_io_module.json.loads

        def _counting_loads(*args, **kwargs):
            call_count["n"] += 1
            return original_loads(*args, **kwargs)

        monkeypatch.setattr(inventory_io_module.json, "loads", _counting_loads)

        client, _ = bl54s2_tenant
        variant = bl54s2_catalog["a_standard"]
        content = _json_doc([{"swuapi_uuid": variant["uuid"], "quantity": 2}])
        resp = _post_import(
            client,
            content=content,
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        assert call_count["n"] == 1


# ---------------------------------------------------------------------------
# BL-185: SWUDB.com collection-export import adapter -- DB-backed resolution
# and end-to-end POST /api/inventory/import coverage. Pure-logic unit tests
# (set-code table, normalization, foil/stamp disambiguation, format
# detection) live in test_swudb_import.py; this section is what needs a
# real card_variants catalog (bl185_catalog above).
# ---------------------------------------------------------------------------


class TestSwudbZeroPadding:
    def test_padded_ash_number_normalizes(self, bl54s2_tenant, bl185_catalog):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["ASH,09826,2,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["ash_standard"]["uuid"]
        assert row["file_quantity"] == 2

    def test_padded_ts26_number_normalizes(self, bl54s2_tenant, bl185_catalog):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["TS26,09827,1,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["ts26_standard"]["uuid"]


class TestSwudbSorprPair:
    """§3.3/§4: SOR_1's Prerelease Promo/Prerelease Judge pair, separated
    ONLY by Stamp -- the synthetic SORPR set code maps to SOR, and blank vs
    "Judge" Stamp is the sole disambiguator."""

    def test_blank_and_judge_stamp_resolve_distinctly(
        self, bl54s2_tenant, bl185_catalog
    ):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp",
            ["SORPR,9820,1,True,", "SORPR,9820,1,True,Judge"],
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        rows = resp.json()["rows"]
        promo_row = next(r for r in rows if r["row_number"] == 1)
        judge_row = next(r for r in rows if r["row_number"] == 2)
        assert promo_row["status"] == judge_row["status"] == "resolved"
        assert promo_row["card"]["swuapi_uuid"] == bl185_catalog["sorpr_promo"]["uuid"]
        assert judge_row["card"]["swuapi_uuid"] == bl185_catalog["sorpr_judge"]["uuid"]


class TestSwudbFoilTiebreak:
    """SOR,9821 Standard/Standard Foil pair -- IsFoil is the only signal
    separating them (mirrors the real SOR_193/SOR_237 collision shape)."""

    def test_is_foil_false_resolves_standard(self, bl54s2_tenant, bl185_catalog):
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["SOR,9821,1,False,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["card"]["swuapi_uuid"] == bl185_catalog["sor_std"]["uuid"]
        assert row.get("uuid_triple_mismatch") is not True

    def test_is_foil_true_resolves_standard_foil(self, bl54s2_tenant, bl185_catalog):
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["SOR,9821,1,True,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["card"]["swuapi_uuid"] == bl185_catalog["sor_foil"]["uuid"]


class TestSwudbTokenExclusion:
    """BL-199: tokens are numbered run-locally INSIDE base sets (the real
    ASH 1 is both The Armorer and the Mandalorian token), and a SWUDB row's
    plain CardNumber always means the real card -- the token at the same
    (set, number) must never enter the candidate family (excluded at the
    repo query, get_variants_by_set_and_number)."""

    def test_bare_number_resolves_the_real_card_not_the_token(
        self, bl54s2_tenant, bl185_catalog
    ):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["ASH,09826,2,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["ash_standard"]["uuid"]
        assert row["card"]["swuapi_uuid"] != bl185_catalog["ash_token"]["uuid"]


class TestSwudbMainSetTier:
    """BL-199 step (c): a promo-run printing of a DIFFERENT base card
    sharing the row's number (run-local promo numbering under the base
    set -- the real SOR 1 Krennic/Weekly-Play-Marine shape) must not
    ambiguate a plain main-set row."""

    def test_promo_run_interloper_does_not_ambiguate_the_main_set_row(
        self, bl54s2_tenant, bl185_catalog
    ):
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["SOR,9821,1,False,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["sor_std"]["uuid"]

    def test_stamped_row_still_reaches_the_promo_printing(
        self, bl54s2_tenant, bl185_catalog
    ):
        """The tier must not steal rows that DO carry a promo signal -- a
        Weekly Play stamp (unrecognized-keyword substring fallback) still
        resolves the interloper, never the main-set card."""
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["SOR,9821,1,False,Weekly Play"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["sor_wp_interloper"]["uuid"]


class TestSwudbConfirmatoryMismatch:
    def test_is_foil_mismatch_against_sole_candidate_is_a_soft_warning(
        self, bl54s2_tenant, bl185_catalog
    ):
        """The ASH fixture's sole candidate is plain Standard -- IsFoil=True
        disagrees, but the row still resolves (§6 step 3 / §7): a soft
        warning, never a failure."""
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["ASH,09826,1,True,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["ash_standard"]["uuid"]
        assert row["uuid_triple_mismatch"] is True

    def test_showcase_with_is_foil_true_is_not_a_mismatch(
        self, bl54s2_tenant, bl185_catalog
    ):
        """§7 locked decision (5): Showcase is always foil as a domain
        fact -- IsFoil=True on a Showcase candidate agrees, it doesn't
        warn."""
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["SOR,9825,1,True,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["showcase"]["uuid"]
        assert row.get("uuid_triple_mismatch") is not True


class TestSwudbAmbiguous:
    def test_serialized_prestige_trio_is_ambiguous_with_all_candidates(
        self, bl54s2_tenant, bl185_catalog
    ):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["SEC,9822,1,True,Serialized"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "ambiguous"
        assert row["reason"] == "ambiguous_triple"
        assert sorted(row["candidates"]) == sorted(bl185_catalog["sec_uuids"])


class TestSwudbRenames:
    def test_ce25_renames_to_c25(self, bl54s2_tenant, bl185_catalog):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["CE25,9823,1,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["c25_convention"]["uuid"]

    def test_ggts_renames_to_gg(self, bl54s2_tenant, bl185_catalog):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["GGTS,9824,1,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["gg_token"]["uuid"]


class TestSwudbUnmappedAndUnknown:
    def test_gc23_is_unmapped_set(self, bl54s2_tenant):
        """BL-186 REPLACE (disposition log): was
        test_gc23_is_unmapped_swudb_set, asserting reason ==
        "unmapped_swudb_set". BL-186 renamed the reason code
        "unmapped_swudb_set" -> "unmapped_set" (format-agnostic, now
        shared with the sw-unlimited-db adapter's identical failure mode)
        -- the behavior this test proves (an unmapped SWUDB Set code is
        refused, never guessed) is unchanged, only the wire string is
        different, so the old assertion is superseded rather than ported
        verbatim."""
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["GC23,2,1,False,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "unmapped_set"
        assert row["card"]["set_code"] == "GC23"

    def test_unknown_number_in_a_mapped_set_is_unknown_set_and_number(
        self, bl54s2_tenant, bl185_catalog
    ):
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil,Stamp", ["SOR,9899,1,False,"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "unknown_set_and_number"


class TestSwudbDirectParseRefusals:
    """parse_swudb_csv's own header/emptiness checks -- belt-and-suspenders
    against the router's _detect_import_format gate (which already
    guarantees a swudb-shaped header before dispatching here), exercised
    directly the same way test_inventory_io.py unit-tests parse_csv/
    parse_json's refusal paths rather than only through the router."""

    def test_empty_content_is_unparseable(self, db):
        from app.services import swudb_import

        with pytest.raises(swudb_import.UnparseableFileError):
            swudb_import.parse_swudb_csv("", db)

    def test_header_missing_a_required_column_is_unparseable(self, db):
        from app.services import swudb_import

        with pytest.raises(swudb_import.UnparseableFileError):
            swudb_import.parse_swudb_csv("Set,CardNumber,Count\nASH,09826,1\n", db)


class TestSwudbFourColumnFile:
    """SWUDB's own import format is the 4-column subset (no Stamp)."""

    def test_four_column_file_without_stamp_is_accepted(
        self, bl54s2_tenant, bl185_catalog
    ):
        client, _ = bl54s2_tenant
        content = _swudb_csv("Set,CardNumber,Count,IsFoil", ["ASH,09826,3,False"])
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl185_catalog["ash_standard"]["uuid"]
        assert row["file_quantity"] == 3


class TestSwudbMalformedCount:
    def test_bad_count_rejected_like_existing_parsers(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["ASH,09826,not-a-number,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "malformed_row"


class TestSwudbIntegrationWithComputeImport:
    """A resolved SWUDB row must flow through compute_import's merge/cap
    math identically to a canonical row -- same trim/ceiling behavior,
    same report shape (BL-185 scope: parse_swudb_csv only produces a
    ParsedRow carrying swuapi_uuid; compute_import itself is untouched)."""

    def test_trim_clamps_to_keep_limit_same_as_canonical_import(
        self, db, bl54s2_tenant, bl185_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl185_catalog["ash_standard"]
        _set_quantity(db, tenant_id, variant["id"], 2)

        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["ASH,09826,3,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="trim",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["current_quantity"] == 2
        assert row["file_quantity"] == 3
        # Same keep-limit math as TestMergeCapMath's canonical-format case
        # (limit 3, current 2, file 3 -> resulting 3, 2 copies not added).
        assert row["resulting_quantity"] == 3
        assert row["copies_not_added"] == 2
        assert row["trim_reason"] == "keep_limit"

    def test_commit_writes_the_resolved_quantity(
        self, db, bl54s2_tenant, bl185_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl185_catalog["ts26_standard"]

        content = _swudb_csv(
            "Set,CardNumber,Count,IsFoil,Stamp", ["TS26,09827,4,False,"]
        )
        resp = _post_import(
            client,
            content=content,
            filename="collection.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="commit",
        )
        assert resp.status_code == 200
        assert resp.json()["committed"] is True
        assert _get_quantity(db, tenant_id, variant["id"]) == 4


# ---------------------------------------------------------------------------
# BL-186: sw-unlimited-db.com collection-export (XLSX) import adapter --
# router detection (§8.2's xlsx branch), melt, positive-only semantics,
# base-card-first resolution, and every column family, against
# bl186_catalog. Pure-Python coverage (set-code table, normalization,
# column-family selection, melt shape) lives in
# test_swunlimiteddb_import.py; this section is what needs a real DB.
# ---------------------------------------------------------------------------


def _post_xlsx_import(
    client, *, header, rows, filename="collection.xlsx", mode, cap_handling, stage
):
    return client.post(
        "/api/inventory/import",
        files={"file": (filename, _xlsx_bytes(header, rows))},
        data={"mode": mode, "cap_handling": cap_handling, "stage": stage},
    )


class TestSwunlimiteddbMelt:
    def test_vader_style_row_melts_into_three_resolved_rows(
        self, bl54s2_tenant, bl186_catalog
    ):
        """§0.1/§4 row 1: one spreadsheet row with Normal/Foil/Hyperspace
        all positive melts into 3 separate report rows, each resolving to
        its own variant with its own file_quantity -- not folded into one."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal", "Foil", "Hyperspace"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 3, 1, 2]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["totals"]["resolved"] == 3
        resolved_by_uuid = {
            r["card"]["swuapi_uuid"]: r["file_quantity"] for r in body["rows"]
        }
        assert resolved_by_uuid[bl186_catalog["multi_standard"]["uuid"]] == 3
        assert resolved_by_uuid[bl186_catalog["multi_foil"]["uuid"]] == 1
        assert resolved_by_uuid[bl186_catalog["multi_hyperspace"]["uuid"]] == 2


class TestSwunlimiteddbTokenRouting:
    """BL-199: the raw Base card id's T- prefix is the row's only token
    signal, and _normalize_number strips it before lookup -- so a token
    row and a real-card row share one bare (set, number) pair. Each must
    resolve ONLY among its own is_token side of the base-card lookup."""

    def test_bare_number_resolves_the_real_card_not_the_token(
        self, bl54s2_tenant, bl186_catalog
    ):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal"],
            rows=[["law", "9842", "BL186 Real At Shared Number", 2]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl186_catalog["tokencollide_real"]["uuid"]

    def test_t_prefixed_number_resolves_the_token_not_the_real_card(
        self, bl54s2_tenant, bl186_catalog
    ):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal"],
            rows=[["law", "T9842", "BL186 Token At Shared Number", 3]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl186_catalog["tokencollide_token"]["uuid"]
        assert row["file_quantity"] == 3


class TestSwunlimiteddbPositiveOnly:
    def test_blank_and_literal_zero_cells_never_produce_a_row(
        self, bl54s2_tenant, bl186_catalog
    ):
        """§2.3/§10 (owner-locked): a blank Foil cell and a literal 0
        Hyperspace cell both assert nothing -- only Normal's positive
        value produces a report row."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal", "Foil", "Hyperspace"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 2, None, 0]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["totals"]["rows"] == 1
        assert (
            body["rows"][0]["card"]["swuapi_uuid"]
            == bl186_catalog["multi_standard"]["uuid"]
        )
        assert body["rows"][0]["file_quantity"] == 2


class TestSwunlimiteddbBaseCardFirst:
    def test_prerelease_variant_resolves_despite_different_own_identity(
        self, bl54s2_tenant, bl186_catalog
    ):
        """§10 (load-bearing owner finding): the base card is (SOR, 9836);
        its Prerelease Promo variant actually lives at (P25, 9736) -- a
        completely different (source_set_code, card_number). Resolution
        must find it via base_card_id (base-card-first), not by deriving
        any (set, number) pair from the row's own identity."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Prerelease Promo"],
            rows=[["sor", "9836", "BL186 Prerelease Proof Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert (
            row["card"]["swuapi_uuid"]
            == bl186_catalog["prerelease_proof_promo"]["uuid"]
        )

    def test_prerelease_promo_preferred_over_judge_when_both_exist(
        self, bl54s2_tenant, bl186_catalog
    ):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Prerelease Promo"],
            rows=[["sor", "9837", "BL186 Prerelease Pair Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert (
            row["card"]["swuapi_uuid"] == bl186_catalog["prerelease_pair_promo"]["uuid"]
        )


class TestSwunlimiteddbHomeSetPreference:
    def test_weekly_play_home_set_preferred_over_container_sibling(
        self, bl54s2_tenant, bl186_catalog
    ):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Organized Play"],
            rows=[["law", "9838", "BL186 WP Home Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl186_catalog["wp_home_home"]["uuid"]


class TestSwunlimiteddbWeeklyPlayEarlyEra:
    def test_organized_play_resolves_via_early_era_container_set(
        self, bl54s2_tenant, bl186_catalog
    ):
        """BL-183: an early-era root-coded WP printing whose variant_type
        is "Hyperspace" (not "Weekly Play") but whose source_set_code is
        the row's own mapped_set + "P" (SORP) -- still resolves as the
        Organized Play family."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Organized Play"],
            rows=[["sor", "9839", "BL186 WP Early Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["card"]["swuapi_uuid"] == bl186_catalog["wp_early_container"]["uuid"]


class TestSwunlimiteddbSerializedAmbiguous:
    def test_serialized_prestige_trio_is_ambiguous_with_all_candidates(
        self, bl54s2_tenant, bl186_catalog
    ):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Serialized Prestige"],
            rows=[["sec", "9840", "BL186 Serialized Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "ambiguous"
        assert row["reason"] == "ambiguous_triple"
        assert sorted(row["candidates"]) == sorted(bl186_catalog["serialized_uuids"])


class TestSwunlimiteddbUnmappedSet:
    def test_hmw_is_unmapped_set(self, bl54s2_tenant):
        """§3.3/§10 (owner-locked): HMW is genuinely unreleased/preview
        content per the owner's read -- this catalog maps only
        swuapi-sourced content, so HMW stays unmapped by design."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal"],
            rows=[["HMW", "4", "Hijacked AT-ST", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "unmapped_set"
        assert row["card"]["set_code"] == "HMW"


class TestSwunlimiteddbUnmappedColumn:
    def test_event_exclusive_is_unmapped_column_even_with_a_resolvable_base_card(
        self, bl54s2_tenant, bl186_catalog
    ):
        """§6/§10 (owner-locked): Event Exclusive's single observed
        real-world use is a card-level anomaly -- unmapped_column in v1,
        even though the base card (SOR, 9841) resolves fine for other
        columns (bl186_catalog's own Standard/Foil/Hyperspace family)."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Event Exclusive"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "unmapped_column"

    def test_dead_column_positive_is_unmapped_column(self, bl54s2_tenant):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Top 8"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 1]],
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "unresolved"
        assert row["reason"] == "unmapped_column"


class TestSwunlimiteddbDetection:
    """The router's XLSX sniff (app/routers/inventory.py's _looks_like_xlsx)
    exercised end to end through POST /api/inventory/import, plus every
    OTHER existing format's own routing staying unaffected by the new
    binary-detection branch running first."""

    def test_xlsx_extension_routes_to_the_new_parser(
        self, bl54s2_tenant, bl186_catalog
    ):
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 1]],
            filename="collection.xlsx",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        assert resp.json()["rows"][0]["status"] == "resolved"

    def test_xlsx_magic_bytes_route_correctly_without_the_extension(
        self, bl54s2_tenant, bl186_catalog
    ):
        """A generic filename (no .xlsx extension) still routes correctly
        via the ZIP magic-byte sniff -- the same posture BL-185's SWUDB
        header sniff already has for extension-less uploads."""
        client, _ = bl54s2_tenant
        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 1]],
            filename="upload",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        assert resp.json()["rows"][0]["status"] == "resolved"

    def test_canonical_json_still_routes_correctly_after_the_xlsx_branch(
        self, bl54s2_tenant, bl54s2_catalog
    ):
        """The new binary-sniff-before-decode branch must be a pure
        addition -- a canonical JSON upload (non-xlsx bytes) still decodes
        and resolves exactly as before."""
        client, _ = bl54s2_tenant
        content = _json_doc([{"swuapi_uuid": "bl54s2-v-a-standard", "quantity": 1}])
        resp = _post_import(
            client,
            content=content,
            filename="upload.json",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 200
        assert resp.json()["rows"][0]["status"] == "resolved"

    def test_text_starting_with_pk_letters_is_not_misdetected_as_xlsx(
        self, bl54s2_tenant
    ):
        """Cheap edge case: content that merely starts with the letters
        "PK" (not the real 4-byte ZIP local-file-header signature) must
        fall through to canonical CSV handling, which then correctly
        refuses it as unparseable rather than being fed to openpyxl."""
        client, _ = bl54s2_tenant
        resp = _post_import(
            client,
            content="PK not a real header at all\njust text\n",
            filename="upload.csv",
            mode="merge_add",
            cap_handling="add_above",
            stage="dry_run",
        )
        assert resp.status_code == 422


class TestSwunlimiteddbIntegrationWithComputeImport:
    """A resolved sw-unlimited-db row must flow through compute_import's
    merge/cap math identically to a canonical row -- same trim/ceiling
    behavior, same report shape (BL-186 scope: parse_swunlimiteddb_xlsx
    only produces a ParsedRow carrying swuapi_uuid; compute_import itself
    is untouched)."""

    def test_trim_clamps_to_keep_limit_same_as_canonical_import(
        self, db, bl54s2_tenant, bl186_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl186_catalog["multi_standard"]
        _set_quantity(db, tenant_id, variant["id"], 2)

        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Normal"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 3]],
            mode="merge_add",
            cap_handling="trim",
            stage="dry_run",
        )
        assert resp.status_code == 200
        row = resp.json()["rows"][0]
        assert row["status"] == "resolved"
        assert row["current_quantity"] == 2
        assert row["file_quantity"] == 3
        # Same keep-limit math as TestMergeCapMath's canonical-format case
        # and TestSwudbIntegrationWithComputeImport's own SWUDB case (limit
        # 3, current 2, file 3 -> resulting 3, 2 copies not added).
        assert row["resulting_quantity"] == 3
        assert row["copies_not_added"] == 2
        assert row["trim_reason"] == "keep_limit"

    def test_commit_writes_the_resolved_quantity(
        self, db, bl54s2_tenant, bl186_catalog
    ):
        client, tenant_id = bl54s2_tenant
        variant = bl186_catalog["multi_foil"]

        resp = _post_xlsx_import(
            client,
            header=["Set", "Base card id", "Name", "Foil"],
            rows=[["sor", "9841", "BL186 Multi Melt Hero", 4]],
            mode="merge_add",
            cap_handling="add_above",
            stage="commit",
        )
        assert resp.status_code == 200
        assert resp.json()["committed"] is True
        assert _get_quantity(db, tenant_id, variant["id"]) == 4
