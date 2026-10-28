"""Rebuild app/data/google_ranges.json: Google's published address ranges
minus the Google Cloud ranges (goog.json CIDRs minus cloud.json CIDRs).

The result is the set of addresses Google uses for its own front doors
(Google Front End, the Firebase Hosting origin fetchers) that a customer
cannot rent: a Compute Engine / Cloud Run attacker sits in cloud.json and is
excluded. app/forwarded.py uses it to recognise the Hosting hop.

    python scripts/refresh_google_ranges.py [--out app/data/google_ranges.json]

Standard library only. The two sources are public static files:
https://www.gstatic.com/ipranges/goog.json and .../cloud.json.
"""

import argparse
import ipaddress
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GOOG_URL = "https://www.gstatic.com/ipranges/goog.json"
CLOUD_URL = "https://www.gstatic.com/ipranges/cloud.json"
DEFAULT_OUT = (
    Path(__file__).resolve().parent.parent / "app" / "data" / "google_ranges.json"
)


def _fetch(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310 - fixed https URLs
        return json.load(resp)


def _networks(doc: dict) -> list:
    out = []
    for p in doc["prefixes"]:
        cidr = p.get("ipv4Prefix") or p.get("ipv6Prefix")
        if cidr:
            out.append(ipaddress.ip_network(cidr))
    return out


def subtract(goog: list, cloud: list) -> list:
    """goog minus cloud, as a minimal list of networks."""
    result = list(ipaddress.collapse_addresses([n for n in goog if n.version == 4]))
    result += list(ipaddress.collapse_addresses([n for n in goog if n.version == 6]))
    for c in cloud:
        nxt = []
        for r in result:
            if r.version != c.version or not r.overlaps(c):
                nxt.append(r)
            elif r.subnet_of(c):
                continue
            else:  # c is strictly inside r
                nxt.extend(r.address_exclude(c))
        result = nxt
    v4 = ipaddress.collapse_addresses([n for n in result if n.version == 4])
    v6 = ipaddress.collapse_addresses([n for n in result if n.version == 6])
    return [*v4, *v6]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    goog_doc, cloud_doc = _fetch(GOOG_URL), _fetch(CLOUD_URL)
    nets = subtract(_networks(goog_doc), _networks(cloud_doc))
    doc = {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "sources": {
            "goog.json": {
                "url": GOOG_URL,
                "creationTime": goog_doc.get("creationTime"),
            },
            "cloud.json": {
                "url": CLOUD_URL,
                "creationTime": cloud_doc.get("creationTime"),
            },
        },
        "rule": "goog.json CIDRs minus cloud.json CIDRs",
        "prefixes": [str(n) for n in nets],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(nets)} prefixes)")


if __name__ == "__main__":
    main()
