import { authedFetch } from "./authedFetch";
import { ApiError, CodedApiError } from "./errors";

/** Owner-side share management (App Spec §19.1) -- create/list/rename/
 * rotate/revoke, all authed. At most one active share per scope target. Two
 * scopes are created: the vault link (`inventory`) and a stash's link
 * (`stash`, `target_id` = the stash id); `wanted`/`list` are carried in the
 * type (as in the backend enum) so a caller for those scopes needs no schema
 * change here. */
export interface ShareRecord {
  id: number;
  name: string;
  scope: "inventory" | "stash" | "wanted" | "list";
  token: string;
  created_at: string;
  revoked: boolean;
  /** Stash links: the stash id (null / absent on the vault link). */
  target_id?: number | null;
  /** Stash links: the stash's name when the list was read. */
  stash_name?: string | null;
}

/** POST /api/shares' closed error cases: App Spec §19.1's "at most one active
 * share per scope target" -- the backend answers a second create attempt
 * with 409 -- and a stash that is gone (404: deleted, or never the caller's).
 * Everything else (network, 401, 5xx) is "unknown"; ShareManageModal only
 * needs to special-case these. */
export type ShareApiErrorCode = "active_share_exists" | "stash_not_found" | "unknown";

export class ShareApiError extends CodedApiError<ShareApiErrorCode> {
  constructor(code: ShareApiErrorCode, action: string, status: number) {
    super(
      code,
      code === "active_share_exists"
        ? "An active share already exists — rename or rotate it instead of creating a new one."
        : code === "stash_not_found"
          ? "This stash no longer exists."
          : `${action} failed: ${status}`,
      status
    );
    this.name = "ShareApiError";
  }
}

/** GET /api/shares -- the caller's live links: the vault link first, then
 * each stash link in stash creation order (a stash link carries its stash's
 * `target_id` and current `stash_name`). The owner-links source
 * (shares/ShareLinksContext.tsx) still drops any `revoked` row, so an older
 * server that lists revoked rows reads the same. */
export async function listShares(): Promise<ShareRecord[]> {
  const res = await authedFetch("/api/shares");
  if (!res.ok) throw new ApiError(`Failed to fetch shares: ${res.status}`, res.status);
  return res.json();
}

/** POST /api/shares — `name` is the owner-chosen, ≤30-char header label
 * (§19.1). Without `stashId` it creates the vault link; with it, that
 * stash's link (its share name is fixed from then on). Throws
 * ShareApiError("active_share_exists") on 409 and ("stash_not_found") on a
 * stash create's 404 rather than a generic ApiError, so the window can say
 * what happened instead of "something went wrong." */
export async function createShare(name: string, stashId?: number): Promise<ShareRecord> {
  const res = await authedFetch("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stashId == null ? { name } : { name, stash_id: stashId }),
  });
  if (!res.ok) {
    if (res.status === 409)
      throw new ShareApiError("active_share_exists", "Creating share", res.status);
    if (res.status === 404 && stashId != null)
      throw new ShareApiError("stash_not_found", "Creating share", res.status);
    throw new ShareApiError("unknown", "Creating share", res.status);
  }
  return res.json();
}

/** PATCH /api/shares/{id} — rename only, the vault link only (a stash link's
 * share name is fixed at creation: the server answers 409
 * `share_name_fixed`); the token is unchanged (§19.1). */
export async function renameShare(id: number, name: string): Promise<ShareRecord> {
  const res = await authedFetch(`/api/shares/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new ApiError(`Failed to rename share: ${res.status}`, res.status);
  return res.json();
}

/** POST /api/shares/{id}/rotate — mints a new token; the old link 404s
 * immediately after (§19.1: "revoke-and-recreate is the rotation gesture,"
 * but rotate is the single-step version of that for an existing row).
 * ShareManageModal gates this behind its own "this kills the old link"
 * confirm before calling it. */
export async function rotateShare(id: number): Promise<ShareRecord> {
  const res = await authedFetch(`/api/shares/${id}/rotate`, { method: "POST" });
  if (!res.ok) throw new ApiError(`Failed to rotate share: ${res.status}`, res.status);
  return res.json();
}

/** DELETE /api/shares/{id} -- revokes immediately (§19.1's security
 * posture: "revocation is immediate"). 204 No Content, nothing to parse. */
export async function revokeShare(id: number): Promise<void> {
  const res = await authedFetch(`/api/shares/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(`Failed to revoke share: ${res.status}`, res.status);
}
