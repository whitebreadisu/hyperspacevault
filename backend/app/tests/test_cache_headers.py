"""RR-3 (issue #129) -- Cache-Control on the public catalog endpoints.

Covers the invariant from app/http_cache.py: a route may carry a public
cache header only if its response bytes are independent of the Authorization
header. GET /api/sets, /api/sets/{code}, and (since BL-101's
catalog/quantity split) GET /api/base-cards run on get_catalog_db
(tenant-less by construction) and get the CDN-cacheable header;
GET /api/base-cards/{id} (per-tenant quantities via get_optional_db) and
everything under /api/inventory (get_db) must never get it, with or without
an Authorization header. 404s must never carry the public header --
FastAPI's dependency-set headers don't survive an HTTPException, which this
suite pins as the desired behavior rather than an accident.

BL-102 disposition: the /api/cards and /api/cards/{id} tests here were
RETIRED with their endpoints (runtime-dead since BL-56/BL-44); the
catalog-family header property they pinned is carried by the /api/sets and
/api/base-cards tests, and the 404-never-cached property by
test_get_set_by_code_404.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_cache_headers.py -v
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.http_cache import CATALOG_CACHE_CONTROL, TENANT_CACHE_CONTROL

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL — run inside the backend container",
)


@pytest.fixture
def anon_client():
    """A TestClient with no dependency overrides -- exercises the real
    get_catalog_db / get_optional_db code paths exactly as a real anonymous
    request would (no Authorization header at all). Mirrors
    test_catalog_anonymous_reads.py's anon_client fixture."""
    from app.main import app

    return TestClient(app)


@pytest.fixture
def champion_gamma_id(db):
    from sqlalchemy import text

    return db.execute(
        text("SELECT id FROM base_cards WHERE swuapi_id = 'test-0006'")
    ).scalar()


class TestCatalogEndpointsCarryPublicCacheHeader:
    """get_catalog_db-backed routes (sets, base-cards list) -- CDN-cacheable."""

    def test_list_sets(self, client):
        response = client.get("/api/sets")
        assert response.status_code == 200
        assert response.headers["cache-control"] == CATALOG_CACHE_CONTROL

    def test_get_set_by_code(self, client):
        response = client.get("/api/sets/SOR")
        assert response.status_code == 200
        assert response.headers["cache-control"] == CATALOG_CACHE_CONTROL

    def test_list_sets_anonymous_same_header(self, anon_client):
        """The header doesn't depend on caller identity -- an anonymous
        caller gets exactly the same public header as an authenticated one,
        which is the whole point of it being safely CDN-shared."""
        response = anon_client.get("/api/sets")
        assert response.status_code == 200
        assert response.headers["cache-control"] == CATALOG_CACHE_CONTROL

    # BL-101 (PORTED from TestBaseCardsEndpointsNeverCarryPublicCacheHeader):
    # the list route crossed the boundary -- catalog-only payload on
    # get_catalog_db, so it now carries the public header, for both auth
    # states, like the rest of the catalog family.
    def test_list_base_cards_authenticated(self, client):
        response = client.get("/api/base-cards?set_code=SOR")
        assert response.status_code == 200
        assert response.headers["cache-control"] == CATALOG_CACHE_CONTROL

    def test_list_base_cards_anonymous(self, anon_client):
        response = anon_client.get("/api/base-cards?set_code=SOR")
        assert response.status_code == 200
        assert response.headers["cache-control"] == CATALOG_CACHE_CONTROL


class TestTenantEndpointsNeverCarryPublicCacheHeader:
    """Routes whose responses carry per-tenant data (the base-cards detail
    route's quantities, everything under /api/inventory) -- must always be
    private/no-store, with or without an Authorization header."""

    def test_get_base_card_detail_authenticated(self, client, champion_gamma_id):
        response = client.get(f"/api/base-cards/{champion_gamma_id}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == TENANT_CACHE_CONTROL

    def test_get_base_card_detail_anonymous(self, anon_client, champion_gamma_id):
        response = anon_client.get(f"/api/base-cards/{champion_gamma_id}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == TENANT_CACHE_CONTROL

    def test_list_quantities(self, client):
        """BL-101: the quantities endpoint is the per-tenant half of the
        split -- the one place the split's tenant data lives, so the one
        place a public header would be the exact cache-poisoning failure
        the split was designed to make impossible."""
        response = client.get("/api/inventory/quantities")
        assert response.status_code == 200
        assert response.headers["cache-control"] == TENANT_CACHE_CONTROL


class Test404sNeverCarryPublicCacheHeader:
    """FastAPI dependency-set response headers (router-level
    dependencies=[Depends(catalog_cache)]) don't apply to a response built
    from a raised HTTPException -- pinned here so a 404 never accidentally
    enters the CDN as if it were a valid catalog response."""

    def test_get_set_by_code_404(self, client):
        response = client.get("/api/sets/NOPE")
        assert response.status_code == 404
        assert response.headers.get("cache-control") != CATALOG_CACHE_CONTROL
