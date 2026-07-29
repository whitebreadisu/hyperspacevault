"""BL-76 Phase 2 (ADR-0012) tests for
app/ingestion/backfill_card_images.py.

No network, no real GCS, no DB -- the conservation-accounting logic and
retry/rate-limiting are exercised with mirror_with_retry/get_bucket
monkeypatched out. fetch_distinct_urls (the one function that touches a
real DB) is exercised separately, gated on DATABASE_URL like the rest of
this repo's DB-integration tests, against a small self-contained synthetic
insert (test_swuapi_ingestion_db.py's pattern) rather than assuming the
shared catalog fixture has any image URLs populated -- conftest's
seed_minimal_catalog does not set front_image_url/back_image_url.
"""

import os
import time

import httpx
import pytest
from sqlalchemy import text

from app.ingestion import backfill_card_images as backfill
from app.ingestion.image_mirror import MirrorResult

# --- ConservationReport ------------------------------------------------


def test_conservation_report_accounts_for_every_url():
    report = backfill.ConservationReport(total=5)
    report.uploaded = 3
    report.already_present = 1
    report.failures = [("https://example.com/a.png", "boom")]

    assert report.failed == 1
    assert report.accounted_for() == 5
    rendered = report.render()
    assert "total distinct URLs:  5" in rendered
    assert "uploaded (>=1 object): 3" in rendered
    assert "already present:       1" in rendered
    assert "failed:                1" in rendered
    assert "https://example.com/a.png -- boom" in rendered


def test_conservation_report_with_no_failures_omits_failure_section():
    report = backfill.ConservationReport(total=2, uploaded=2, already_present=0)
    assert "--- failures ---" not in report.render()


# --- RateLimiter ---------------------------------------------------------


def test_rate_limiter_throttles_to_configured_rate():
    limiter = backfill.RateLimiter(rate=20.0)  # 50ms min interval
    start = time.monotonic()
    limiter.throttle()
    limiter.throttle()
    limiter.throttle()
    elapsed = time.monotonic() - start
    # 2 intervals of >=50ms between 3 calls
    assert elapsed >= 0.09


def test_rate_limiter_zero_rate_never_blocks():
    limiter = backfill.RateLimiter(rate=0)
    start = time.monotonic()
    for _ in range(5):
        limiter.throttle()
    assert time.monotonic() - start < 0.05


# --- mirror_with_retry ----------------------------------------------------


def test_mirror_with_retry_retries_transient_http_errors_then_succeeds(monkeypatch):
    monkeypatch.setattr(backfill.time, "sleep", lambda _seconds: None)
    attempts = {"n": 0}
    success = MirrorResult(url="u", uploaded=["cards/x.png"], skipped=[])

    def fake_mirror_image(url, bucket, http_client):
        attempts["n"] += 1
        if attempts["n"] < 3:
            request = httpx.Request("GET", url)
            response = httpx.Response(503, request=request)
            raise httpx.HTTPStatusError("boom", request=request, response=response)
        return success

    monkeypatch.setattr(backfill, "mirror_image", fake_mirror_image)
    limiter = backfill.RateLimiter(rate=0)
    result = backfill.mirror_with_retry(
        "u", bucket=None, http_client=None, rate_limiter=limiter
    )

    assert result is success
    assert attempts["n"] == 3


def test_mirror_with_retry_gives_up_after_max_attempts(monkeypatch):
    monkeypatch.setattr(backfill.time, "sleep", lambda _seconds: None)

    def always_fails(url, bucket, http_client):
        request = httpx.Request("GET", url)
        response = httpx.Response(503, request=request)
        raise httpx.HTTPStatusError("boom", request=request, response=response)

    monkeypatch.setattr(backfill, "mirror_image", always_fails)
    limiter = backfill.RateLimiter(rate=0)

    with pytest.raises(httpx.HTTPStatusError):
        backfill.mirror_with_retry(
            "u", bucket=None, http_client=None, rate_limiter=limiter
        )


def test_mirror_with_retry_does_not_retry_non_transient_errors(monkeypatch):
    monkeypatch.setattr(backfill.time, "sleep", lambda _seconds: None)
    attempts = {"n": 0}

    def not_found(url, bucket, http_client):
        attempts["n"] += 1
        request = httpx.Request("GET", url)
        response = httpx.Response(404, request=request)
        raise httpx.HTTPStatusError("not found", request=request, response=response)

    monkeypatch.setattr(backfill, "mirror_image", not_found)
    limiter = backfill.RateLimiter(rate=0)

    with pytest.raises(httpx.HTTPStatusError):
        backfill.mirror_with_retry(
            "u", bucket=None, http_client=None, rate_limiter=limiter
        )
    assert attempts["n"] == 1  # no retry budget spent on a permanent failure


# --- run_backfill: end-to-end accounting with mirror_with_retry mocked ----


def test_run_backfill_accounts_for_every_url_uploaded_skipped_and_failed(monkeypatch):
    monkeypatch.setattr(backfill, "get_bucket", lambda _name: object())

    urls = [
        "https://cdn.example.com/uploaded.png",
        "https://cdn.example.com/present.png",
        "https://cdn.example.com/broken.png",
    ]

    def fake_mirror_with_retry(url, bucket, http_client, rate_limiter):
        if url.endswith("uploaded.png"):
            return MirrorResult(url=url, uploaded=["cards/uploaded.png"], skipped=[])
        if url.endswith("present.png"):
            return MirrorResult(url=url, uploaded=[], skipped=["cards/present.png"])
        raise RuntimeError("simulated permanent failure")

    monkeypatch.setattr(backfill, "mirror_with_retry", fake_mirror_with_retry)

    report = backfill.run_backfill(urls, bucket_name="fake-bucket", rate=0)

    assert report.total == 3
    assert report.uploaded == 1
    assert report.already_present == 1
    assert report.failed == 1
    assert report.failures[0][0] == "https://cdn.example.com/broken.png"
    assert "simulated permanent failure" in report.failures[0][1]
    assert report.accounted_for() == report.total


# --- fetch_distinct_urls (real DB, gated) ---------------------------------

pytestmark_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="requires DATABASE_URL -- run inside the backend container",
)

SET_CODE = "IT2"


@pytest.fixture
def synthetic_image_rows(db):
    """One set/base_card with 3 variants: a front-only URL, a shared
    front+back URL pair (the ~21-row real-world case ADR-0012 measured),
    and a null-URL variant -- exercises DISTINCT + IS NOT NULL together."""
    db.execute(
        text(
            "INSERT INTO sets (code, name, is_base_set) VALUES (:code, 'IT2 Set', false)"
        ),
        {"code": SET_CODE},
    )
    base_card_id = db.execute(
        text(
            "INSERT INTO base_cards (set_id, base_card_number, name, type, rarity, swuapi_id) "
            "VALUES ((SELECT id FROM sets WHERE code = :code), '1', 'IT2 Card', 'Unit', "
            "'Common', 'bf-test-base-1') RETURNING id"
        ),
        {"code": SET_CODE},
    ).scalar()
    variants = [
        ("bf-test-v1", "1", "https://example.com/bf-front-only.png", None),
        (
            "bf-test-v2",
            "2",
            "https://example.com/bf-shared.png",
            "https://example.com/bf-shared.png",
        ),
        ("bf-test-v3", "3", None, None),
    ]
    for swuapi_id, card_number, front_url, back_url in variants:
        db.execute(
            text(
                "INSERT INTO card_variants "
                "(base_card_id, variant_type, source_set_code, card_number, "
                "front_image_url, back_image_url, swuapi_id) "
                "VALUES (:base_card_id, 'Standard', :code, :card_number, "
                ":front_url, :back_url, :swuapi_id)"
            ),
            {
                "base_card_id": base_card_id,
                "code": SET_CODE,
                "card_number": card_number,
                "front_url": front_url,
                "back_url": back_url,
                "swuapi_id": swuapi_id,
            },
        )
    db.commit()
    yield
    db.rollback()
    db.execute(text("DELETE FROM card_variants WHERE swuapi_id LIKE 'bf-test-%'"))
    db.execute(text("DELETE FROM base_cards WHERE swuapi_id = 'bf-test-base-1'"))
    db.execute(text("DELETE FROM sets WHERE code = :code"), {"code": SET_CODE})
    db.commit()


@pytestmark_db
def test_fetch_distinct_urls_returns_only_non_null_urls(db, synthetic_image_rows):
    urls = backfill.fetch_distinct_urls(os.environ["DATABASE_URL"])
    assert "https://example.com/bf-front-only.png" in urls
    assert "https://example.com/bf-shared.png" in urls
    assert None not in urls
    assert len(urls) == len(set(urls))  # DISTINCT held -- the shared URL counts once
