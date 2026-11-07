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
  "duplicate_name" | "stash_limit" | "exceeds_owned" | "not_found" | "invalid" | "unknown";

export class StashApiError extends CodedApiError<StashErrorCode> {
  constructor(code: StashErrorCode, status: number) {
    super(code, `Stash request failed: ${code} (${status})`, status);
    this.name = "StashApiError";
  }
}

const KNOWN_409 = new Set<StashErrorCode>(["duplicate_name", "stash_limit", "exceeds_owned"]);

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

/** PATCH /api/stashes/{id} -- rename / redescribe (UI is slice 2). */
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

/** DELETE /api/stashes/{id} -- its copies return to the Vault (UI is slice 2). */
export async function deleteStash(id: number): Promise<void> {
  const res = await authedFetch(`/api/stashes/${id}`, { method: "DELETE" });
  await throwIfFailed(res);
}

/** PUT /api/stashes/variants/{variant_id} -- the printing's full split
 * (an omitted stash = 0). 409 exceeds_owned when the sum passes owned. */
export async function putVariantAllocations(
  variantId: number,
  allocations: StashAllocation[]
): Promise<VariantAllocationResult> {
  const res = await authedFetch(`/api/stashes/variants/${variantId}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ allocations }),
  });
  await throwIfFailed(res);
  return res.json();
}
