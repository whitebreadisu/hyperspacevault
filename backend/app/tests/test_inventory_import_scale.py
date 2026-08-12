"""BL-203: large-file import lookups must not exceed Postgres's parser
stack. A composite IN's (a, b, c) row constructors are parsed recursively,
and one statement carrying ~1500+ of them blows the default 2048kB
max_stack_depth (psycopg2.errors.StatementTooComplex) -- the 2026-08-11
prod incident: a 1500+-card collection import 500'd on all ten attempts.

The blow-up point is environment-dependent: prod (Cloud SQL) rejected a
1,500+-triple file, while the dev-image Postgres survives 5,000 keys and
rejects 10,000 (measured empirically during the BL-203 fix -- a first
draft of this test used 2,600 keys and silently passed against the
UNCHUNKED code). Each test therefore drives its lookup with 20,000 keys,
comfortably past the local threshold, so an unchunked regression fails
loudly on the real Postgres CI runs on. The three seeded matches sit at
the head, middle, and tail of the key list, so they resolve in different
chunks and prove the per-chunk results merge into one map.

Run inside the backend container:
    docker compose exec backend pytest app/tests/test_inventory_import_scale.py -v
"""

import os

import pytest
from sqlalchemy import text

from app.repositories import inventory_import as inventory_import_repo

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ or "APP_DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL and APP_DATABASE_URL -- run inside the backend container",
)

# Card numbers 9721-9723: a 97xx range unused by other test modules'
# fixtures (see test_inventory_import_api.py's collision note -- every test
# module shares one DB in CI).
_NUMBERS = ["9721", "9722", "9723"]
_SCALE = 20_000


@pytest.fixture(scope="module", autouse=True)
def bl203_catalog(db):
    """Three SOR base cards, one Standard variant each, at 9721/9722/9723."""
    sor_id = db.execute(text("SELECT id FROM sets WHERE code = 'SOR'")).scalar()
    for number in _NUMBERS:
        base_id = db.execute(
            text(
                "INSERT INTO base_cards "
                "(set_id, base_card_number, name, type, rarity, swuapi_id) "
                "VALUES (:set_id, :number, :name, 'Unit', 'Common', :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id"
            ),
            {
                "set_id": sor_id,
                "number": number,
                "name": f"BL203 Scale {number}",
                "swuapi_id": f"bl203-base-{number}",
            },
        ).scalar()
        db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, swuapi_id) "
                "VALUES (:base_id, 'Standard', 'SOR', :number, :swuapi_id) "
                "ON CONFLICT (swuapi_id) DO NOTHING"
            ),
            {
                "base_id": base_id,
                "number": number,
                "swuapi_id": f"bl203-variant-{number}",
            },
        )
    db.commit()


def _spread(real_keys: list, fake_keys: list) -> list:
    """Head, middle, and tail placement for the real keys."""
    keys = list(fake_keys)
    keys.insert(0, real_keys[0])
    keys.insert(len(keys) // 2, real_keys[1])
    keys.append(real_keys[2])
    return keys


def test_triples_lookup_survives_large_files(db):
    real = [("SOR", n, "Standard") for n in _NUMBERS]
    fakes = [("ZZZ", str(i), "Standard") for i in range(_SCALE - len(real))]
    result = inventory_import_repo.get_variants_by_triples(db, _spread(real, fakes))
    assert set(result) == set(real)
    for key in real:
        assert len(result[key]) == 1


def test_pairs_lookup_survives_large_files(db):
    real = [("SOR", n) for n in _NUMBERS]
    fakes = [("ZZZ", str(i)) for i in range(_SCALE - len(real))]
    result = inventory_import_repo.get_variants_by_set_and_number(
        db, _spread(real, fakes)
    )
    assert set(result) == set(real)


def test_base_card_pairs_lookup_survives_large_files(db):
    real = [("SOR", n) for n in _NUMBERS]
    fakes = [("ZZZ", str(i)) for i in range(_SCALE - len(real))]
    result = inventory_import_repo.get_base_card_variants_by_set_and_number(
        db, _spread(real, fakes)
    )
    assert set(result) == set(real)
