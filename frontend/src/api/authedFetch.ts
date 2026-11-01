import { auth } from "../firebase";

/** fetch() that attaches the current Firebase user's ID token as a Bearer
 * token, if signed in. Most /api/* calls go through this. The tenant
 * routes (inventory, settings, shares, deck check, account) require the
 * Authorization header; the optional-auth routes (base-card detail,
 * feedback) use it when present (ADR-0008) -- the detail endpoint returns
 * real per-tenant quantities when signed in, zeros when not -- and pure
 * catalog reads ignore it. */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();

  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(url, { ...init, headers });
}
