import { beforeEach, describe, expect, it } from "vitest";
import { createGlide, GLIDE_MS, MAX_STEP_MS } from "./podGlide";
import type { GlideDeps, PodGeom } from "./podGlide";

// The pod glide's lifecycle (owner 2026-11-08, R2-1), with a fake frame
// clock: the per-frame geometry and its monotonic path are covered in the
// browser (r1-01-header-widths.spec.ts "the pod glides between menu states").

const g = (w: number): PodGeom => ({ padL: 22, padR: 22, tops: [88, 88], subs: [w, 0] });
const total = (x: PodGeom) =>
  x.padL + x.padR + x.tops.reduce((a, b) => a + b, 0) + x.subs.reduce((a, b) => a + b, 0);

let now = 0;
let frames: Map<number, (t: number) => void>;
let nextId = 1;
let live: PodGeom;
let writes: { g: PodGeom; moving: boolean }[];
let reduced = false;
let ends = 0;
let hiddenCount = 0;

function deps(): GlideDeps {
  return {
    read: () => live,
    write: (x, moving) => {
      live = x;
      writes.push({ g: x, moving });
    },
    reduced: () => reduced,
    onEnd: () => {
      ends += 1;
    },
    raf: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id) => {
      frames.delete(id);
    },
    now: () => now,
    hiddenCount: () => hiddenCount,
  };
}

/** Run every pending frame at time `t`. */
function frameAt(t: number) {
  now = t;
  const due = [...frames.values()];
  frames.clear();
  for (const cb of due) cb(t);
}

beforeEach(() => {
  now = 1000;
  frames = new Map();
  live = g(200);
  writes = [];
  reduced = false;
  ends = 0;
  hiddenCount = 0;
});

describe("the pod glide", () => {
  it("glides with one shared progress and ends exactly on the target", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    expect(glide.running()).toBe(true);
    const seen: number[] = [total(live)];
    for (let t = 1016; t <= 1000 + GLIDE_MS + 64; t += 16) {
      frameAt(t);
      seen.push(total(live));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
    expect(live).toEqual(g(100));
    expect(writes[writes.length - 1].moving).toBe(false);
    expect(glide.running()).toBe(false);
    expect(ends).toBe(1); // the header re-fits once at the end
  });

  it("cancel (unmount) stops it: no further frames or writes", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    frameAt(1100);
    const n = writes.length;
    glide.cancel();
    expect(frames.size).toBe(0);
    frameAt(1200);
    frameAt(2000);
    expect(writes.length).toBe(n);
    expect(ends).toBe(0);
  });

  it("a new target mid-glide restarts from the current geometry", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    frameAt(1160); // part-way
    const mid = live.subs[0];
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
    glide.apply(g(300), true);
    // The restart's first write is where the pod was, not the old start.
    expect(live.subs[0]).toBeCloseTo(mid, 5);
    expect(frames.size).toBe(1); // the old frame was cancelled
    frameAt(1160 + 16);
    expect(live.subs[0]).toBeGreaterThan(mid);
    for (let t = 1192; t <= 1160 + GLIDE_MS + 64; t += 16) frameAt(t);
    expect(live).toEqual(g(300));
  });

  it("the same target again goes on (no restart)", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    frameAt(1100);
    const n = writes.length;
    const pending = [...frames.keys()];
    glide.apply(g(100), true);
    expect(writes.length).toBe(n);
    expect([...frames.keys()]).toEqual(pending);
  });

  it("a hidden tab (no frames) completes on its first frame back", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    hiddenCount += 1; // the tab was hidden (a minute) ...
    frameAt(1000 + 60_000); // ... and its first frame back finishes the glide
    expect(live).toEqual(g(100));
    expect(glide.running()).toBe(false);
    expect(ends).toBe(1);
  });

  it("reduced motion, or not animated: the final state at once", () => {
    reduced = true;
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    expect(live).toEqual(g(100));
    expect(frames.size).toBe(0);
    reduced = false;
    glide.apply(g(50), false);
    expect(live).toEqual(g(50));
    expect(frames.size).toBe(0);
  });

  it("a change of shape (an item appearing) is written at once", () => {
    const glide = createGlide(deps());
    glide.apply({ ...g(100), tops: [88, 88, 104] }, true);
    expect(live.tops).toEqual([88, 88, 104]);
    expect(frames.size).toBe(0);
  });

  // CI fold-in (run 42529668091): on a slow runner the first frame came
  // late and the glide snapped. The clock starts at the first frame and a
  // frame advances it by at most MAX_STEP_MS.
  it("a first frame 400 ms after the switch is the glide's start, not its end", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    frameAt(1400);
    expect(live.subs[0]).toBeGreaterThan(100);
    expect(live.subs[0]).toBeLessThan(200);
    expect(glide.running()).toBe(true);
  });

  it("slow frames (200 ms apart) still show a glide of several frames", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    const seen: number[] = [];
    for (let t = 1200; glide.running() && t < 20_000; t += 200) {
      frameAt(t);
      seen.push(live.subs[0]);
    }
    expect(seen.filter((x) => x > 100 && x < 200).length).toBeGreaterThanOrEqual(
      Math.floor(GLIDE_MS / MAX_STEP_MS) - 1
    );
    expect(live).toEqual(g(100));
  });

  it("a long gap alone (a slow device, not a hidden tab) does not finish it", () => {
    const glide = createGlide(deps());
    glide.apply(g(100), true);
    frameAt(1016);
    frameAt(3000); // a 2 s frame
    expect(glide.running()).toBe(true);
    expect(live.subs[0]).toBeGreaterThan(100);
  });
});
