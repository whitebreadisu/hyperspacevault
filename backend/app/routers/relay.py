"""BL-235: first-party reverse proxy for PostHog analytics.

The frontend sends analytics traffic to /api/relay/* (same-origin via the
Firebase Hosting /api/** rewrite) and this router forwards it to PostHog
Cloud US. First-party paths are the adblock-resilience rider locked in
planning/Definition_Analytics_Taxonomy_2026-08-26.md (internal repo):
blockers key on known tracker domains, and a naive direct integration
would silently drop a *biased* slice of a Reddit-sourced audience.

Deliberately unauthenticated: anonymous catalog browsing is part of the
taxonomy (screen_viewed, share_link_viewed), so the relay must accept
events from logged-out visitors. Abuse surface is bounded: the PostHog
project token is publishable by design (anyone could post events to
PostHog directly with it); the relay adds no capability beyond origin
laundering, holds no secrets, and touches no app state.

Two upstream hosts, per PostHog's documented reverse-proxy contract:
  /api/relay/static/*  -> us-assets.i.posthog.com   (lazy-loaded JS assets,
                          e.g. the session-replay recorder)
  /api/relay/*         -> us.i.posthog.com          (event ingestion,
                          /decide config, flags)

Failure posture: analytics must never break the app. Upstream errors and
timeouts come back as plain 502s; the client SDK retries/batches on its
own. Nothing here raises into the app's error surface.
"""

import logging

import httpx
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/relay", tags=["relay"])

_INGEST_HOST = "https://us.i.posthog.com"
_ASSETS_HOST = "https://us-assets.i.posthog.com"

# Request headers worth forwarding upstream. Everything else (cookies,
# auth headers, Firebase/Cloud Run infra headers) is dropped -- the relay
# forwards analytics payloads, not the request environment.
_FORWARD_REQUEST_HEADERS = ("content-type", "content-encoding", "user-agent")

# Response headers passed back to the browser. Hop-by-hop and transport
# headers (content-length, content-encoding, transfer-encoding, connection)
# are recomputed by our own stack for the possibly-decompressed body httpx
# hands us -- echoing upstream's values would desynchronize the framing.
_FORWARD_RESPONSE_HEADERS = ("content-type", "cache-control")

_TIMEOUT = httpx.Timeout(10.0)

# Module-level client, one per process: connection pooling across event
# batches. Closed implicitly at process exit -- Cloud Run instances are
# torn down whole, so no lifespan hook is needed.
_client = httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False)


def _upstream_url(path: str, query: str) -> str:
    host = _ASSETS_HOST if path.startswith("static/") else _INGEST_HOST
    url = f"{host}/{path}"
    if query:
        url = f"{url}?{query}"
    return url


@router.api_route("/{path:path}", methods=["GET", "POST"])
async def relay(path: str, request: Request) -> Response:
    upstream = _upstream_url(path, request.url.query)
    headers = {
        name: value
        for name in _FORWARD_REQUEST_HEADERS
        if (value := request.headers.get(name)) is not None
    }
    # Client IP forwarded for PostHog's GeoIP (country/region enrichment --
    # product-relevant: e.g. EU share informs the Cardmarket ask, BL-228).
    # PostHog's project-level "discard client IP" setting can turn the
    # stored IP off dashboard-side at any time without touching this code.
    if request.client is not None and request.client.host:
        headers["x-forwarded-for"] = request.client.host

    try:
        upstream_response = await _client.request(
            request.method,
            upstream,
            content=await request.body(),
            headers=headers,
        )
    except httpx.HTTPError as exc:
        # Log the class, not the payload -- analytics bodies never belong
        # in our logs.
        logger.warning("relay upstream error: %s", type(exc).__name__)
        return Response(status_code=502)

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers={
            name: value
            for name in _FORWARD_RESPONSE_HEADERS
            if (value := upstream_response.headers.get(name)) is not None
        },
    )
