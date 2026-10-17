"""BL-265: every engine names the psycopg2 driver explicitly.

SQLAlchemy 2.1 maps a bare ``postgresql://`` URL to psycopg (v3), which this
app does not install -- without sa_url() the app fails at import time in every
environment, since all configured URLs are bare.
"""

import os

import pytest
from sqlalchemy.engine import make_url

from app.db_url import sa_url


@pytest.mark.parametrize(
    "url, expected",
    [
        (
            "postgresql://u:p@db:5432/swu_inventory",
            "postgresql+psycopg2://u:p@db:5432/swu_inventory",
        ),
        (
            "postgres://u:p@db:5432/swu_inventory",
            "postgresql+psycopg2://u:p@db:5432/swu_inventory",
        ),
        # Cloud SQL unix-socket form: host in the query string.
        (
            "postgresql://u:p@/swu_inventory?host=/cloudsql/proj:region:inst",
            "postgresql+psycopg2://u:p@/swu_inventory?host=/cloudsql/proj:region:inst",
        ),
        # An explicit driver is left alone.
        (
            "postgresql+psycopg2://u:p@db/x",
            "postgresql+psycopg2://u:p@db/x",
        ),
        ("postgresql+psycopg://u:p@db/x", "postgresql+psycopg://u:p@db/x"),
    ],
)
def test_sa_url_makes_psycopg2_explicit(url, expected):
    assert sa_url(url) == expected


def test_app_engines_use_psycopg2():
    from app.database import app_engine, engine

    assert engine.dialect.driver == "psycopg2"
    assert app_engine.dialect.driver == "psycopg2"


def test_configured_urls_resolve_to_psycopg2():
    for var in ("DATABASE_URL", "APP_DATABASE_URL"):
        assert make_url(sa_url(os.environ[var])).get_driver_name() == "psycopg2"
