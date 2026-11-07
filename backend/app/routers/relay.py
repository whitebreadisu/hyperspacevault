"""First-party reverse proxy for PostHog analytics (ADR-0027, App Spec §22).

The frontend sends analytics traffic to /api/relay/* (same-origin via the
Firebase Hosting /api/** rewrite) and this router forwards it to PostHog
Cloud US. First-party paths make the measurement adblock-resilient:
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

Failure posture: analytics must never break the app, and a
PostHog outage must never page us. On the ingestion path an upstream
timeout, transport error or 5xx is answered `200 {"status": 1}` (what
PostHog itself returns for an accepted event, so posthog-js treats it as
delivered and does not retry) and logged as ONE WARNING line (error class
or upstream status, plus the path -- never payload, headers or query).
The browser therefore never sees a 5xx, so Cloud Run's request log and the
`high_5xx_rate` alert (Platform Spec 4.3) stay quiet. Accepted trade-off:
events from a failed moment are dropped rather than retried by the SDK.
Upstream 2xx/3xx/4xx pass through unchanged. The asset path
(/api/relay/static/*) is NOT masked: a failed JS asset is not an accepted
event, so it keeps a plain 502 (transport failure) or the upstream status.
Nothing here raises into the app's error surface.
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
# headers (content-length, content-encoding, transfer-encoding and
# connection) are recomputed by our own stack for the possibly-decompressed body httpx
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


def _accepted() -> Response:
    """The success answer PostHog gives for an accepted ingestion request."""
    return Response(content=b'{"status": 1}', media_type="application/json")


@router.api_route("/{path:path}", methods=["GET", "POST"])
async def relay(path: str, request: Request) -> Response:
    upstream = _upstream_url(path, request.url.query)
    headers = {
        name: value
        for name in _FORWARD_REQUEST_HEADERS
        if (value := request.headers.get(name)) is not None
    }
    # Client IP forwarded for PostHog's GeoIP (country/region enrichment --
    # product-relevant: e.g. the EU share informs whether Cardmarket, the
    # recorded future second price source in App Spec §16.4, is worth it).
    # PostHog's project-level "discard client IP" setting can turn the
    # stored IP off dashboard-side at any time without touching this code.
    if request.client is not None and request.client.host:
        headers["x-forwarded-for"] = request.client.host

    is_asset = path.startswith("static/")
    try:
        upstream_response = await _client.request(
            request.method,
            upstream,
            content=await request.body(),
            headers=headers,
        )
    except httpx.HTTPError as exc:
        # Log the class and path, not the payload or query -- analytics
        # bodies and ids never belong in our logs.
        logger.warning("relay upstream error: %s path=/%s", type(exc).__name__, path)
        return Response(status_code=502) if is_asset else _accepted()

    if upstream_response.status_code >= 500 and not is_asset:
        logger.warning(
            "relay upstream status: %d path=/%s", upstream_response.status_code, path
        )
        return _accepted()

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers={
            name: value
            for name in _FORWARD_RESPONSE_HEADERS
            if (value := upstream_response.headers.get(name)) is not None
        },
    )
