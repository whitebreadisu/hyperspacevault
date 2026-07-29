"""Integration tests for GET /api/base-cards/{base_card_id} (detail) and
GET /api/base-cards (list, BL-44 Slice A payload-shrink endpoint --
SWU_Catalog_Redesign_Spec.md §5.3, ADR-0005).

Uses conftest's seed_minimal_catalog fixture base card "Test Champion
Gamma" (swuapi_id test-0006), which carries a richer variant long tail
(Standard, Standard Foil, and a PQ Champion/PQ Judge stamp_group pair) plus
a seeded nonzero inventory row, specifically for this endpoint.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_base_cards_api.py -v
"""

import os

import pytest
from sqlalchemy import event, text

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL — run inside the backend container",
)


@pytest.fixture
def champion_gamma_id(db):
    return db.execute(
        text("SELECT id FROM base_cards WHERE swuapi_id = 'test-0006'")
    ).scalar()


@pytest.fixture
def leader_alpha_id(db):
    return db.execute(
        text("SELECT id FROM base_cards WHERE swuapi_id = 'test-0001'")
    ).scalar()


@pytest.fixture
def leader_alpha_variant_id(db):
    return db.execute(
        text("SELECT id FROM card_variants WHERE swuapi_id = 'test-v0001'")
    ).scalar()


@pytest.fixture
def champion_gamma_variant_ids(db):
    rows = db.execute(
        text(
            "SELECT swuapi_id, id FROM card_variants "
            "WHERE swuapi_id IN ('test-v0007', 'test-v0008', 'test-v0009', 'test-v0010')"
        )
    ).all()
    return {r.swuapi_id: r.id for r in rows}


class TestGetBaseCardDetail:
    def test_returns_200_with_base_card_fields(self, client, champion_gamma_id):
        response = client.get(f"/api/base-cards/{champion_gamma_id}")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == champion_gamma_id
        assert body["set_code"] == "SOR"
        assert body["set_name"] == "Spark of Rebellion"
        assert body["base_card_number"] == "9006"
        assert body["name"] == "Test Champion Gamma"
        assert body["type"] == "Unit"
        assert body["rarity"] == "Rare"
        assert isinstance(body["aspects"], list)
        assert isinstance(body["keywords"], list)
        assert isinstance(body["traits"], list)

    def test_returns_all_variants_with_classification(
        self, client, champion_gamma_id, champion_gamma_variant_ids
    ):
        body = client.get(f"/api/base-cards/{champion_gamma_id}").json()
        variants_by_swuapi_id_order = sorted(champion_gamma_variant_ids.values())
        returned_ids = {v["variant_id"] for v in body["variants"]}
        assert returned_ids == set(variants_by_swuapi_id_order)

        by_id = {v["variant_id"]: v for v in body["variants"]}
        standard = by_id[champion_gamma_variant_ids["test-v0007"]]
        assert standard["variant_type"] == "Standard"
        assert standard["finish"] == "Standard"
        assert standard["channel"] == "Retail"
        assert standard["stamped"] is False
        assert standard["stamp_group"] is None
        assert standard["source_set_code"] == "SOR"
        assert standard["source_set_name"] == "Spark of Rebellion"

        standard_foil = by_id[champion_gamma_variant_ids["test-v0008"]]
        assert standard_foil["finish"] == "Standard Foil"

    def test_stamp_group_consolidation_present(
        self, client, champion_gamma_id, champion_gamma_variant_ids
    ):
        body = client.get(f"/api/base-cards/{champion_gamma_id}").json()
        by_id = {v["variant_id"]: v for v in body["variants"]}
        pq_champion = by_id[champion_gamma_variant_ids["test-v0009"]]
        pq_judge = by_id[champion_gamma_variant_ids["test-v0010"]]
        assert pq_champion["stamp_group"] is not None
        assert pq_champion["stamp_group"] == pq_judge["stamp_group"]
        assert pq_champion["stamped"] is True

    def test_quantity_reflects_seeded_inventory(
        self, client, champion_gamma_id, champion_gamma_variant_ids
    ):
        body = client.get(f"/api/base-cards/{champion_gamma_id}").json()
        by_id = {v["variant_id"]: v for v in body["variants"]}
        standard = by_id[champion_gamma_variant_ids["test-v0007"]]
        standard_foil = by_id[champion_gamma_variant_ids["test-v0008"]]
        # Standard has no seeded row -> 0; Standard Foil is seeded to 1
        # (conftest.seed_minimal_catalog).
        assert standard["quantity"] == 0
        assert standard_foil["quantity"] == 1

    def test_returns_404_for_unknown_id(self, client):
        response = client.get("/api/base-cards/99999999")
        assert response.status_code == 404


class TestGetBaseCardDetailTenantIsolation:
    def test_quantity_is_tenant_scoped(
        self, make_client, champion_gamma_id, champion_gamma_variant_ids, db
    ):
        """A second tenant with no inventory rows for this base card sees
        quantity 0 across all variants, even though tenant #1 has a
        nonzero row for the Standard Foil variant."""
        tenant_id = db.execute(
            text(
                "INSERT INTO tenants (name) VALUES ('Detail Isolation Tenant') RETURNING id"
            )
        ).scalar()
        uid = "test-detail-isolation-user"
        email = "detail-isolation@example.com"
        db.execute(
            text(
                "INSERT INTO users (firebase_uid, tenant_id, email) "
                "VALUES (:uid, :tenant_id, :email)"
            ),
            {"uid": uid, "tenant_id": tenant_id, "email": email},
        )
        db.commit()
        try:
            other_client = make_client(uid, email)
            body = other_client.get(f"/api/base-cards/{champion_gamma_id}").json()
            assert all(v["quantity"] == 0 for v in body["variants"])

            # tenant #1 (the default client) still sees its own nonzero row
            tenant_one_body = (
                make_client().get(f"/api/base-cards/{champion_gamma_id}").json()
            )
            by_id = {v["variant_id"]: v for v in tenant_one_body["variants"]}
            assert by_id[champion_gamma_variant_ids["test-v0008"]]["quantity"] == 1
        finally:
            db.rollback()
            db.execute(
                text("DELETE FROM inventory WHERE tenant_id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            db.execute(
                text("DELETE FROM users WHERE firebase_uid = :uid"), {"uid": uid}
            )
            db.execute(
                text("DELETE FROM tenants WHERE id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            db.commit()


class TestListBaseCards:
    """GET /api/base-cards -- BL-44 Slice A payload-shrink endpoint.

    BL-146 (Design_SparseList_2026-07-25.md): the nested row shape
    (BaseCardCatalogResponse/CardVariantCatalogResponse) is now a slimmed
    SUBSET of the detail endpoint's shape above, not the same one -- see
    test_list_fields_are_a_subset_of_detail_fields for the exact
    relationship. Most other assertions here still mirror
    TestGetBaseCardDetail on the fields both shapes share."""

    def test_returns_200_with_list(self, client):
        response = client.get("/api/base-cards?set_code=SOR")
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, list)
        assert len(body) > 0

    def test_each_base_card_has_base_fields_and_nested_variants(
        self, client, champion_gamma_id
    ):
        body = client.get("/api/base-cards?set_code=SOR").json()
        by_id = {bc["id"]: bc for bc in body}
        gamma = by_id[champion_gamma_id]
        assert gamma["set_code"] == "SOR"
        # BL-146: set_name dropped from the list row (Design_SparseList_
        # 2026-07-25.md §2 -- zero list-consumer reads; setNameByCode, a
        # separate getSets() map, does this job everywhere on the frontend).
        # Still served on the detail endpoint -- see TestGetBaseCardDetail.
        assert "set_name" not in gamma
        assert gamma["name"] == "Test Champion Gamma"
        assert gamma["type"] == "Unit"
        assert gamma["rarity"] == "Rare"
        assert isinstance(gamma["aspects"], list)
        assert isinstance(gamma["variants"], list)
        assert len(gamma["variants"]) == 4

    def test_list_fields_are_a_subset_of_detail_fields(
        self, client, champion_gamma_id, champion_gamma_variant_ids
    ):
        """REPLACE for BL-146 (was test_variant_shape_matches_detail_endpoint,
        PORTED for BL-101 from full list==detail equality): full equality is
        false by design now that the list sheds fields the detail endpoint
        keeps (Design_SparseList_2026-07-25.md §2, §7) -- image renditions,
        stamped/stamp_group/source_set_name at the variant level,
        set_name/type2/double_sided/is_unique/front_text/back_text/
        epic_action/artist at the base-card level. The surviving claim: the
        list is a strict field SUBSET of the detail response, equal on every
        field it still carries -- not a divergent shape, just a narrower
        one. This also pins that the split has teeth: the detail response
        genuinely carries strictly more fields than the list, at both
        levels.

        BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): `price`
        REJOINED the list's field set (the completion panel's Collection
        Value calc needs per-variant prices catalog-wide) -- moved out of
        the `detail_only_field` tuple below into the ordinary
        subset-and-equal loop above it, same as every other still-shared
        variant field."""
        detail = client.get(f"/api/base-cards/{champion_gamma_id}").json()
        list_body = client.get("/api/base-cards?set_code=SOR").json()
        from_list = next(bc for bc in list_body if bc["id"] == champion_gamma_id)

        # Base-card level.
        list_scalar_fields = {k: v for k, v in from_list.items() if k != "variants"}
        for field, value in list_scalar_fields.items():
            assert detail[field] == value, field
        for detail_only_field in (
            "set_name",
            "type2",
            "double_sided",
            "is_unique",
            "front_text",
            "back_text",
            "epic_action",
            "artist",
        ):
            assert detail_only_field in detail
            assert detail_only_field not in from_list

        # Variant level.
        detail_by_id = {v["variant_id"]: v for v in detail["variants"]}
        assert len(from_list["variants"]) == len(detail["variants"])
        for list_variant in from_list["variants"]:
            detail_variant = detail_by_id[list_variant["variant_id"]]
            assert set(list_variant.keys()) <= set(detail_variant.keys())
            for field, value in list_variant.items():
                assert detail_variant[field] == value, field
        for detail_only_field in (
            "stamped",
            "stamp_group",
            "source_set_name",
            "front_images",
            "back_images",
            "quantity",
        ):
            assert detail_only_field in detail["variants"][0]
            assert detail_only_field not in from_list["variants"][0]

        # The stamp_group consolidation itself still round-trips correctly
        # on the endpoint that now carries it (full behavioral coverage of
        # this fixture's pairing lives in test_stamp_group_consolidation_
        # present above; this is just confirming detail, not list, is where
        # to look for it post-BL-146).
        pq_champion = detail_by_id[champion_gamma_variant_ids["test-v0009"]]
        pq_judge = detail_by_id[champion_gamma_variant_ids["test-v0010"]]
        assert pq_champion["stamp_group"] == pq_judge["stamp_group"]
        assert pq_champion["stamped"] is True

    def test_list_carries_no_per_tenant_data(
        self, client, champion_gamma_id, champion_gamma_variant_ids
    ):
        """REPLACES test_quantity_reflects_seeded_inventory (BL-101): the
        list endpoint is publicly cacheable, so its response must carry no
        quantity field at all -- even for an authenticated caller with
        seeded inventory (tenant #1 owns test-v0008 at quantity 1). The
        seeded-quantity assertion itself moved to the quantities endpoint
        (test_inventory_api.py::TestListQuantities)."""
        body = client.get("/api/base-cards?set_code=SOR").json()
        gamma = next(bc for bc in body if bc["id"] == champion_gamma_id)
        assert all("quantity" not in v for v in gamma["variants"])

    def test_set_code_filter(self, client):
        body = client.get("/api/base-cards?set_code=SOR").json()
        assert len(body) > 0
        assert all(bc["set_code"] == "SOR" for bc in body)

    def test_unknown_set_code_returns_empty_list(self, client):
        body = client.get("/api/base-cards?set_code=ZZZ").json()
        assert body == []

    def test_type_filter(self, client):
        body = client.get("/api/base-cards?set_code=SOR&type=Leader").json()
        assert len(body) > 0
        assert all(bc["type"] == "Leader" for bc in body)

    def test_rarity_filter(self, client):
        body = client.get("/api/base-cards?set_code=SOR&rarity=Rare").json()
        assert len(body) > 0
        assert all(bc["rarity"] == "Rare" for bc in body)

    def test_payload_shrink_sanity_base_card_count_below_variant_count(
        self, client, db
    ):
        """The core BL-44 payload-shrink claim: base-cards list rows are
        strictly fewer than the flat variant rows they replace (~2,306 vs
        ~8,353 in production; 6 vs 10 in this fixture catalog), because
        base-card fields are no longer duplicated per variant.

        PORTED for BL-102: the old comparison target (GET /api/cards, the
        flat variant list) is retired, so ground truth comes straight from
        card_variants -- same claim, no dead endpoint required."""
        base_cards = client.get("/api/base-cards?set_code=SOR").json()
        db_variant_count = db.execute(
            text(
                "SELECT COUNT(*) FROM card_variants cv "
                "JOIN base_cards bc ON cv.base_card_id = bc.id "
                "JOIN sets s ON bc.set_id = s.id WHERE s.code = 'SOR'"
            )
        ).scalar()
        assert len(base_cards) < db_variant_count
        # Every variant still accounted for, just nested instead of flattened.
        total_nested_variants = sum(len(bc["variants"]) for bc in base_cards)
        assert total_nested_variants == db_variant_count

    def test_avoids_n_plus_one_queries(self, client):
        """Efficiency check (ADR-0005): the number of SQL statements issued
        must stay a small fixed constant regardless of how many base cards
        match, not scale one-per-base-card. Since BL-100 this is 5 Core
        SELECTs (base cards, aspects, keywords, traits, variants) issued by
        get_base_card_list_rows, replacing the old selectinload version."""
        from app.database import app_engine

        statement_count = 0

        def _count(*args, **kwargs):
            nonlocal statement_count
            statement_count += 1

        event.listen(app_engine, "before_cursor_execute", _count)
        try:
            response = client.get("/api/base-cards?set_code=SOR")
        finally:
            event.remove(app_engine, "before_cursor_execute", _count)

        assert response.status_code == 200
        assert len(response.json()) >= 6
        # 5 Core SELECTs (set name arrives via a JOIN on the base-card query;
        # BL-146 dropped the variant query's source_set_name JOIN entirely,
        # not just the response field, since nothing downstream reads it;
        # quantities left the endpoint entirely in BL-101), plus the
        # catalog-session setup (set_config x2) and the pricing snapshot
        # query (still required for display_price -- see get_base_cards'
        # BL-146 docstring note). An N+1 regression (e.g. looping
        # get_base_card_detail per row) would instead scale with the
        # base-card count -- 6 rows here would already blow well past this
        # ceiling.
        assert statement_count <= 20, (
            f"expected a small fixed query count, got {statement_count}"
        )


# BL-101 disposition note: TestListBaseCardsTenantIsolation.test_quantity_is_
# tenant_scoped was REPLACED -- the list endpoint no longer carries per-tenant
# quantities at all (that's now structural: it runs on the tenant-less
# get_catalog_db), so "another tenant sees quantity 0 in the list" is designed
# away. The RLS tenant-isolation guarantee it encoded lives on against the
# endpoint that now carries the data: test_inventory_api.py::
# TestListQuantities::test_quantities_are_tenant_scoped. The detail-endpoint
# isolation test above (TestGetBaseCardDetailTenantIsolation) is unchanged.


class TestVariantImageRenditions:
    """BL-76 Phase 3 (ADR-0012): front_images/back_images are additive,
    derived fields -- conftest's test-v0001 (Test Leader Alpha, Standard) is
    the one fixture variant seeded with real-shaped front_image_url/
    back_image_url, exercising the derivation end-to-end through both the
    list and detail endpoints. Every other fixture variant has null image
    URLs, covering the "no image" -> null renditions case for free (see
    test_no_image_url_yields_null_renditions below)."""

    def test_detail_endpoint_derives_front_and_back_renditions(
        self, client, leader_alpha_id, leader_alpha_variant_id
    ):
        body = client.get(f"/api/base-cards/{leader_alpha_id}").json()
        variant = next(
            v for v in body["variants"] if v["variant_id"] == leader_alpha_variant_id
        )
        assert variant["front_image_url"] == (
            "https://cdn.starwarsunlimited.com/"
            "card_09001_EN_Test_Leader_Alpha_ab12cd34ef.png"
        )
        assert variant["front_images"] == {
            "original": "/images/cards/card_09001_EN_Test_Leader_Alpha_ab12cd34ef.png",
            "w640": "/images/cards/card_09001_EN_Test_Leader_Alpha_ab12cd34ef_640.webp",
            "w320": "/images/cards/card_09001_EN_Test_Leader_Alpha_ab12cd34ef_320.webp",
        }
        assert variant["back_images"] == {
            "original": "/images/cards/card_09001_EN_Test_Leader_Alpha_back_56gh78ij90.png",
            "w640": "/images/cards/card_09001_EN_Test_Leader_Alpha_back_56gh78ij90_640.webp",
            "w320": "/images/cards/card_09001_EN_Test_Leader_Alpha_back_56gh78ij90_320.webp",
        }

    # BL-146 disposition note: test_list_endpoint_derives_the_same_renditions
    # RETIRED (Design_SparseList_2026-07-25.md §3, §7). It asserted the list
    # and detail endpoints' front_images/back_images round-tripped
    # identically through CardVariantCatalogResponse, which they shared --
    # designed away, since the list no longer carries front_images/
    # back_images at all (derived client-side instead, see frontend/src/
    # utils/cardImages.ts's deriveRenditions and its own pinned-fixture test
    # mirroring test_image_paths.py's exact-string assertions below). The
    # "list has no front_images/back_images key at all" claim itself is
    # covered by test_list_fields_are_a_subset_of_detail_fields above.

    def test_no_image_url_yields_null_renditions(self, client, champion_gamma_id):
        """Every other fixture variant has a null front/back_image_url --
        the additive fields must be null too, not an empty/partial object."""
        body = client.get(f"/api/base-cards/{champion_gamma_id}").json()
        for v in body["variants"]:
            assert v["front_image_url"] is None
            assert v["front_images"] is None
            assert v["back_image_url"] is None
            assert v["back_images"] is None
