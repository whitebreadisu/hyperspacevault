import { authedFetch } from "./authedFetch";
import { ApiError, CodedApiError } from "./errors";

/** BL-205 (SWU_Application_Spec.md §19.1): owner-side share management --
 * create/list/rename/rotate/revoke, all authed. One row per tenant per
 * scope today (BL-205 ships `scope: "inventory"` only; `wanted`/`list` are
 * carried in the type so a later BL-206/BL-209 caller doesn't need a schema
 * change here either). */
export interface ShareRecord {
  id: number;
  name: string;
  scope: "inventory" | "wanted" | "list";
  token: string;
  created_at: string;
  revoked: boolean;
}

/** POST /api/shares' one closed error case: §19.1's "at most one active
 * share per scope target" -- the backend answers a second create attempt
 * with 409. Everything else (network, 401, 5xx) falls through to a plain
 * ApiError; ShareManageModal only needs to special-case this one. */
export type ShareApiErrorCode = "active_share_exists" | "unknown";

export class ShareApiError extends CodedApiError<ShareApiErrorCode> {
  constructor(code: ShareApiErrorCode, action: string, status: number) {
    super(
      code,
      code === "active_share_exists"
        ? "An active share already exists — rename or rotate it instead of creating a new one."
        : `${action} failed: ${status}`,
      status
    );
    this.name = "ShareApiError";
  }
}

/** GET /api/shares -- every share row the tenant owns (active and revoked
 * alike; ShareManageModal filters to the active `inventory`-scope row
 * itself, see its own doc comment for why the filter lives there rather
 * than here). */
export async function listShares(): Promise<ShareRecord[]> {
  const res = await authedFetch("/api/shares");
  if (!res.ok) throw new ApiError(`Failed to fetch shares: ${res.status}`, res.status);
  return res.json();
}

/** POST /api/shares — `name` is the owner-chosen, ≤30-char header label
 * (§19.1). Throws ShareApiError("active_share_exists") on 409 rather than a
 * generic ApiError so the modal can show the specific "you already have one"
 * message instead of "something went wrong." */
export async function createShare(name: string): Promise<ShareRecord> {
  const res = await authedFetch("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    if (res.status === 409)
      throw new ShareApiError("active_share_exists", "Creating share", res.status);
    throw new ShareApiError("unknown", "Creating share", res.status);
  }
  return res.json();
}

/** PATCH /api/shares/{id} — rename only; the token is unchanged (§19.1:
 * "rename ... cover[s] every use case a second concurrent share would"). */
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
