from fastapi import Response

# RR-3 (issue #129): Cache-Control on the public catalog endpoints.
#
# Invariant: a route may carry a public cache header only if its response
# bytes are independent of the Authorization header. In this codebase that's
# visible via DB dependency -- get_catalog_db (app/routers/sets.py, and the
# base-cards *list* route since BL-101's catalog/quantity split) is
# tenant-less by construction, so its responses are eligible; routes that
# resolve per-tenant data into the response body (the base-cards *detail*
# route via get_optional_db, everything under /api/inventory via get_db)
# must NEVER be publicly cached, even where an anonymous caller's response
# would look "safely" cacheable.
#
# TTL split: the browser tier (max-age) is short because a browser cache
# can't be purged remotely if stale data ships; the CDN tier (s-maxage) is
# long because Firebase Hosting's CDN cache is purged on every Hosting
# deploy, so staleness is bounded by "how long since the last deploy", not
# by this TTL alone. Firebase Hosting only CDN-caches a Cloud Run rewrite's
# response when the response carries a Cache-Control header -- omitting one
# (the pre-RR-3 default) means every request round-trips to Cloud Run.
CATALOG_CACHE_CONTROL = "public, max-age=300, s-maxage=3600"
TENANT_CACHE_CONTROL = "private, no-store"


def catalog_cache(response: Response) -> None:
    """FastAPI dependency: marks a response as publicly cacheable (CDN +
    browser). Only wire this into routers whose responses never vary by
    caller identity -- see the module docstring's invariant."""
    response.headers["Cache-Control"] = CATALOG_CACHE_CONTROL


def tenant_no_store(response: Response) -> None:
    """FastAPI dependency: defensively marks a response as never cacheable.
    Wired into every router whose responses carry per-tenant data, even
    where an individual response happens to be anonymous/zeroed -- the
    header must hold unconditionally, not by request-time inspection."""
    response.headers["Cache-Control"] = TENANT_CACHE_CONTROL
