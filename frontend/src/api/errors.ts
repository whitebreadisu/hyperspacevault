/** BL-154 (audit finding A3-07): the single error convention for every
 * frontend/src/api module going forward. Before this, three conventions
 * coexisted -- ad hoc `throw new Error(\`...: ${res.status}\`)` status-string
 * throws (account.ts, baseCards.ts, feedback.ts, inventory.ts, sets.ts), a
 * typed-with-status class with its own bespoke shape (settingsLimits.ts's
 * LimitsApiError), and parsed-body typed errors that read the response's
 * `detail` for a machine-readable code (deckCheck.ts's DeckCheckApiError,
 * inventoryImportExport.ts's ImportApiError). ApiError/CodedApiError below
 * generalize the latter two into one hierarchy -- every module's typed
 * error now extends one of them, and the status-string modules were
 * migrated onto ApiError too (the change is mechanical: same message text,
 * now carried by a typed instance instead of a bare Error). See
 * api/README.md for the full convention writeup and migration policy. */

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
