"""Client-address resolution behind Cloud Run and Firebase Hosting.

Every consumer of ``request.client.host`` (the per-IP feedback and
shared-read limiters, the PostHog relay's GeoIP stamp, ``client_ip_key``)
needs the real caller. Two paths reach this service, measured on dev
2026-10-28 from the ``forwarded_hops`` / ``forwarded_host`` log fields:

* Direct to Cloud Run: the Google front end APPENDS the real client to
  whatever ``X-Forwarded-For`` the caller sent. A forged leading entry
  survives as the leftmost entry; the real client is the rightmost.
* Via Firebase Hosting: Hosting REPLACES the incoming header, so a forgery
  never arrives, and the chain is ``<client>, <Hosting origin fetcher>``.
  The real client is second from the right.

On the direct path an attacker controls every entry left of the rightmost
one and can send any ``X-Forwarded-Host``. The only unforgeable signal that
the Hosting hop is present is the rightmost entry itself being a Google
front-door address (the origin fetchers live in Google's own ranges). The
rule is therefore: take the second-from-right entry only when BOTH

  (a) ``X-Forwarded-Host`` is one of the configured Hosting domains
      (``HOSTING_FORWARDED_HOSTS``, comma-separated), and
  (b) the rightmost entry is inside Google's published non-Cloud ranges
      (``app/data/google_ranges.json``, goog.json minus cloud.json, rebuilt
      by ``scripts/refresh_google_ranges.py``); a Compute Engine or Cloud
      Run attacker sits in cloud.json, which is excluded;

otherwise take the rightmost entry. An empty chain falls back to the socket
peer. If the ranges file is missing or unparsable the check falls back to
(a) alone and one WARNING is logged at import; that weaker mode lets a
direct caller who forges both headers pick a one-entry-left address, so
keep the file in the image.

Stale ranges are visible, not silent: when the host matches but the rightmost
entry is not in the ranges, the request is resolved to the rightmost entry
(fail closed: the limiter keys on the Google address, never on caller text)
and ``scope["state"]["forwarded_unrecognised_hop"]`` is set, which the request
log emits as ``forwarded_unrecognised_hop: true`` (no address).

Accepted residual (2026-10-28, low): a direct caller whose egress is itself a
Google non-Cloud address (for example Apps Script) and who forges BOTH headers
chooses its own limiter key. It needs Google-hosted egress, and the limiters
bound abuse, not access.

``ForwardedClientMiddleware`` applies the result to ``scope["client"]`` so
``request.client.host`` stays the single consumer API. It also carries over
``X-Forwarded-Proto`` to ``scope["scheme"]`` (what uvicorn's
ProxyHeadersMiddleware did), so redirects Starlette builds keep https.
"""

import ipaddress
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("app.forwarded")

DEFAULT_HOSTING_HOSTS = (
    "swu-dev-jbapps.web.app,swu-dev-jbapps.firebaseapp.com,"
    "swu-prod.web.app,swu-prod.firebaseapp.com,www.hyperspacevault.com,"
    "hyperspacevault.com,swu.jeremybradenapps.com"
)
RANGES_PATH = Path(__file__).parent / "data" / "google_ranges.json"

_UNSET = object()


def load_google_networks(path: Path = RANGES_PATH) -> list | None:
    """Parsed networks from the ranges file, or None (with one WARNING) when
    the file is missing or unparsable."""
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
        nets = [ipaddress.ip_network(p) for p in doc["prefixes"]]
        if not nets:
            raise ValueError("no prefixes")
        return nets
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning(
            "google_ranges.json unusable (%s): Hosting-hop detection falls back to "
            "the X-Forwarded-Host check alone (weaker mode)",
            exc,
        )
        return None


_GOOGLE_NETWORKS = load_google_networks()


def hosting_hosts() -> frozenset[str]:
    raw = os.environ.get("HOSTING_FORWARDED_HOSTS", DEFAULT_HOSTING_HOSTS)
    return frozenset(h.strip().lower() for h in raw.split(",") if h.strip())


def _in_google_ranges(entry: str, networks: list) -> bool:
    try:
        addr = ipaddress.ip_address(entry)
    except ValueError:
        return False
    return any(addr in n for n in networks if n.version == addr.version)


def resolve_client(
    xff: str | None,
    forwarded_host: str | None,
    peer: str | None,
    *,
    google_networks=_UNSET,
) -> tuple[str | None, bool]:
    """(client address, unrecognised_hop). unrecognised_hop is True when the
    host header names Hosting but the rightmost entry is outside the ranges."""
    chain = [e.strip() for e in (xff or "").split(",") if e.strip()]
    if not chain:
        return peer, False
    rightmost = chain[-1]
    networks = _GOOGLE_NETWORKS if google_networks is _UNSET else google_networks
    host_ok = (forwarded_host or "").strip().lower() in hosting_hosts()
    unrecognised = False
    if networks is None:  # weaker mode: ranges unavailable
        hosting_hop = host_ok
    else:
        hosting_hop = host_ok and _in_google_ranges(rightmost, networks)
        unrecognised = host_ok and not hosting_hop
    if hosting_hop and len(chain) >= 2:
        return chain[-2], False
    return rightmost, unrecognised


def resolve_client_ip(
    xff: str | None,
    forwarded_host: str | None,
    peer: str | None,
    *,
    google_networks=_UNSET,
) -> str | None:
    return resolve_client(xff, forwarded_host, peer, google_networks=google_networks)[0]


class ForwardedClientMiddleware:
    """Pure ASGI. Outermost, so every later layer sees the resolved client."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers") or [])
            xff = headers.get(b"x-forwarded-for")
            if xff is not None:
                peer = scope.get("client")
                host = headers.get(b"x-forwarded-host")
                resolved, unrecognised = resolve_client(
                    xff.decode("latin1"),
                    host.decode("latin1") if host else None,
                    peer[0] if peer else None,
                )
                if resolved:
                    scope["client"] = (resolved, peer[1] if peer else 0)
                if unrecognised:
                    scope.setdefault("state", {})["forwarded_unrecognised_hop"] = True
            proto = headers.get(b"x-forwarded-proto")
            if proto is not None:
                value = proto.decode("latin1").split(",")[-1].strip().lower()
                if value in ("http", "https", "ws", "wss"):
                    if scope["type"] == "websocket":
                        value = {"http": "ws", "https": "wss"}.get(value, value)
                    scope["scheme"] = value
        await self.app(scope, receive, send)
