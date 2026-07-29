import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

/** BL-25: the two type categories of the keep-limit matrix (BL-24 backend
 * vocabulary -- app/schemas/settings_schema.py's TypeCategory Literal).
 * "singleton" = Leader/Base cards (code default 1); "standard" = everything
 * else (code default 3). */
export type TypeCategory = "singleton" | "standard";

/** One (type_category, limit_bucket) cell of the effective limits matrix as
 * GET/PUT /api/settings/limits return it. max_quantity null means "No limit"
 * (explicitly unconstrained -- distinct from the code default); is_default
 * true means no override row exists for the cell (the value shown is the
 * code default). */
export interface LimitCell {
  type_category: TypeCategory;
  limit_bucket: string;
  max_quantity: number | null;
  is_default: boolean;
}

/** One row of a PUT /api/settings/limits body -- an override cell. The PUT
 * is a full replacement of the tenant's override set: send ONLY cells that
 * differ from the code defaults (an empty list resets everything). */
export interface LimitOverrideInput {
  type_category: TypeCategory;
  limit_bucket: string;
  max_quantity: number | null;
}

/** BL-35: the tenant's keep-limit enforcement mode. "hard" (default) blocks
 * an increment at/over a variant's effective limit; "soft" commits it and
 * flags the response over_limit=True instead (app/services/inventory.py's
 * increment_card). Mirrors the backend's CapMode Literal
 * (app/schemas/settings_schema.py). */
export type CapMode = "hard" | "soft";

/** The full body both GET and PUT /api/settings/limits return -- the
 * effective matrix plus the tenant's current cap_mode, in one round trip
 * (BL-35 extended the existing endpoints rather than adding new ones). */
export interface LimitsResponseBody {
  limits: LimitCell[];
  cap_mode: CapMode;
}

/** Thrown on a non-2xx settings-limits response, carrying the HTTP status so
 * the settings UI can distinguish 401 (signed out / expired session) from
 * 422 (invalid override set -- unreachable with a correct client) and
 * generic failures. BL-154: extends the shared ApiError base (api/errors.ts)
 * rather than Error directly -- this class already carried a `status` field
 * before BL-154, so it was one of the two modules the audit called "already
 * typed"; only its base class changed here. */
export class LimitsApiError extends ApiError {
  constructor(action: string, status: number) {
    super(`${action} failed: ${status}`, status);
    this.name = "LimitsApiError";
  }
}

/** BL-25: the FULL effective limits matrix -- every canonical bucket x both
 * categories (15 buckets x 2 = 30 cells), code defaults merged with the
 * tenant's overrides server-side -- plus (BL-35) the tenant's cap_mode.
 * Auth required. */
export async function getLimits(): Promise<LimitsResponseBody> {
  const res = await authedFetch("/api/settings/limits");
  if (!res.ok) throw new LimitsApiError("Fetching limits", res.status);
  return (await res.json()) as LimitsResponseBody;
}

/** BL-25: full replacement of the tenant's override set, plus (BL-35) an
 * OPTIONAL cap_mode change -- omit to leave the tenant's current cap_mode
 * untouched (mirrors the backend's absent-means-unchanged PUT semantics).
 * Returns the new effective body (same shape as getLimits), which callers
 * should re-render from rather than trusting their own optimistic state. */
export async function putLimits(
  overrides: LimitOverrideInput[],
  capMode?: CapMode
): Promise<LimitsResponseBody> {
  const res = await authedFetch("/api/settings/limits", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limits: overrides,
      ...(capMode !== undefined ? { cap_mode: capMode } : {}),
    }),
  });
  if (!res.ok) throw new LimitsApiError("Saving limits", res.status);
  return (await res.json()) as LimitsResponseBody;
}
