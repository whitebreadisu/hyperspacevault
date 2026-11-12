// The feature tour's pure rules (App Spec §20, "Feature tour"): which tour is
// active, who sees tips, the per-browser seen record, a page's tip list, the
// buttons a tip shows and where it sits. No React, no DOM beyond the
// injected storage and the `isRendered` callback, so every rule is unit-tested
// directly (tourModel.test.ts). The runtime is FeatureTour.tsx.

import type { FeatureTour, TourPage, TourTip } from "../content/featureTours";

export type TourDevice = "desktop" | "phone";

// ── Which tour is active ───────────────────────────────────────────────────

/** "2.4.0" -> "2.4"; anything else passes through. */
export function majorMinor(version: string): string {
  const m = /^(\d+)\.(\d+)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : version;
}

/** Numeric major.minor comparison ("2.10" > "2.9"); unparseable sorts low. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2])] : [-1, -1];
  };
  const [am, an] = parse(a);
  const [bm, bn] = parse(b);
  return am !== bm ? am - bm : an - bn;
}

/** A test or e2e run's switch (`window.__hsvTour`), honoured on the dev
 * server and under vitest only: `on: false` turns every tour off; `on: true`
 * makes the newest tour active whatever the build, with its `since` replaced
 * when one is given (an e2e account is created during the run). */
export interface TourOverride {
  on: boolean;
  since?: string;
}

export interface ActiveTourOptions {
  /** package.json's version (`__APP_VERSION__`). */
  appVersion: string;
  /** A prod deploy build (its Firebase project id is the prod one). */
  prodBuild: boolean;
  /** A vitest run: no tour unless an override turns one on. */
  testMode?: boolean;
  override?: TourOverride | null;
}

/** The tour this tab runs, or null.
 * - prod build: the tour whose version is the app's major.minor;
 * - any other build (dev deploy, local): the newest tour at or ahead of the
 *   app's version, so a tour can be seen on dev before its release ships;
 * - an override, then a test run, decide first. */
export function activeTour(tours: FeatureTour[], opts: ActiveTourOptions): FeatureTour | null {
  const newest = [...tours].sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
  if (opts.override) {
    if (!opts.override.on || !newest) return null;
    return opts.override.since ? { ...newest, since: opts.override.since } : newest;
  }
  if (opts.testMode) return null;
  const app = majorMinor(opts.appVersion);
  if (opts.prodBuild) return tours.find((t) => t.version === app) ?? null;
  return newest && compareVersions(newest.version, app) >= 0 ? newest : null;
}

// ── Who sees tips ──────────────────────────────────────────────────────────

/** True when the account was created strictly before the tour's `since` date
 * (UTC midnight). An unreadable creation time or date is not returning. */
export function createdBefore(creationTime: string | null | undefined, since: string): boolean {
  if (!creationTime) return false;
  const created = Date.parse(creationTime);
  const cutoff = Date.parse(since);
  if (Number.isNaN(created) || Number.isNaN(cutoff)) return false;
  return created < cutoff;
}

export interface EligibilityInput {
  tour: FeatureTour | null;
  /** The signed-in Firebase user's `metadata.creationTime`; null signed out. */
  signedIn: boolean;
  creationTime: string | null | undefined;
  /** A shared vault is the view shown. */
  sharedView: boolean;
  /** This tab has learned a newer build is live (the update banner). */
  newerBuild: boolean;
  /** The seen record could be read and written. */
  storageOk: boolean;
}

/** Whether tips may start at all in this tab right now. */
export function eligible(e: EligibilityInput): boolean {
  return (
    e.tour != null &&
    e.signedIn &&
    createdBefore(e.creationTime, e.tour.since) &&
    !e.sharedView &&
    !e.newerBuild &&
    e.storageOk
  );
}

// ── The per-browser record ─────────────────────────────────────────────────

export const TOUR_SEEN_KEY = "swu.tour.seen";
export const TOUR_SKIPPED_KEY = "swu.tour.skipped";

export interface TourRecord {
  seen: Record<string, string[]>;
  skipped: Record<string, true>;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The record, or null when storage cannot be read AND written (private
 * mode, blocked site data): then no tips show, so a tour can never loop. The
 * write is the record itself, re-saved unchanged. A corrupt value reads as
 * empty. */
export function loadTourRecord(storage: () => Store | null): TourRecord | null {
  try {
    const s = storage();
    if (!s) return null;
    const seenRaw = parseObject(s.getItem(TOUR_SEEN_KEY));
    const skippedRaw = parseObject(s.getItem(TOUR_SKIPPED_KEY));
    const seen: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(seenRaw))
      if (Array.isArray(v)) seen[k] = v.filter((x): x is string => typeof x === "string");
    const skipped: Record<string, true> = {};
    for (const [k, v] of Object.entries(skippedRaw)) if (v === true) skipped[k] = true;
    s.setItem(TOUR_SEEN_KEY, JSON.stringify(seen));
    return { seen, skipped };
  } catch {
    return null;
  }
}

/** Best effort: a failed write keeps the in-memory record (the caller's), so
 * this tab does not show the tip again either way. */
export function saveTourRecord(storage: () => Store | null, rec: TourRecord): void {
  try {
    const s = storage();
    s?.setItem(TOUR_SEEN_KEY, JSON.stringify(rec.seen));
    s?.setItem(TOUR_SKIPPED_KEY, JSON.stringify(rec.skipped));
  } catch {
    /* best effort, as utils/releaseNotesSeen.ts */
  }
}

export function withSeen(rec: TourRecord, version: string, id: string): TourRecord {
  const ids = rec.seen[version] ?? [];
  if (ids.includes(id)) return rec;
  return { ...rec, seen: { ...rec.seen, [version]: [...ids, id] } };
}

export function withSkipped(rec: TourRecord, version: string): TourRecord {
  return { ...rec, skipped: { ...rec.skipped, [version]: true } };
}

// ── A page's tips ──────────────────────────────────────────────────────────

/** Tips of the tour that can ever show on this layout. */
export function tipsFor(tour: FeatureTour, device: TourDevice): TourTip[] {
  return tour.tips.filter((t) => t.enabled && (!t.device || t.device === device));
}

/** Seen: itself, or the tip it stands in for / that stands in for it. */
export function isSeen(tour: FeatureTour, rec: TourRecord, tip: TourTip): boolean {
  if (rec.skipped[tour.version]) return true;
  const ids = rec.seen[tour.version] ?? [];
  if (ids.includes(tip.id)) return true;
  if (tip.insteadOf && ids.includes(tip.insteadOf)) return true;
  return tour.tips.some((t) => t.insteadOf === tip.id && ids.includes(t.id));
}

/** The page's list, built once when the page settles: its enabled, unseen
 * tips for this layout whose target is rendered, in tour order. A tip whose
 * target is missing is left out (it stays pending for a later visit). */
export function buildPageList(
  tour: FeatureTour,
  page: TourPage,
  device: TourDevice,
  rec: TourRecord,
  isRendered: (anchor: string) => boolean
): TourTip[] {
  const list: TourTip[] = [];
  for (const tip of tipsFor(tour, device)) {
    if (tip.page !== page || isSeen(tour, rec, tip)) continue;
    // A pair shows once per visit: the first of the two whose target exists.
    if (list.some((t) => t.insteadOf === tip.id || tip.insteadOf === t.id)) continue;
    if (isRendered(tip.anchor)) list.push(tip);
  }
  return list;
}

/** "1 of 2", only when the page has two or more tips. */
export function countLabel(index: number, length: number): string | null {
  return length >= 2 ? `${index + 1} of ${length}` : null;
}

/** Whether "Skip tour" shows: the release still has unseen tips anywhere
 * (this page or others) besides the current one. A pair counts once. */
export function canSkip(
  tour: FeatureTour,
  device: TourDevice,
  rec: TourRecord,
  current: TourTip
): boolean {
  const pairOf = (t: TourTip) => t.insteadOf ?? t.id;
  return tipsFor(tour, device).some((t) => pairOf(t) !== pairOf(current) && !isSeen(tour, rec, t));
}

/** The primary button: Next on every tip but the page's last, which is Done. */
export function primaryLabel(index: number, length: number): "Next" | "Done" {
  return index < length - 1 ? "Next" : "Done";
}

// ── Placement ──────────────────────────────────────────────────────────────

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type TipPlace = "below" | "above" | "right";
export type TipAlign = "start" | "center" | "end";
export type NotchSide = "up" | "down" | "left";

export interface PlaceInput {
  target: Rect;
  /** The tip's rendered height. */
  height: number;
  viewport: { width: number; height: number };
  phone: boolean;
  /** `data-tour-place`; default below. */
  place?: TipPlace;
  /** `data-tour-gap`, px; default by side. */
  gap?: number;
  /** `data-tour-align`; default center. */
  align?: TipAlign;
  /** A box the tip must not cover (the update banner). */
  avoid?: Rect | null;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  notch: NotchSide;
  /** px from the tip's left (up/down) or top (left) to the notch's box. */
  notchAt: number;
}

export const TIP_WIDTH = { desktop: 320, phone: 330, phoneWide: 358 } as const;
const EDGE = 8;
const NOTCH = 13;
/** The notch keeps clear of the panel's cut corners. */
const NOTCH_INSET = 18;
/** A target at least this wide is a full row: the phone tip spans it. */
const WIDE_TARGET = 300;
/** Over a wide target the notch sits near its left, not its middle. */
const WIDE_NOTCH_X = 28;
/** The `right` side: the notch this far below the target's top. */
const RIGHT_NOTCH_Y = 20;
/** The panel overhangs an end-aligned target's right edge by this much. */
const END_OVERHANG = 46;

function defaultGap(place: TipPlace): number {
  return place === "right" ? 30 : place === "above" ? 16 : 12;
}

/** `v` within [lo, hi]; lo when the range is empty. */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where the tip sits against its target: below / above / right, flipped when
 * it would overflow the viewport, kept off the `avoid` box. */
export function placeTip(p: PlaceInput): Placement {
  const vw = p.viewport.width;
  const vh = p.viewport.height;
  const t = p.target;
  const wide = p.phone && t.width >= WIDE_TARGET;
  const width = Math.min(
    p.phone ? (wide ? TIP_WIDTH.phoneWide : TIP_WIDTH.phone) : TIP_WIDTH.desktop,
    vw - 2 * EDGE
  );
  let place: TipPlace = p.place ?? "below";
  const gapFor = (side: TipPlace) =>
    side === (p.place ?? "below") && p.gap != null ? p.gap : defaultGap(side);

  if (place === "right") {
    const left = t.right + gapFor("right");
    if (left + width <= vw - EDGE) {
      const top = clamp(
        t.top + t.height / 2 - RIGHT_NOTCH_Y - NOTCH / 2,
        EDGE,
        vh - p.height - EDGE
      );
      const notchAt = clamp(
        t.top + t.height / 2 - top - NOTCH / 2,
        NOTCH_INSET,
        p.height - NOTCH_INSET - NOTCH
      );
      return { left, top, width, notch: "left", notchAt };
    }
    place = "below";
  }

  let top: number;
  let notch: NotchSide;
  const below = () => t.bottom + gapFor("below");
  const above = () => t.top - gapFor("above") - p.height;
  if (place === "above") {
    top = above();
    notch = "down";
    if (top < EDGE) {
      top = below();
      notch = "up";
    }
  } else {
    top = below();
    notch = "up";
    if (top + p.height > vh - EDGE && above() >= EDGE) {
      top = above();
      notch = "down";
    }
  }
  // Never over the update banner: move past it on the tip's own side.
  const a = p.avoid;
  if (a && top < a.bottom && top + p.height > a.top) {
    top = notch === "down" ? a.top - gapFor("above") - p.height : a.bottom + gapFor("below");
  }

  const notchX = wide ? t.left + WIDE_NOTCH_X : t.left + t.width / 2;
  const align = p.align ?? (wide ? "start" : "center");
  const wantLeft =
    align === "start"
      ? t.left
      : align === "end"
        ? t.right + END_OVERHANG - width
        : notchX - width / 2;
  const left = clamp(wantLeft, EDGE, vw - width - EDGE);
  const notchAt = clamp(notchX - left - NOTCH / 2, NOTCH_INSET, width - NOTCH_INSET - NOTCH);
  return { left, top, width, notch, notchAt };
}
