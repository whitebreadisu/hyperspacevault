import { afterEach, describe, expect, it, vi } from "vitest";
import { markGoogleRedirectPending, takeGoogleRedirectPending } from "./googleAuth";

// BL-263: the redirect-pending mark decides whether a page load contacts
// apis.google.com at all (AuthContext's getRedirectResult call).
describe("Google redirect-pending mark", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("is absent on a normal load", () => {
    expect(takeGoogleRedirectPending()).toBe(false);
  });

  it("is read once after a redirect is marked, then cleared", () => {
    markGoogleRedirectPending();
    expect(takeGoogleRedirectPending()).toBe(true);
    expect(takeGoogleRedirectPending()).toBe(false);
  });

  it("answers true when storage cannot be read, so a redirect result is never dropped", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(takeGoogleRedirectPending()).toBe(true);
  });

  it("does not throw when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => markGoogleRedirectPending()).not.toThrow();
  });
});
