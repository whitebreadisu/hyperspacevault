"""P6 stage 1: structured JSON logging."""

import json
import logging

from app.logging_config import JSONFormatter


def _make_record(**kwargs) -> logging.LogRecord:
    defaults = dict(
        name="app.request",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request completed",
        args=(),
        exc_info=None,
    )
    defaults.update(kwargs)
    return logging.LogRecord(**defaults)


def test_formats_basic_fields_as_json():
    record = _make_record()
    payload = json.loads(JSONFormatter().format(record))

    assert payload["severity"] == "INFO"
    assert payload["message"] == "request completed"
    assert payload["logger"] == "app.request"
    assert "time" in payload


def test_includes_http_request_and_tenant_id_extras():
    record = _make_record(
        msg="request completed",
    )
    record.httpRequest = {
        "requestMethod": "GET",
        "requestUrl": "/api/inventory/quantities",
        "status": 200,
        "latency": "0.042s",
    }
    record.tenant_id = 3

    payload = json.loads(JSONFormatter().format(record))

    assert payload["httpRequest"]["status"] == 200
    assert payload["httpRequest"]["requestUrl"] == "/api/inventory/quantities"
    assert payload["tenant_id"] == 3


def test_exception_traceback_appended_to_message():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _make_record(
            level=logging.ERROR, msg="request failed", exc_info=sys.exc_info()
        )

    payload = json.loads(JSONFormatter().format(record))

    assert payload["severity"] == "ERROR"
    assert "request failed" in payload["message"]
    assert "ValueError: boom" in payload["message"]
    assert "Traceback (most recent call last)" in payload["message"]


def test_request_completed_logged_with_tenant_id(client, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        response = client.get("/api/inventory/quantities")

    assert response.status_code == 200
    records = [r for r in caplog.records if r.name == "app.request"]
    assert len(records) == 1

    record = records[0]
    assert record.message == "request completed"
    assert record.httpRequest["requestUrl"] == "/api/inventory/quantities"
    assert record.httpRequest["status"] == 200
    assert record.tenant_id == 1


def test_unauthenticated_request_logs_null_tenant_id(caplog):
    from fastapi.testclient import TestClient

    from app.main import app

    with caplog.at_level(logging.WARNING, logger="app.request"):
        response = TestClient(app).get("/api/inventory/quantities")

    assert response.status_code == 401
    records = [r for r in caplog.records if r.name == "app.request"]
    assert len(records) == 1
    assert records[0].tenant_id is None
    assert records[0].httpRequest["status"] == 401
