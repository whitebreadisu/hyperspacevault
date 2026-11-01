import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

/** Purges every Postgres row the caller's own tenant owns (App Spec §12,
 * Account). Idempotent server-side (204 even if nothing is left to
 * delete) -- this just surfaces a non-2xx status as a thrown error so
 * DeleteAccountModal's purge step can distinguish "purge failed, account
 * intact" from success. */
export async function deleteAccount(): Promise<void> {
  const res = await authedFetch("/api/account", { method: "DELETE" });
  if (!res.ok) throw new ApiError(`Account deletion failed: ${res.status}`, res.status);
}
