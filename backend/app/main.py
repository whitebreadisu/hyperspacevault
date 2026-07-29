import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.ingestion.bootstrap import bootstrap_catalog
from app.logging_config import configure_logging
from app.middleware import log_requests, security_headers
from app.routers import account as account_router
from app.routers import base_cards as base_cards_router
from app.routers import catalog as catalog_router
from app.routers import deck_check as deck_check_router
from app.routers import feedback as feedback_router
from app.routers import images as images_router
from app.routers import inventory as inventory_router
from app.routers import sets as sets_router
from app.routers import settings as settings_router

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap_catalog()
    yield


def _api_docs_enabled() -> bool:
    """Swagger UI/ReDoc/OpenAPI schema are public, unauthenticated routes.
    Disabled in production (ENVIRONMENT=production) to avoid exposing the
    API surface; left on everywhere else (local dev, CI)."""
    return os.environ.get("ENVIRONMENT") != "production"


_docs_kwargs = (
    {}
    if _api_docs_enabled()
    else {"docs_url": None, "redoc_url": None, "openapi_url": None}
)

app = FastAPI(
    title="SWU Inventory Manager",
    description="Star Wars Unlimited card inventory management API",
    version="1.0.0",
    lifespan=lifespan,
    **_docs_kwargs,
)

# BL-99: gzip response bodies when the client advertises Accept-Encoding:
# gzip. Transport-only -- no route, response model, or Cache-Control header
# changes (RR-3's catalog_cache/tenant_no_store in app/http_cache.py are
# orthogonal to this and stay unaffected; Firebase Hosting already emits
# Vary: accept-encoding, so the CDN is primed to cache the gzipped and
# identity variants separately).
#
# Ordering: GZip is added FIRST, before CORSMiddleware and before
# log_requests -- deliberately the opposite of "last add_middleware() call
# wraps outermost". Starlette's add_middleware() inserts each new middleware
# at the front of self.user_middleware, and build_middleware_stack() wraps
# outer-to-inner in that same order, so adding GZip first makes it the
# INNERMOST user middleware, sitting directly around ExceptionMiddleware/the
# router.
#
# This is required, not stylistic: log_requests is registered via
# app.middleware("http")(...), i.e. Starlette's BaseHTTPMiddleware. When a
# route's response passes through call_next(), BaseHTTPMiddleware captures
# it via a background task and *replays* it as an ASGI stream -- even a
# single-shot JSONResponse gets re-emitted with more_body=True on its first
# chunk. GZipMiddleware's minimum_size gate only applies on the
# non-streaming path (`len(body) < minimum_size and not more_body`); once
# more_body is True it falls into the "streaming response" branch, which
# compresses unconditionally regardless of size. Verified empirically: with
# GZip added *after* log_requests (outermost), a 33-byte 404 body came back
# with Content-Encoding: gzip -- minimum_size was silently defeated. With
# GZip innermost (this ordering), it sees the route's real single-shot
# response directly (via ExceptionMiddleware), the non-streaming branch
# applies, and minimum_size is honored correctly; log_requests then reads
# response.status_code off the object BaseHTTPMiddleware builds from
# call_next, which is unaffected by whether the body it's relaying was
# gzipped -- the per-request log line still emits normally either way.
app.add_middleware(GZipMiddleware, minimum_size=500)

# Local-dev only (prod is same-origin via the Hosting rewrite). Bearer-token
# API, no cookies — keep allow_credentials off even if origins ever widen.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(log_requests)

# BL-157/A4-14: response-hardening headers on every response (see
# app/middleware.py's security_headers docstring for the header list and
# why no CSP). Registered after log_requests/CORS/GZip -- ordering among
# these three doesn't matter functionally (it only sets response headers,
# never reads/rewrites the body), so it rides along in registration order.
app.middleware("http")(security_headers)

# BL-53/A4-11 (proxy-IP fix): added LAST, which -- per this file's own
# GZip-ordering comment above (add_middleware() inserts at the FRONT of
# Starlette's user_middleware list; build_middleware_stack() wraps
# outer-to-inner in that list order) -- makes this the OUTERMOST
# middleware, running before every other middleware and the router on the
# way in. That's required here: it rewrites `scope["client"]` (what
# `request.client.host` resolves to) from Cloud Run's X-Forwarded-For, and
# every downstream consumer of request.client.host -- the feedback
# limiter (app/routers/feedback.py) today, this wave's tenant-keyed
# limiters use request.state.tenant_id instead so they're unaffected --
# needs to see the corrected value, not the proxy's own address.
#
# trusted_hosts="*" (this uvicorn version's constructor param -- the
# older `forwarded_allow_ips` CLI-flag name from the backlog note is
# uvicorn's `--forwarded-allow-ips`, not this in-app middleware's kwarg)
# is safe specifically because of this deployment's topology: Cloud Run
# only accepts traffic from Google's own front-end/Firebase Hosting
# rewrite (SWU_Platform_Spec.md §3.11) -- there is no way for an external
# client to connect directly to this container and forge its own
# X-Forwarded-For as if it were the trusted proxy. Wildcard-trusting the
# immediate peer is standard practice for exactly this "single, fixed,
# non-client-reachable proxy in front" topology; it would NOT be safe if
# this service ever accepted direct internet connections.
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.include_router(sets_router.router)
app.include_router(base_cards_router.router)
app.include_router(catalog_router.router)
app.include_router(images_router.router)
app.include_router(inventory_router.router)
app.include_router(account_router.router)
app.include_router(settings_router.router)
app.include_router(feedback_router.router)
app.include_router(deck_check_router.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
