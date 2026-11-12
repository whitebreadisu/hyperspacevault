import { ApiError, CodedApiError } from "./errors";
import type { VariantQuantity } from "./inventory";
import type { LimitsResponseBody } from "./settingsLimits";

/** The viewer-mode read surface (App Spec §19.1) -- three token-scoped
 * endpoints, none requiring auth (plain `fetch`, not `authedFetch` -- they
 * are the platform's unauthenticated read of tenant data, and it must stay
 * that way regardless of whether the caller happens to be signed into their
 * OWN account in this browser). Callers
 * never attach a Firebase token here on purpose: the shared data belongs to
 * the share's owner-tenant, not whoever is viewing it. */

export interface ShareResolution {
  name: string;
  scope: "inventory" | "wanted" | "list";
}

/** App Spec §19.1: "invalid and revoked tokens are indistinguishable (404)" -- the
 * frontend never tries to tell those apart either, `not_found` covers both.
 * `rate_limited` surfaces the endpoint's per-IP limiter (§19.1's security
 * posture); `unknown` is any other non-2xx (5xx, network-adjacent). Mirrors
 * inventoryImportExport.ts's ImportApiError shape (CodedApiError over a
 * closed code union) since this endpoint's callers need to branch on the
 * distinction (SharedVaultPage and the phone's useShare show a separate
 * rate-limited message) rather than just pass/fail. */
export type ShareResolveErrorCode = "not_found" | "rate_limited" | "unknown";

export class ShareResolveError extends CodedApiError<ShareResolveErrorCode> {
  /** Present only for `rate_limited`, when the response carried a
   * Retry-After header. The UI does not show it (the rate-limited message is
   * static); it is carried so a "try again in Ns" message needs no API-layer
   * change. */
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
  throw shareError(res);
}

/** A failed share read's coded error: 429 (with its Retry-After), 404, or
 * anything else. */
function shareError(res: Response): ShareResolveError {
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const seconds = retryAfter !== null ? Number(retryAfter) : undefined;
    return new ShareResolveError(
      "rate_limited",
      res.status,
      Number.isNaN(seconds) ? undefined : seconds
    );
  }
  if (res.status === 404) return new ShareResolveError("not_found", res.status);
  return new ShareResolveError("unknown", res.status);
}

/** A stash link's client route: `/shared/stash/{token}`, distinct from the
 * vault link's `/shared/{token}` (App Spec §19.1). The server's resolve and
 * vault reads answer 404 for a stash token, so the route -- never a resolve
 * fallback -- says which read a token takes. Hosting already serves the app
 * and the noindex header for every `/shared/**` path (firebase.json). */
export const STASH_SHARE_PREFIX = "/shared/stash/";

/** The link the owner copies for a stash share. `origin` defaults to this
 * page's own (pass one in tests or for another host). The one builder: the
 * owner's share window calls it, and utils/shareRoute.ts parses it back. */
export function stashShareUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}${STASH_SHARE_PREFIX}${encodeURIComponent(token)}`;
}

/** One printing in a shared stash (GET /api/shared/{token}/stash): its
 * count in the stash, when it went in (ISO) and its unit prices. */
export interface SharedStashRow {
  variant_id: number;
  quantity: number;
  stashed_at: string;
  market: number | null;
  low: number | null;
}

/** A stash link's whole viewer read: the share name, the stash's own name
 * and description, its printing rows and totals -- never any vault data or
 * another stash. */
export interface SharedStashView {
  share_name: string;
  stash: { name: string; description: string | null };
  rows: SharedStashRow[];
  totals: { printings: number; copies: number; value_market: number; value_low: number };
}

/** The viewer label for a stash link -- the header pod's and the phone vault
 * switch's text: "<share name> · <stash name>". */
export function stashShareLabel(view: Pick<SharedStashView, "share_name" | "stash">): string {
  return `${view.share_name} · ${view.stash.name}`;
}

/** GET /api/shared/{token}/stash. Same error codes as resolveShare: revoked,
 * unknown and deleted-stash links are one indistinguishable 404. */
export async function getSharedStash(token: string): Promise<SharedStashView> {
  const res = await fetch(`/api/shared/${encodeURIComponent(token)}/stash`);
  if (res.ok) return res.json();
  throw shareError(res);
}

/** variant_id -> in-stash count, the quantities a stash viewer's catalogue
 * is merged with (useVaultDataSource's `fixedQuantities`). */
export function stashQuantities(view: SharedStashView): Record<number, number> {
  const map: Record<number, number> = {};
  for (const r of view.rows) if (r.quantity > 0) map[r.variant_id] = r.quantity;
  return map;
}

/** GET /api/shared/{token}/quantities -- same sparse variant_id -> quantity
 * shape as api/inventory.ts's getQuantities(), for the share's owner-tenant
 * rows instead of the caller's own. A generic ApiError (not a coded one) is
 * enough here: vault/useVaultData.ts surfaces any failure through the same
 * catch-all `error` state the catalog fetch uses -- there's no per-code
 * branching to do once resolveShare above has already established the token
 * is valid. */
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
