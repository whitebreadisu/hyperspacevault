"""BL-137 D2: server-side deck-URL fetching for the two live-verified
provider APIs (Definition_DeckCheck_2026-07-16.md §2 / §6): swubase.com
(`GET /api/deck/{uuid}/json`) and sw-unlimited-db.com
(`GET /umbraco/api/deckapi/get?id={n}`).

SSRF hygiene, all enforced here rather than trusted to the caller:
- strict host allowlist -- any other host raises UnsupportedUrlError before
  a single byte leaves this process;
- the fetch URL is always REBUILT from an allowlisted host + an id
  extracted from the pasted URL, never the pasted URL passed through
  verbatim -- a query string or path segment on an allowlisted host can't
  smuggle a redirect/different-host request;
- httpx.Client(follow_redirects=False) (the httpx default, made explicit
  here) -- a 3xx response is never chased, on or off the allowlist;
- a hard timeout and a streamed response-size cap (~1MB) so a slow or
  oversized upstream response can't hang or balloon this process.
"""

from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, urlsplit

import httpx

FETCH_TIMEOUT_SECONDS = 10.0
MAX_RESPONSE_BYTES = 1_000_000

SWUBASE_HOSTS = {"swubase.com", "www.swubase.com"}
SW_UNLIMITED_DB_HOSTS = {"sw-unlimited-db.com", "www.sw-unlimited-db.com"}

SWUBASE_SOURCE = "swubase"
SW_UNLIMITED_DB_SOURCE = "sw-unlimited-db"

_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


class UnsupportedUrlError(Exception):
    """Host isn't on the allowlist, or an allowlisted host's URL doesn't
    contain a recognizable deck id -- either way the router steers the
    caller to the paste-JSON fallback (Definition_DeckCheck §2)."""


class FetchFailedError(Exception):
    """The URL was recognized and dispatched, but the upstream request
    itself failed (timeout, network error, non-200, oversized body,
    malformed JSON in the response)."""


def resolve_provider_api_url(url: str) -> tuple[str, str]:
    """Maps a user-pasted URL (a deck page URL OR the raw API URL itself,
    either works) to (fetch_url, source_label). Never trusts the pasted
    URL's own path+query beyond extracting an id -- the actual request
    always targets our own hardcoded API path template."""
    try:
        parsed = urlsplit(url.strip())
    except ValueError as exc:
        raise UnsupportedUrlError(f"could not parse URL: {url}") from exc

    host = (parsed.netloc or "").lower().split(":")[0]
    if not host or parsed.scheme not in ("http", "https"):
        raise UnsupportedUrlError(f"not a valid http(s) URL: {url}")

    if host in SWUBASE_HOSTS:
        match = _UUID_RE.search(url)
        if not match:
            raise UnsupportedUrlError(f"no deck id found in swubase.com URL: {url}")
        deck_uuid = match.group(0)
        return f"https://swubase.com/api/deck/{deck_uuid}/json", SWUBASE_SOURCE

    if host in SW_UNLIMITED_DB_HOSTS:
        deck_id = _extract_numeric_id(parsed)
        if deck_id is None:
            raise UnsupportedUrlError(
                f"no deck id found in sw-unlimited-db.com URL: {url}"
            )
        return (
            f"https://sw-unlimited-db.com/umbraco/api/deckapi/get?id={deck_id}",
            SW_UNLIMITED_DB_SOURCE,
        )

    raise UnsupportedUrlError(f"unsupported host: {host}")


def _extract_numeric_id(parsed) -> str | None:
    query = parse_qs(parsed.query)
    if "id" in query and query["id"] and query["id"][0].isdigit():
        return query["id"][0]
    path_parts = [p for p in parsed.path.split("/") if p]
    if path_parts and path_parts[-1].isdigit():
        return path_parts[-1]
    return None


def fetch_deck_json(url: str) -> tuple[dict, str]:
    """Returns (raw_deck_json, source_label). Raises UnsupportedUrlError
    (host/shape not recognized -- never contacts the network) or
    FetchFailedError (the network call itself failed)."""
    fetch_url, source = resolve_provider_api_url(url)

    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=False
        ) as client:
            with client.stream("GET", fetch_url) as response:
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise FetchFailedError(
                            f"response from {source} exceeded {MAX_RESPONSE_BYTES} bytes"
                        )
                if response.status_code != 200:
                    raise FetchFailedError(
                        f"{source} returned HTTP {response.status_code}"
                    )
    except httpx.TimeoutException as exc:
        raise FetchFailedError(f"timed out fetching deck from {source}") from exc
    except httpx.HTTPError as exc:
        raise FetchFailedError(f"network error fetching deck from {source}") from exc

    try:
        return json.loads(bytes(body)), source
    except json.JSONDecodeError as exc:
        raise FetchFailedError(f"{source} returned a non-JSON response") from exc
