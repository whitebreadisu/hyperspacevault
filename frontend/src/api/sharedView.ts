import { ApiError, CodedApiError } from "./errors";
import type { VariantQuantity } from "./inventory";
import type { LimitsResponseBody } from "./settingsLimits";

/** BL-205 (SWU_Application_Spec.md §19.1): the viewer-mode read surface --
 * three token-scoped endpoints, none requiring auth (plain `fetch`, not
 * `authedFetch` -- this is the platform's first unauthenticated read of
 * tenant data, and it must stay that way regardless of whether the caller
 * happens to be signed into their OWN account in this browser). Callers
 * never attach a Firebase token here on purpose: the shared data belongs to
 * the share's owner-tenant, not whoever is viewing it. */

export interface ShareResolution {
  name: string;
  scope: "inventory" | "wanted" | "list";
}

/** §19.1: "invalid and revoked tokens are indistinguishable (404)" -- the
 * frontend never tries to tell those apart either, `not_found` covers both.
 * `rate_limited` surfaces the endpoint's per-IP limiter (§19.1's security
 * posture); `unknown` is any other non-2xx (5xx, network-adjacent). Mirrors
 * inventoryImportExport.ts's ImportApiError shape (CodedApiError over a
 * closed code union) since this endpoint's callers need to branch on the
 * distinction (SharedVaultPage renders a different message per code) rather
 * than just pass/fail. */
export type ShareResolveErrorCode = "not_found" | "rate_limited" | "unknown";

export class ShareResolveError extends CodedApiError<ShareResolveErrorCode> {
  /** Present only for `rate_limited`, when the response carried a
   * Retry-After header. Not currently surfaced in the UI (SharedVaultPage's
   * message is static) -- carried through anyway so a future round can show
   * "try again in Ns" without another API-layer change. */
  retryAfterSeconds?: number;

  constructor(code: ShareResolveErrorCode, status: number, retryAfterSeconds?: number) {
    super(code, `Failed to resolve share: ${status}`, status);
    this.name = "ShareResolveError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** GET /api/shared/{token} -- resolves a share link to its owner-chosen
 * name (the viewer's header label, §19.1) and scope. `token` is
 * URL-encoded defensively; in practice it's already URL-safe (the backend
 * mints ≥128-bit URL-safe random tokens) but a route param arriving via
 * `window.location.pathname` shouldn't be trusted to skip escaping. */
export async function resolveShare(token: string): Promise<ShareResolution> {
  const res = await fetch(`/api/shared/${encodeURIComponent(token)}`);
  if (res.ok) return res.json();

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const seconds = retryAfter !== null ? Number(retryAfter) : undefined;
    throw new ShareResolveError(
      "rate_limited",
      res.status,
      Number.isNaN(seconds) ? undefined : seconds
    );
  }
  if (res.status === 404) throw new ShareResolveError("not_found", res.status);
  throw new ShareResolveError("unknown", res.status);
}

/** GET /api/shared/{token}/quantities -- same sparse variant_id -> quantity
 * shape as api/inventory.ts's getQuantities(), for the share's owner-tenant
 * rows instead of the caller's own. A generic ApiError (not a coded one) is
 * enough here: SharedVaultPage/CardsPage surface any failure through the
 * same catch-all `error` state the catalog fetch already uses -- there's no
 * per-code branching to do once resolveShare above has already established
 * the token is valid. */
export async function getSharedQuantities(token: string): Promise<VariantQuantity[]> {
  const res = await fetch(`/api/shared/${encodeURIComponent(token)}/quantities`);
  if (!res.ok) throw new ApiError(`Failed to fetch shared quantities: ${res.status}`, res.status);
  return res.json();
}

/** GET /api/shared/{token}/limits -- same shape as api/settingsLimits.ts's
 * getLimits(), for the share's owner-tenant limits instead of the caller's
 * own (needed for the Vault's playset/keep-limit display math -- see
 * LimitsContext's `shareToken` prop). */
export async function getSharedLimits(token: string): Promise<LimitsResponseBody> {
  const res = await fetch(`/api/shared/${encodeURIComponent(token)}/limits`);
  if (!res.ok) throw new ApiError(`Failed to fetch shared limits: ${res.status}`, res.status);
  return res.json();
}
