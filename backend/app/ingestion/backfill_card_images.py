"""BL-76 Phase 2 (ADR-0012): one-time (resumable) backfill of every existing
card image into a per-env GCS bucket, via image_mirror.mirror_image.

Source of URLs is the local compose DB's `card_variants` table -- distinct
non-null `front_image_url` + `back_image_url` -- not a live swuapi/CDN
listing. The catalog is identical in every environment (ADR-0012), so
running this against the local DB with `--bucket <env-bucket>` mirrors that
env's images correctly regardless of which machine runs it.

Rate-limited to ~3 req/s against the official CDN (only actual downloads
count against the limit -- `mirror_image` skips the download entirely when
all 3 objects already exist, so a resumed run is fast). Transient failures
(network errors, 429, 5xx) get up to 3 attempts with exponential backoff;
anything else (404, 403, a Pillow decode error, ...) fails immediately --
retrying a permanent failure just burns the rate budget.

Conservation discipline (this repo's loader pattern, see
run_swuapi_ingestion.py / swuapi_transform.py): every distinct URL ends in
exactly one of uploaded / already-present / failed. The report prints all
three counts plus the full list of failures (URL + reason) so nothing is
silently dropped. Exits non-zero if any URL failed, after printing the
report -- partial progress (everything that succeeded) is kept in the
bucket, so a non-zero exit just means "re-run to retry the failures", not
"start over".

Usage:
    python -m app.ingestion.backfill_card_images --bucket swu-dev-jbapps-card-images
    python -m app.ingestion.backfill_card_images --bucket <bucket> --rate 3.0
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from dataclasses import dataclass, field

import httpx
from sqlalchemy import create_engine, text

from app.ingestion.image_mirror import MirrorResult, get_bucket, mirror_image

logger = logging.getLogger(__name__)

PROGRESS_EVERY = 100
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 1.0
DOWNLOAD_TIMEOUT_SECONDS = 30.0

# Failures worth retrying: transport-level errors and CDN-side throttling/
# server errors. A 404/403 (or anything else the CDN returns deliberately)
# is not transient and burns no retry budget.
TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}


class RateLimiter:
    """Caps the rate of the wrapped calls to `rate` per second by sleeping
    just before each one. Single-threaded (this script runs sequentially),
    so no locking is needed."""

    def __init__(self, rate: float):
        self.min_interval = 1.0 / rate if rate > 0 else 0.0
        self._last_call: float | None = None

    def throttle(self) -> None:
        if self.min_interval <= 0:
            return
        now = time.monotonic()
        if self._last_call is not None:
            elapsed = now - self._last_call
            remaining = self.min_interval - elapsed
            if remaining > 0:
                time.sleep(remaining)
        self._last_call = time.monotonic()


@dataclass
class ConservationReport:
    total: int = 0
    uploaded: int = 0
    already_present: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)

    @property
    def failed(self) -> int:
        return len(self.failures)

    def accounted_for(self) -> int:
        return self.uploaded + self.already_present + self.failed

    def render(self) -> str:
        lines = [
            "=== BL-76 Phase 2 backfill: conservation report ===",
            f"total distinct URLs:  {self.total}",
            f"uploaded (>=1 object): {self.uploaded}",
            f"already present:       {self.already_present}",
            f"failed:                {self.failed}",
            f"accounted for:         {self.accounted_for()} / {self.total}",
        ]
        if self.failures:
            lines.append("--- failures ---")
            for url, reason in self.failures:
                lines.append(f"  {url} -- {reason}")
        return "\n".join(lines)


def fetch_distinct_urls(database_url: str) -> list[str]:
    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT url FROM ("
                "  SELECT front_image_url AS url FROM card_variants "
                "  WHERE front_image_url IS NOT NULL"
                "  UNION"
                "  SELECT back_image_url AS url FROM card_variants "
                "  WHERE back_image_url IS NOT NULL"
                ") urls ORDER BY url"
            )
        )
        return [row.url for row in rows]


def mirror_with_retry(
    url: str,
    bucket,
    http_client: httpx.Client,
    rate_limiter: RateLimiter,
) -> MirrorResult:
    """mirror_image, retrying transient failures up to MAX_ATTEMPTS with
    exponential backoff. Raises the last exception if every attempt fails
    (or immediately, unretried, for a non-transient failure)."""
    attempt = 0
    while True:
        attempt += 1
        rate_limiter.throttle()
        try:
            return mirror_image(url, bucket, http_client)
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status not in TRANSIENT_STATUS_CODES or attempt >= MAX_ATTEMPTS:
                raise
            logger.warning(
                "transient HTTP %d for %s (attempt %d/%d), retrying",
                status,
                url,
                attempt,
                MAX_ATTEMPTS,
            )
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            if attempt >= MAX_ATTEMPTS:
                raise
            logger.warning(
                "transient error for %s (attempt %d/%d): %s, retrying",
                url,
                attempt,
                MAX_ATTEMPTS,
                exc,
            )
        time.sleep(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))


def run_backfill(
    urls: list[str],
    bucket_name: str,
    rate: float = 3.0,
) -> ConservationReport:
    bucket = get_bucket(bucket_name)
    rate_limiter = RateLimiter(rate)
    report = ConservationReport(total=len(urls))

    with httpx.Client(timeout=DOWNLOAD_TIMEOUT_SECONDS) as http_client:
        for i, url in enumerate(urls, start=1):
            try:
                result = mirror_with_retry(url, bucket, http_client, rate_limiter)
                if result.uploaded:
                    report.uploaded += 1
                else:
                    report.already_present += 1
            except Exception as exc:  # noqa: BLE001 -- conservation: never drop a URL silently
                logger.error("failed to mirror %s: %s", url, exc)
                report.failures.append((url, f"{type(exc).__name__}: {exc}"))

            if i % PROGRESS_EVERY == 0 or i == len(urls):
                logger.info(
                    "progress: %d/%d (uploaded=%d, already_present=%d, failed=%d)",
                    i,
                    len(urls),
                    report.uploaded,
                    report.already_present,
                    report.failed,
                )

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="BL-76 Phase 2 card-image backfill")
    parser.add_argument(
        "--bucket",
        required=True,
        help="destination GCS bucket, e.g. swu-dev-jbapps-card-images",
    )
    parser.add_argument(
        "--rate",
        type=float,
        default=3.0,
        help="max CDN requests per second (default 3.0)",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="defaults to $DATABASE_URL",
    )
    args = parser.parse_args()

    if not args.database_url:
        parser.error("--database-url or $DATABASE_URL is required")

    urls = fetch_distinct_urls(args.database_url)
    logger.info("%d distinct image URLs to mirror into gs://%s", len(urls), args.bucket)

    report = run_backfill(urls, args.bucket, rate=args.rate)
    print(report.render())

    if report.failed:
        raise SystemExit(1)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    main()
