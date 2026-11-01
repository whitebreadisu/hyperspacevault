/** The single error convention for every frontend/src/api module: a non-2xx
 * response throws a typed instance of ApiError or CodedApiError below (or a
 * module subclass of one), never a bare Error. Plain status failures throw
 * ApiError itself; parsed-body errors that carry a machine-readable code
 * extend CodedApiError. See api/README.md for the convention writeup. */

/** Base for every typed API error in this app. Carries the HTTP status so
 * callers can branch on it (e.g. 401 -> "signed out", 403 -> a specific
 * gate) without parsing `.message`. Extend this directly for an endpoint
 * with no machine-readable error code -- the caller only needs pass/fail
 * plus status (see settingsLimits.ts's LimitsApiError, inventory.ts's
 * EmailNotVerifiedError). Extend CodedApiError instead when the backend's
 * router raises a closed set of typed errors the frontend needs to switch
 * on. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** ApiError plus a machine-readable `code`, for endpoints whose backend
 * router raises a closed union of typed errors (FastAPI's
 * `detail: {"error": "...", "message": "..."}` or a bare `detail: "<code>"`
 * string) that the frontend needs to switch on -- see deckCheck.ts's
 * DeckCheckApiError and inventoryImportExport.ts's ImportApiError for the
 * two response shapes this covers. `C` is each module's own closed string
 * union (the codes are endpoint-specific, not shared across modules) --
 * subclasses fix it to their own type rather than leaving it generic. */
export class CodedApiError<C extends string = string> extends ApiError {
  code: C;

  constructor(code: C, message: string, status: number) {
    super(message, status);
    this.name = "CodedApiError";
    this.code = code;
  }
}
