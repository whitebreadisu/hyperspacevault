import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

/** BL-87: purges every Postgres row for the caller's own tenant
 * (inventory, users, tenants). Idempotent server-side (204 even if
 * nothing is left to delete) -- this just surfaces a non-2xx status as a
 * thrown error so DeleteAccountModal's purge step can distinguish
 * "purge failed, account intact" from success. */
export async function deleteAccount(): Promise<void> {
  const res = await authedFetch("/api/account", { method: "DELETE" });
  // BL-154: migrated from a bare `throw new Error`.
  if (!res.ok) throw new ApiError(`Account deletion failed: ${res.status}`, res.status);
}
