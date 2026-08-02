import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasUnread, latestEntryKey, loadLastSeenKey, saveLastSeenKey } from "./releaseNotesSeen";
import type { ReleaseNotesEntry } from "../content/releaseNotes";

// BL-184: unit coverage for the "New Arrivals" unread-tracking module,
// mirroring variantScope.test.ts's "price-kind persistence
// (loadPriceKind/savePriceKind)" describe block shape -- same storage-
// available/denied/corrupt matrix, applied to this module's own
// load/save pair and its derived hasUnread()/latestEntryKey() helpers.

const KEY = "swu.releaseNotes.lastSeen";

const ENTRIES: ReleaseNotesEntry[] = [
  {
    kind: "release",
    key: "1.3",
    version: "1.3",
    date: "2026-08-01",
    title: "Newest",
    sections: [],
  },
  { kind: "release", key: "1.2", version: "1.2", date: "2026-07-31", title: "Older", sections: [] },
];

describe("latestEntryKey", () => {
  it("returns the first entry's key (entries are stored newest-first)", () => {
    expect(latestEntryKey(ENTRIES)).toBe("1.3");
  });

  it("returns null for an empty list", () => {
    expect(latestEntryKey([])).toBeNull();
  });
});

describe("last-seen persistence (loadLastSeenKey/saveLastSeenKey)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadLastSeenKey()).toBeNull();
  });

  it("round-trips a saved key", () => {
    saveLastSeenKey("1.3");
    expect(window.localStorage.getItem(KEY)).toBe("1.3");
    expect(loadLastSeenKey()).toBe("1.3");
  });

  it("overwrites a previously saved key", () => {
    saveLastSeenKey("1.2");
    saveLastSeenKey("1.3");
    expect(loadLastSeenKey()).toBe("1.3");
  });

  it("degrades to null when storage access throws (private-mode/storage-denied)", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(loadLastSeenKey()).toBeNull();
    spy.mockRestore();
  });

  it("saveLastSeenKey is best-effort -- a throwing storage write doesn't throw out to the caller", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(() => saveLastSeenKey("1.3")).not.toThrow();
    spy.mockRestore();
  });
});

describe("hasUnread", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is true when nothing has ever been seen", () => {
    expect(hasUnread(ENTRIES)).toBe(true);
  });

  it("is false once the newest entry's key has been saved", () => {
    saveLastSeenKey("1.3");
    expect(hasUnread(ENTRIES)).toBe(false);
  });

  it("is true again once a newer entry ships (stale saved key)", () => {
    saveLastSeenKey("1.2");
    expect(hasUnread(ENTRIES)).toBe(true);
  });

  it("is false for an empty entry list (nothing to be unread about)", () => {
    expect(hasUnread([])).toBe(false);
  });

  it("degrades to true (unread-visible) when storage access throws -- never a silent false negative", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(hasUnread(ENTRIES)).toBe(true);
    spy.mockRestore();
  });

  it("degrades to a corrupt/unrecognized stored value by treating it as unread", () => {
    window.localStorage.setItem(KEY, "bogus-key-not-in-entries");
    expect(hasUnread(ENTRIES)).toBe(true);
  });
});
