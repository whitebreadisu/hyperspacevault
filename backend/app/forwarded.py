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
peer. If the ranges file is unusable (missing, not JSON, or zero networks)
one WARNING is logged at import and the resolver fails CLOSED: it takes the
rightmost entry only, never second-from-right, and flags every Hosting-host
request (below). Hosting users then share the fetcher's limiter bucket until
the file is fixed, but no caller text can choose a key. Individual malformed
prefixes are skipped with a WARNING naming the count.

Header lines: a request may carry several ``X-Forwarded-For`` lines. They are
joined with ", " in order before splitting (what uvicorn does), so the
rightmost entry is the last entry of the last line. ``X-Forwarded-Host`` uses
the first non-empty line, the same value the request log reports.

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
    """Parsed networks from the ranges file. Malformed individual prefixes are
    skipped with one WARNING naming the count; the file is unusable (None, with
    one WARNING) only when it is missing, not JSON, or yields zero networks."""
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
        prefixes = doc["prefixes"]
        nets = []
        skipped = 0
        for p in prefixes:
            try:
                if not isinstance(p, str):  # ip_network(5) would parse as 0.0.0.5/32
                    raise TypeError(p)
                nets.append(ipaddress.ip_network(p))
            except (ValueError, TypeError):
                skipped += 1
        if skipped:
            logger.warning(
                "google_ranges.json: skipped %d malformed prefix(es) of %d",
                skipped,
                len(prefixes),
            )
        if not nets:
            raise ValueError("no usable prefixes")
        return nets
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning(
            "google_ranges.json unusable (%s): failing closed -- the rightmost "
            "X-Forwarded-For entry is used and every Hosting-host request is flagged",
            exc,
        )
        return None


_GOOGLE_NETWORKS = load_google_networks()


def joined_header(raw_headers, name: bytes) -> str | None:
    """All lines of a header joined with ", " in order (None when absent)."""
    values = [v.decode("latin1") for k, v in raw_headers if k == name]
    return ", ".join(values) if values else None


def first_header(raw_headers, name: bytes) -> str | None:
    """The first non-empty line of a header (None when absent or all empty)."""
    for k, v in raw_headers:
        if k == name and v.strip():
            return v.decode("latin1")
    return None


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
    host header names Hosting but the Hosting hop was not recognised: the
    rightmost entry is outside the ranges, or the ranges are unusable."""
    chain = [e.strip() for e in (xff or "").split(",") if e.strip()]
    if not chain:
        return peer, False
    rightmost = chain[-1]
    networks = _GOOGLE_NETWORKS if google_networks is _UNSET else google_networks
    host_ok = (forwarded_host or "").strip().lower() in hosting_hosts()
    if networks is None:  # ranges unusable: fail closed, rightmost only
        hosting_hop = False
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
            raw = scope.get("headers") or []
            headers = dict(raw)
            xff = joined_header(raw, b"x-forwarded-for")
            if xff is not None:
                peer = scope.get("client")
                resolved, unrecognised = resolve_client(
                    xff,
                    first_header(raw, b"x-forwarded-host"),
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
