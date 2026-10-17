"""Database URL normalisation (BL-265).

SQLAlchemy 2.1 changed the driver a bare ``postgresql://`` URL selects from
psycopg2 to psycopg (v3). Every URL this app is handed -- `.env`, CI, Cloud
Run secrets -- is a bare ``postgresql://``, and the app is built on psycopg2
(``psycopg2-binary`` in requirements; ``copy_expert`` in
ingestion/transfer_variant_prices.py; psycopg2 error classes in the import
path). Rather than rewrite those URLs in every environment, every engine is
created through ``sa_url()``, which names the psycopg2 driver explicitly.
Moving to psycopg 3 is a separate driver migration, not part of a version bump.
"""

_BARE_SCHEMES = ("postgresql://", "postgres://")
_PSYCOPG2_SCHEME = "postgresql+psycopg2://"


def sa_url(url: str) -> str:
    """Return ``url`` with the psycopg2 driver made explicit.

    URLs that already name a driver (``postgresql+<driver>://``) are returned
    unchanged.
    """
    for scheme in _BARE_SCHEMES:
        if url.startswith(scheme):
            return _PSYCOPG2_SCHEME + url[len(scheme) :]
    return url
