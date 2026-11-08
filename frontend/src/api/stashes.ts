import { authedFetch } from "./authedFetch";
import { ApiError, CodedApiError } from "./errors";
import { EmailNotVerifiedError } from "./inventory";

// Stashes (App Spec §26). A stash is a named place outside the Vault for
// some owned copies; per printing, Vault = owned - sum(stash quantities),
// derived, never stored. Own vault only: every route is the caller's tenant
// (authedFetch); there is no shared-vault or public read of stash data.
// Reads are ungated; writes need a verified email (403 email_not_verified ->
// EmailNotVerifiedError, as inventory writes).

export interface Stash {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  /** Total stashed copies across every printing. */
  copies: number;
}

/** One sparse stash row; absent = 0. */
export interface StashItem {
  stash_id: number;
  variant_id: number;
  quantity: number;
  /** When copies of this printing last went into this stash (ISO; the row's
   * creation or its last quantity rise). The Stashes page's "Recently
   * stashed" sort. */
  stashed_at?: string;
}

export interface StashAllocation {
  stash_id: number;
  quantity: number;
}

export interface VariantAllocationResult {
  variant_id: number;
  owned: number;
  /** Non-zero allocations only. */
  allocations: StashAllocation[];
}

/** The contract's typed 409s plus the shape failures the UI branches on. */
export type StashErrorCode =
  | "duplicate_name"
  | "stash_limit"
  | "exceeds_owned"
  | "exceeds_stash"
  | "not_found"
  | "invalid"
  | "unknown";

export class StashApiError extends CodedApiError<StashErrorCode> {
  constructor(code: StashErrorCode, status: number) {
    super(code, `Stash request failed: ${code} (${status})`, status);
    this.name = "StashApiError";
  }
}

const KNOWN_409 = new Set<StashErrorCode>([
  "duplicate_name",
  "stash_limit",
  "exceeds_owned",
  "exceeds_stash",
]);

async function readDetail(res: Response): Promise<unknown> {
  try {
    return (await res.json())?.detail;
  } catch {
    return undefined;
  }
}

async function throwIfFailed(res: Response): Promise<void> {
  if (res.ok) return;
  const detail = await readDetail(res);
  if (res.status === 403 && detail === "email_not_verified") throw new EmailNotVerifiedError();
  if (res.status === 409 && typeof detail === "string" && KNOWN_409.has(detail as StashErrorCode))
    throw new StashApiError(detail as StashErrorCode, 409);
  if (res.status === 404) throw new StashApiError("not_found", 404);
  if (res.status === 422) throw new StashApiError("invalid", 422);
  throw new StashApiError("unknown", res.status);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** GET /api/stashes -- the caller's stashes in creation order. */
export async function getStashes(): Promise<Stash[]> {
  const res = await authedFetch("/api/stashes");
  if (!res.ok) throw new ApiError(`Failed to fetch stashes: ${res.status}`, res.status);
  return res.json();
}

/** GET /api/stashes/items -- every non-zero (stash, printing) quantity. */
export async function getStashItems(): Promise<StashItem[]> {
  const res = await authedFetch("/api/stashes/items");
  if (!res.ok) throw new ApiError(`Failed to fetch stash items: ${res.status}`, res.status);
  return res.json();
}

/** POST /api/stashes -- a new, empty stash (409 duplicate_name / stash_limit). */
export async function createStash(name: string, description?: string | null): Promise<Stash> {
  const body: { name: string; description?: string } = { name };
  if (description) body.description = description;
  const res = await authedFetch("/api/stashes", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  await throwIfFailed(res);
  return res.json();
}

/** PATCH /api/stashes/{id} -- rename / redescribe (409 duplicate_name). */
export async function updateStash(
  id: number,
  patch: { name?: string; description?: string | null }
): Promise<Stash> {
  const res = await authedFetch(`/api/stashes/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
  await throwIfFailed(res);
  return res.json();
}

/** DELETE /api/stashes/{id} -- its copies return to the Vault. */
export async function deleteStash(id: number): Promise<void> {
  const res = await authedFetch(`/api/stashes/${id}`, { method: "DELETE" });
  await throwIfFailed(res);
}

/** 409 `split_changed`: the stored split was not the `expected` one; nothing
 * was written. Carries the stored split and owned count. */
export class SplitChangedError extends Error {
  constructor(public readonly current: VariantAllocationResult) {
    super("Stash request failed: split_changed (409)");
    this.name = "SplitChangedError";
  }
}

/** PUT /api/stashes/variants/{variant_id} -- the printing's full split
 * (an omitted stash = 0). 409 exceeds_owned when the sum passes owned.
 * `expected` (optional): the split the caller last saw; when the stored one
 * differs, nothing is written and SplitChangedError carries it. */
export async function putVariantAllocations(
  variantId: number,
  allocations: StashAllocation[],
  opts: { expected?: StashAllocation[]; signal?: AbortSignal } = {}
): Promise<VariantAllocationResult> {
  const body: { allocations: StashAllocation[]; expected?: StashAllocation[] } = { allocations };
  if (opts.expected) body.expected = opts.expected;
  const res = await authedFetch(`/api/stashes/variants/${variantId}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 409) {
    const data = await res
      .clone()
      .json()
      .catch(() => null);
    if (data?.detail === "split_changed")
      throw new SplitChangedError({
        variant_id: data.variant_id,
        owned: data.owned,
        allocations: data.allocations ?? [],
      });
  }
  await throwIfFailed(res);
  return res.json();
}

/** One printing's quantity in a return / restore body or result. */
export interface StashMove {
  variant_id: number;
  quantity: number;
}

/** The stash after a return or restore: its remaining quantity for each
 * printing sent (0 when the row is gone) and its new total. */
export interface StashMoveResult {
  stash_id: number;
  copies: number;
  items: StashMove[];
}

async function moveItems(
  stashId: number,
  action: "return" | "restore",
  items: StashMove[]
): Promise<StashMoveResult> {
  const res = await authedFetch(`/api/stashes/${stashId}/${action}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  });
  await throwIfFailed(res);
  return res.json();
}

/** POST /api/stashes/{id}/return -- copies leave the stash for the Vault
 * (owned unchanged). 409 exceeds_stash when a quantity passes what the
 * stash holds (nothing written). */
export function returnStashItems(stashId: number, items: StashMove[]): Promise<StashMoveResult> {
  return moveItems(stashId, "return", items);
}

/** POST /api/stashes/{id}/restore -- the Undo of a return: copies go back
 * from the Vault into the stash. 409 exceeds_owned when the Vault no longer
 * holds enough copies (nothing written). */
export function restoreStashItems(stashId: number, items: StashMove[]): Promise<StashMoveResult> {
  return moveItems(stashId, "restore", items);
}
