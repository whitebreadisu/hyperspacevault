import { describe, expect, it, vi } from "vitest";

// BL-263 (2.0.1): getAuth() wires the popup/redirect resolver in at start-up,
// and on phones and Safari the SDK then waits on https://apis.google.com
// before it restores the session ("Loading..." for as long as Google takes).
// This pins the fix: Auth starts with getAuth()'s persistence list and NO
// resolver; the resolver is only exported for the Google sign-in calls.
const { initializeAuth, getAuth, resolver, idb, local, session } = vi.hoisted(() => ({
  initializeAuth: vi.fn(() => ({})),
  getAuth: vi.fn(() => ({})),
  resolver: { resolver: "popup-redirect" },
  idb: { type: "indexedDB" },
  local: { type: "local" },
  session: { type: "session" },
}));

vi.mock("firebase/app", () => ({ initializeApp: vi.fn(() => ({ name: "app" })) }));
vi.mock("firebase/auth", () => ({
  initializeAuth,
  getAuth,
  connectAuthEmulator: vi.fn(),
  browserPopupRedirectResolver: resolver,
  indexedDBLocalPersistence: idb,
  browserLocalPersistence: local,
  browserSessionPersistence: session,
}));

describe("firebase auth initialisation (BL-263)", () => {
  it("initialises Auth without the popup/redirect resolver, with getAuth()'s persistence order", async () => {
    const mod = await import("./firebase");
    expect(getAuth).not.toHaveBeenCalled();
    expect(initializeAuth).toHaveBeenCalledTimes(1);
    const options = (initializeAuth.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(options).not.toHaveProperty("popupRedirectResolver");
    expect(options.persistence).toEqual([idb, local, session]);
    expect(mod.googleResolver).toBe(resolver);
  });
});
