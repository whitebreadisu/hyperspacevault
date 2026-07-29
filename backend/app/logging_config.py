import json
import logging
import sys
import traceback
from datetime import datetime, timezone

# Fields Cloud Logging recognizes as "special fields" and promotes onto the
# LogEntry itself (rather than leaving them inside jsonPayload): severity,
# message, httpRequest, time. Everything else in the payload becomes a
# queryable jsonPayload.<key> field.
_EXTRA_FIELDS = ("httpRequest", "tenant_id")


class JSONFormatter(logging.Formatter):
    """Formats a LogRecord as a single JSON line for Cloud Logging.

    record.levelname (DEBUG/INFO/WARNING/ERROR/CRITICAL) maps directly onto
    Cloud Logging's severity values -- no translation needed. If exc_info is
    present, the formatted traceback is appended to "message" so Cloud Error
    Reporting can detect and group it.
    """

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        if record.exc_info:
            message += "\n" + "".join(traceback.format_exception(*record.exc_info))

        payload = {
            "severity": record.levelname,
            "message": message,
            "logger": record.name,
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
        }
        for key in _EXTRA_FIELDS:
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload)


def configure_logging() -> None:
    """Route all logging through a single JSON handler on stdout.

    Cloud Run forwards container stdout/stderr to Cloud Logging already --
    this changes *what* gets written, not whether it arrives. uvicorn's own
    "uvicorn.access" logger is disabled in favor of the request-logging
    middleware (app/middleware.py), which emits one structured line per
    request including tenant_id; "uvicorn"/"uvicorn.error" are routed through
    the same JSON handler so startup/shutdown messages are structured too.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)

    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = []
        uv_logger.propagate = True
