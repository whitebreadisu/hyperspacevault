import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadShareSession, saveShareSession } from "./shareSession";

// BL-205: unit coverage for the share-session sessionStorage util, mirroring
// releaseNotesSeen.test.ts's "last-seen persistence" describe block shape
// (storage-available/denied/corrupt matrix) applied to this module's own
// load/save pair, plus the "newest replaces the previous" semantics
// §19.1 requires (no saved-shares list -- a single key is the whole
// mechanism, see the module's own doc comment).

const KEY = "swu.share.session";

describe("share session persistence (loadShareSession/saveShareSession)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadShareSession()).toBeNull();
  });

  it("round-trips a saved session", () => {
    saveShareSession({ token: "tok-1", name: "Bobs big vault" });
    expect(loadShareSession()).toEqual({ token: "tok-1", name: "Bobs big vault" });
  });

  it("newest share replaces the previous (single-key overwrite, no list)", () => {
    saveShareSession({ token: "tok-1", name: "First share" });
    saveShareSession({ token: "tok-2", name: "Second share" });

    expect(loadShareSession()).toEqual({ token: "tok-2", name: "Second share" });
    // Exactly one key -- nothing accumulates.
    expect(window.sessionStorage.length).toBe(1);
  });

  it("stores raw JSON under a single well-known key", () => {
    saveShareSession({ token: "tok-1", name: "Bobs big vault" });
    expect(window.sessionStorage.getItem(KEY)).toBe(
      JSON.stringify({ token: "tok-1", name: "Bobs big vault" })
    );
  });

  it("degrades to null for corrupt stored JSON", () => {
    window.sessionStorage.setItem(KEY, "not json");
    expect(loadShareSession()).toBeNull();
  });

  it("degrades to null for a stored value missing required fields", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ token: "tok-1" }));
    expect(loadShareSession()).toBeNull();
  });

  it("degrades to null when storage access throws (private-mode/storage-denied)", () => {
    const spy = vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(loadShareSession()).toBeNull();
    spy.mockRestore();
  });

  it("saveShareSession is best-effort -- a throwing storage write doesn't throw out to the caller", () => {
    const spy = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(() => saveShareSession({ token: "tok-1", name: "X" })).not.toThrow();
    spy.mockRestore();
  });
});
