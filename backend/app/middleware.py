import logging
import time

from fastapi import Request

logger = logging.getLogger("app.request")


async def log_requests(request: Request, call_next):
    """Emit one structured log line per request.

    tenant_id comes from request.state, set by get_db() once the caller's
    identity resolves to a tenant -- requests that never reach get_db (e.g.
    a 401 from get_current_identity, or /health) log tenant_id: null.
    severity reflects the response status so Cloud Monitoring/Error
    Reporting can filter on it directly (see logging_config.JSONFormatter).
    """
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.error(
            "request failed",
            exc_info=True,
            extra={
                "httpRequest": {
                    "requestMethod": request.method,
                    "requestUrl": request.url.path,
                    "status": 500,
                    "latency": f"{duration_ms / 1000:.3f}s",
                },
                "tenant_id": getattr(request.state, "tenant_id", None),
            },
        )
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    extra = {
        "httpRequest": {
            "requestMethod": request.method,
            "requestUrl": request.url.path,
            "status": response.status_code,
            "latency": f"{duration_ms / 1000:.3f}s",
        },
        "tenant_id": getattr(request.state, "tenant_id", None),
    }
    if response.status_code >= 500:
        logger.error("request completed", extra=extra)
    elif response.status_code >= 400:
        logger.warning("request completed", extra=extra)
    else:
        logger.info("request completed", extra=extra)

    return response


# BL-157/A4-14: a fixed set of response-hardening headers on every response
# this backend serves -- /api/** JSON and the /images/** bucket-relay
# redirect both go through the same app, so one middleware covers both path
# families the backlog item names. Prod already gets HSTS from the Firebase
# Hosting/Google Frontend layer in front of this service (confirmed via a
# live curl capture, see PR description) -- this middleware sets it too so
# the header is guaranteed present even if the Hosting rewrite path or CDN
# in front of it ever changes, and adds the four headers Hosting does NOT
# currently emit for the /api/**​ and /images/** rewrites:
#   - X-Content-Type-Options: nosniff -- stop MIME-sniffing a JSON/redirect
#     response as something else.
#   - X-Frame-Options: DENY -- this origin never needs to be framed.
#   - Referrer-Policy: no-referrer -- no reason for this API's URLs (which
#     can carry no secrets, but still) to leak into a Referer header.
# No Content-Security-Policy: deliberate. This backend serves JSON (and a
# 307 redirect to the CDN for images) -- there is no HTML surface on this
# origin for a CSP to protect (the actual HTML is the separate frontend
# origin, Firebase Hosting's static bundle, out of this backend's control).
# Revisit if this backend ever starts serving HTML directly.
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Strict-Transport-Security"] = (
        "max-age=31536000; includeSubDomains"
    )
    return response
