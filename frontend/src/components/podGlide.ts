// The desktop Command pod's glide (Header.tsx drives it): one 320 ms step on
// the pod's curve moving every part of the pod -- the row's padding, each
// top item's width, each sub-item group's width -- from where it is to the
// measured target with the same progress, so the pod's width goes straight
// from its old size to its new one: no part opens before another has
// closed, no overshoot (owner, 2026-11-08). Pure apart from the DOM writes
// and the frame clock, both injected, so the lifecycle is unit-tested.

/** The pod's moving parts: the row's padding, each top item's width, each
 * sub-item group's width (an open group's content, a closed one's 0). */
export interface PodGeom {
  padL: number;
  padR: number;
  tops: number[];
  subs: number[];
}

/** The pod's glide: its 320 ms and its curve (NavPod.css --pod-ease). */
export const GLIDE_MS = 320;
/** The glide's first frame counts as one 60 Hz frame of progress. */
export const FIRST_STEP_MS = 1000 / 60;
/** The most one frame may advance the glide (two 60 Hz frames). */
export const MAX_STEP_MS = 34;

export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
export const glideEase = cubicBezier(0.2, 0.7, 0.2, 1);

export function sameShape(a: PodGeom, b: PodGeom): boolean {
  return a.tops.length === b.tops.length && a.subs.length === b.subs.length;
}

export function sameGeom(a: PodGeom, b: PodGeom): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.5;
  return (
    sameShape(a, b) &&
    near(a.padL, b.padL) &&
    near(a.padR, b.padR) &&
    a.tops.every((t, i) => near(t, b.tops[i])) &&
    a.subs.every((t, i) => near(t, b.subs[i]))
  );
}

export function lerpGeom(a: PodGeom, b: PodGeom, e: number): PodGeom {
  const l = (x: number, y: number) => x + (y - x) * e;
  return {
    padL: l(a.padL, b.padL),
    padR: l(a.padR, b.padR),
    tops: a.tops.map((t, i) => l(t, b.tops[i])),
    subs: a.subs.map((t, i) => l(t, b.subs[i])),
  };
}

export interface GlideDeps {
  /** The live pod's geometry now (null: no pod). */
  read: () => PodGeom | null;
  /** Write a geometry to the live pod; `moving`: mid-glide (clip groups). */
  write: (g: PodGeom, moving: boolean) => void;
  /** Reduced motion asked for: no glide, the final state at once. */
  reduced: () => boolean;
  /** A glide finished (Header re-fits once: something else may have
   * changed size while it ran, e.g. a web font loading). */
  onEnd: () => void;
  /** How many times the page has been hidden (visibilitychange). */
  hiddenCount: () => number;
  raf: (cb: (now: number) => void) => number;
  caf: (id: number) => void;
  now: () => number;
}

/** The page's hidden count, for GlideDeps.hiddenCount. */
let hidden = 0;
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hidden += 1;
  });
export const pageHiddenCount = () => hidden;

export interface Glide {
  /** Go to `target`: glide when `animate`, else at once. A glide already
   * heading to the same target goes on; a new target restarts from the
   * pod's current geometry. */
  apply: (target: PodGeom, animate: boolean) => void;
  running: () => boolean;
  /** Stop (unmount): no further frames or writes. */
  cancel: () => void;
}

export function createGlide(d: GlideDeps): Glide {
  let run: { frame: number; target: PodGeom } | null = null;
  const stop = () => {
    if (run) d.caf(run.frame);
    run = null;
  };
  return {
    apply(target, animate) {
      if (run && sameGeom(run.target, target)) return; // already going there
      stop();
      const from = d.read();
      if (!from) return;
      if (!animate || d.reduced() || !sameShape(from, target) || sameGeom(from, target)) {
        d.write(target, false);
        return;
      }
      // The clock: elapsed time is counted from the glide's first frame (the
      // measure and the re-render before it can take a slow device a few
      // hundred ms, which must not eat the glide), and each frame adds at
      // most MAX_STEP_MS, so a slow device sees a slower glide, never a snap.
      // A tab hidden meanwhile (the page's hidden count moved): nobody
      // watched, so the next frame finishes it. A long gap alone is not
      // that -- a slow device's frames are long too.
      const hiddenAtStart = d.hiddenCount();
      let last: number | null = null;
      let elapsed = 0;
      const mine: { frame: number; target: PodGeom } = { frame: 0, target };
      const step = (now: number) => {
        if (run !== mine) return;
        if (d.hiddenCount() !== hiddenAtStart) elapsed = GLIDE_MS;
        else elapsed += last === null ? FIRST_STEP_MS : Math.min(now - last, MAX_STEP_MS);
        last = now;
        const p = Math.min(1, elapsed / GLIDE_MS);
        if (p < 1) {
          d.write(lerpGeom(from, target, glideEase(p)), true);
          mine.frame = d.raf(step);
        } else {
          d.write(target, false);
          run = null;
          d.onEnd();
        }
      };
      d.write(from, true);
      run = mine;
      mine.frame = d.raf(step);
    },
    running: () => run !== null,
    cancel: stop,
  };
}
