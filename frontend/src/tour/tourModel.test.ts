import { describe, expect, it } from "vitest";
import { FEATURE_TOURS } from "../content/featureTours";
import type { FeatureTour } from "../content/featureTours";
import {
  TOUR_SEEN_KEY,
  TOUR_SKIPPED_KEY,
  activeTour,
  buildPageList,
  canSkip,
  compareVersions,
  countLabel,
  createdBefore,
  eligible,
  isSeen,
  loadTourRecord,
  majorMinor,
  placeTip,
  primaryLabel,
  saveTourRecord,
  withSeen,
  withSkipped,
} from "./tourModel";
import type { EligibilityInput, Rect, TourRecord } from "./tourModel";

// The feature tour's rules (App Spec §20, "Feature tour"), against the real
// v2.5 tour data and small hand-made tours.

const V25 = FEATURE_TOURS.find((t) => t.version === "2.5")!;
const EMPTY: TourRecord = { seen: {}, skipped: {} };
const all = () => true;

function memoryStore(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
  };
}

describe("activeTour", () => {
  const tours: FeatureTour[] = [
    { version: "2.5", since: "2026-11-12", tips: [] },
    { version: "2.10", since: "2027-01-01", tips: [] },
  ];

  it("majorMinor and compareVersions read major.minor numerically", () => {
    expect(majorMinor("2.4.0")).toBe("2.4");
    expect(majorMinor("2.10.3")).toBe("2.10");
    expect(compareVersions("2.10", "2.9")).toBeGreaterThan(0);
    expect(compareVersions("2.5", "2.5")).toBe(0);
  });

  it("a prod build runs only the tour of its own major.minor", () => {
    expect(activeTour(tours, { appVersion: "2.5.0", prodBuild: true })?.version).toBe("2.5");
    expect(activeTour(tours, { appVersion: "2.5.3", prodBuild: true })?.version).toBe("2.5");
    // An unflagged release: no tour carries its version.
    expect(activeTour(tours, { appVersion: "2.4.0", prodBuild: true })).toBeNull();
    expect(activeTour(tours, { appVersion: "2.6.0", prodBuild: true })).toBeNull();
  });

  it("a non-prod build previews the newest tour at or ahead of the app", () => {
    expect(activeTour(tours, { appVersion: "2.4.0", prodBuild: false })?.version).toBe("2.10");
    expect(activeTour(tours, { appVersion: "2.10.0", prodBuild: false })?.version).toBe("2.10");
    // Behind the app: an old tour does not come back on dev.
    expect(activeTour(tours, { appVersion: "2.11.0", prodBuild: false })).toBeNull();
  });

  it("a test run has no tour unless an override turns one on", () => {
    const base = { appVersion: "2.4.0", prodBuild: false, testMode: true };
    expect(activeTour(tours, base)).toBeNull();
    expect(activeTour(tours, { ...base, override: { on: true } })?.version).toBe("2.10");
    expect(activeTour(tours, { ...base, override: { on: true, since: "2999-01-01" } })?.since).toBe(
      "2999-01-01"
    );
    // Off wins even on a build that would otherwise run one.
    expect(
      activeTour(tours, { appVersion: "2.5.0", prodBuild: true, override: { on: false } })
    ).toBeNull();
  });

  it("the v2.5 tour has the approved shape", () => {
    expect(V25.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(V25.tips.map((t) => [t.id, t.page, t.enabled])).toEqual([
      ["stashes-nav", "collection", true],
      ["stash-copies", "card", true],
      ["stashed-copies", "card", true],
      ["share-card", "card", true],
      ["stashes-page", "stashes", true],
      // Live since stash sharing's owner screens (v2.5).
      ["share-stash", "stashes", true],
    ]);
  });
});

describe("eligibility", () => {
  const ok: EligibilityInput = {
    tour: V25,
    signedIn: true,
    creationTime: "Mon, 01 Jun 2026 10:00:00 GMT",
    sharedView: false,
    newerBuild: false,
    storageOk: true,
  };

  it("a returning signed-in user on the own vault sees tips", () => {
    expect(eligible(ok)).toBe(true);
  });

  it("signed out: no tips", () => {
    expect(eligible({ ...ok, signedIn: false, creationTime: null })).toBe(false);
  });

  it("a shared-vault view: no tips", () => {
    expect(eligible({ ...ok, sharedView: true })).toBe(false);
  });

  it("an account created on or after the tour's date is new: no tips", () => {
    const since = `${V25.since}T00:00:00Z`;
    expect(eligible({ ...ok, creationTime: new Date(since).toUTCString() })).toBe(false);
    expect(eligible({ ...ok, creationTime: "Wed, 01 Dec 2027 00:00:00 GMT" })).toBe(false);
    expect(createdBefore("Wed, 11 Nov 2026 23:59:59 GMT", "2026-11-12")).toBe(true);
    expect(createdBefore("garbage", "2026-11-12")).toBe(false);
    expect(createdBefore(undefined, "2026-11-12")).toBe(false);
  });

  it("the update banner up (a newer build known): no tips", () => {
    expect(eligible({ ...ok, newerBuild: true })).toBe(false);
  });

  it("storage unavailable: no tips", () => {
    expect(eligible({ ...ok, storageOk: false })).toBe(false);
  });

  it("an unflagged release (no tour): no tips", () => {
    expect(eligible({ ...ok, tour: null })).toBe(false);
  });
});

describe("the per-browser record", () => {
  it("reads, re-saves and writes the two keys", () => {
    const s = memoryStore({
      [TOUR_SEEN_KEY]: JSON.stringify({ "2.5": ["stashes-nav", 4] }),
      [TOUR_SKIPPED_KEY]: JSON.stringify({ "2.4": true, "2.3": "yes" }),
    });
    const rec = loadTourRecord(() => s)!;
    expect(rec).toEqual({ seen: { "2.5": ["stashes-nav"] }, skipped: { "2.4": true } });
    const next = withSkipped(withSeen(rec, "2.5", "share-card"), "2.5");
    saveTourRecord(() => s, next);
    expect(JSON.parse(s.data[TOUR_SEEN_KEY])).toEqual({ "2.5": ["stashes-nav", "share-card"] });
    expect(JSON.parse(s.data[TOUR_SKIPPED_KEY])).toEqual({ "2.4": true, "2.5": true });
  });

  it("a corrupt value reads as empty", () => {
    const s = memoryStore({ [TOUR_SEEN_KEY]: "{not json", [TOUR_SKIPPED_KEY]: "[1]" });
    expect(loadTourRecord(() => s)).toEqual(EMPTY);
  });

  it("storage that throws, on read or on write, is unavailable (null)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(loadTourRecord(() => throwing)).toBeNull();
    const readOnly = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadTourRecord(() => readOnly)).toBeNull();
    expect(loadTourRecord(() => null)).toBeNull();
    // A failed save never throws.
    expect(() => saveTourRecord(() => readOnly, EMPTY)).not.toThrow();
  });
});

describe("a page's list", () => {
  it("the count shows only when the page has two or more tips", () => {
    expect(countLabel(0, 1)).toBeNull();
    expect(countLabel(0, 2)).toBe("1 of 2");
    expect(countLabel(1, 2)).toBe("2 of 2");
    expect(primaryLabel(0, 2)).toBe("Next");
    expect(primaryLabel(1, 2)).toBe("Done");
    expect(primaryLabel(0, 1)).toBe("Done");
  });

  it("the card page: Stash copies then Share this card, counted 1 of 2", () => {
    const list = buildPageList(V25, "card", "desktop", EMPTY, (a) => a !== "card-stash-list");
    expect(list.map((t) => t.id)).toEqual(["stash-copies", "share-card"]);
    expect(countLabel(0, list.length)).toBe("1 of 2");
  });

  it("a missing target is left out and the count closes up", () => {
    // An unowned printing: no Stash copies button, so Share is alone.
    const list = buildPageList(V25, "card", "desktop", EMPTY, (a) => a === "card-share");
    expect(list.map((t) => t.id)).toEqual(["share-card"]);
    expect(countLabel(0, list.length)).toBeNull();
    // ...and stays pending: nothing is marked.
    expect(isSeen(V25, EMPTY, V25.tips[1])).toBe(false);
  });

  it("2b replaces 2 when copies are already stashed, and seeing either covers both", () => {
    const list = buildPageList(V25, "card", "phone", EMPTY, (a) => a !== "card-stash-copies");
    expect(list.map((t) => t.id)).toEqual(["stashed-copies", "share-card"]);
    const rec = withSeen(EMPTY, "2.5", "stashed-copies");
    expect(
      isSeen(
        V25,
        rec,
        V25.tips.find((t) => t.id === "stash-copies")!
      )
    ).toBe(true);
    const back = withSeen(EMPTY, "2.5", "stash-copies");
    expect(
      isSeen(
        V25,
        back,
        V25.tips.find((t) => t.id === "stashed-copies")!
      )
    ).toBe(true);
    // Both rendered (never on one card, but defensively): one of the pair.
    expect(buildPageList(V25, "card", "desktop", EMPTY, all).map((t) => t.id)).toEqual([
      "stash-copies",
      "share-card",
    ]);
  });

  it("seen tips are left out; a skipped release shows nothing", () => {
    const rec = withSeen(EMPTY, "2.5", "stash-copies");
    expect(buildPageList(V25, "card", "desktop", rec, all).map((t) => t.id)).toEqual([
      "share-card",
    ]);
    expect(buildPageList(V25, "card", "desktop", withSkipped(EMPTY, "2.5"), all)).toEqual([]);
  });

  it("tip 5 (share a stash) follows tip 3 on the Stashes page: 1 of 2, 2 of 2", () => {
    const list = buildPageList(V25, "stashes", "desktop", EMPTY, all);
    expect(list.map((t) => t.id)).toEqual(["stashes-page", "share-stash"]);
    expect(countLabel(0, list.length)).toBe("1 of 2");
    expect(countLabel(1, list.length)).toBe("2 of 2");
  });

  it("inside a phone stash (no Stashes heading) tip 5 shows alone", () => {
    const list = buildPageList(V25, "stashes", "phone", EMPTY, (a) => a === "stash-share");
    expect(list.map((t) => t.id)).toEqual(["share-stash"]);
    expect(countLabel(0, list.length)).toBeNull();
  });

  it("device-only tips show on their layout only", () => {
    const tour: FeatureTour = {
      version: "9.9",
      since: "2030-01-01",
      tips: [
        { id: "a", page: "collection", anchor: "a", title: "A", body: "a", enabled: true },
        {
          id: "b",
          page: "collection",
          anchor: "b",
          title: "B",
          body: "b",
          device: "desktop",
          enabled: true,
        },
      ],
    };
    expect(buildPageList(tour, "collection", "phone", EMPTY, all).map((t) => t.id)).toEqual(["a"]);
    expect(buildPageList(tour, "collection", "desktop", EMPTY, all).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("Skip tour", () => {
  const tip = (id: string) => V25.tips.find((t) => t.id === id)!;

  it("shows while the release has unseen tips anywhere besides the current one", () => {
    expect(canSkip(V25, "desktop", EMPTY, tip("stashes-nav"))).toBe(true);
  });

  it("the very last unseen tip of the release shows Done only", () => {
    let rec = EMPTY;
    for (const id of ["stashes-nav", "stash-copies", "stashes-page", "share-stash"])
      rec = withSeen(rec, "2.5", id);
    expect(canSkip(V25, "desktop", rec, tip("share-card"))).toBe(false);
    // 2b counts as the same step as 2: still last.
    expect(canSkip(V25, "desktop", rec, tip("share-card"))).toBe(false);
  });

  it("a disabled tip never keeps Skip alive", () => {
    // The same tour with "Share a stash" switched off and left unseen.
    const off = {
      ...V25,
      tips: V25.tips.map((t) => (t.id === "share-stash" ? { ...t, enabled: false } : t)),
    };
    let rec = EMPTY;
    for (const id of ["stashes-nav", "stash-copies", "stashes-page"])
      rec = withSeen(rec, "2.5", id);
    expect(canSkip(off, "desktop", rec, tip("share-card"))).toBe(false);
    expect(canSkip(V25, "desktop", rec, tip("share-card"))).toBe(true);
  });

  it("skip marks every tip of the release seen", () => {
    const rec = withSkipped(EMPTY, "2.5");
    expect(V25.tips.every((t) => isSeen(V25, rec, t))).toBe(true);
  });
});

describe("placement", () => {
  const rect = (left: number, top: number, width: number, height: number): Rect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const desk = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };

  it("below the target, notch up and centred under it", () => {
    const p = placeTip({
      target: rect(600, 60, 80, 30),
      height: 160,
      viewport: desk,
      phone: false,
      gap: 6,
    });
    expect(p).toMatchObject({ top: 96, width: 320, notch: "up" });
    expect(p.left + p.notchAt + 6.5).toBeCloseTo(640);
  });

  it("flips above when it would overflow the bottom", () => {
    const p = placeTip({
      target: rect(600, 820, 80, 30),
      height: 160,
      viewport: desk,
      phone: false,
    });
    expect(p.notch).toBe("down");
    expect(p.top).toBe(820 - 16 - 160);
  });

  it("right of the target with the notch on the left, else below", () => {
    const p = placeTip({
      target: rect(500, 400, 120, 32),
      height: 160,
      viewport: desk,
      phone: false,
      place: "right",
    });
    expect(p).toMatchObject({ left: 650, notch: "left" });
    const tight = placeTip({
      target: rect(1200, 400, 120, 32),
      height: 160,
      viewport: desk,
      phone: false,
      place: "right",
    });
    expect(tight.notch).toBe("up");
  });

  it("end-aligned overhangs the target's right; clamped 8 px inside the screen", () => {
    const p = placeTip({
      target: rect(1000, 100, 30, 30),
      height: 160,
      viewport: desk,
      phone: false,
      align: "end",
    });
    expect(p.left + p.width).toBe(1030 + 46);
    const edge = placeTip({
      target: rect(10, 780, 70, 56),
      height: 180,
      viewport: phone,
      phone: true,
      place: "above",
    });
    expect(edge).toMatchObject({ left: 8, width: 330, notch: "down", top: 780 - 16 - 180 });
  });

  it("the phone tip spans a full-width row at 358 px, notch near the row's left", () => {
    const p = placeTip({
      target: rect(16, 500, 358, 44),
      height: 180,
      viewport: phone,
      phone: true,
    });
    expect(p).toMatchObject({ left: 16, width: 358, notch: "up", top: 556 });
    // The notch's centre 28 px in from the row's left edge.
    expect(p.left + p.notchAt + 6.5).toBe(16 + 28);
  });

  it("keeps off the update banner on its own side", () => {
    const banner = rect(0, 700, 390, 90);
    const p = placeTip({
      target: rect(10, 790, 70, 54),
      height: 180,
      viewport: phone,
      phone: true,
      place: "above",
      avoid: banner,
    });
    expect(p.top + 180).toBeLessThanOrEqual(700);
  });
});
