import { padAddable } from "../tool/padModel";
import type { PadView } from "../tool/padModel";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import type { CandidateCard, Evaluation } from "./scanCore";
import type { Accepted, ResumeAfter } from "./scanLoop";

// BL-253 S7-14 / S7-15 / S7-17: the camera's decision state machine
// (recognise -> prompt), pure and injectable. Phases (rev4 MCamera.jsx
// M.cam.phase, with the spike's rules):
//   searching -- the loop reads; the meter guides.
//   found     -- an exact read reached agreement: the loop is paused and the
//                keypad's resolved-card panel shows {setCode, cardNumber}
//                with Card details / Add / Wrong card. Nothing is counted
//                until Add (Spec 24.2, ADR-0029 Decision 3).
//   pick      -- an ambiguous read (printed-code collision, N/2 tiers, two
//                cards, number / reading conflicts): amber rows, never
//                auto-resolved; "Neither / scan again" = Wrong card.
//   hold      -- after any add (Add, or the automatic add of Fast add): the
//                card shown "In batch n", Add hidden, a 1 s bar; then the
//                loop resumes. Wrong card in the hold takes that copy back
//                out (rev4 MCamera.jsx:134-139).
// Wrong card restarts the scan -- no keypad prefill (owner 2026-10-10).
// Cue (beep + green flash) on every recognition: found, pick resolved, fast add.
//
// BL-262 (owner 2026-10-12 / 2026-10-13):
//   - Fast add adds on its own only when `fastAddTarget` says nothing is left
//     to choose; any other read lands in `found` (the panel prompt mode
//     shows), and Add there starts the Fast add hold.
//   - What follows a decision (scanLoop.resume): after an add the same card
//     may be read again as soon as the reader's own rules allow -- there is no
//     timed wait; under Fast add the reader also ignores the card until it
//     has left the frame; after Wrong card the same read stays quiet for 3 s.

/** The hold after an add (owner 2026-10-12: 1 s; rev4 MCamera.jsx:29 had 1.5 s). */
export const HOLD_MS = 1000;
/** The hold's length as the panel prints it ("next card in 1 s"). */
export const HOLD_LABEL = HOLD_MS / 1000 + " s";

// ── BL-257 FR5-03 (F-16): the camera-start focusing state ─────────────────
// A phone camera starts blurry and may switch lens as it focuses, which moves
// the picture; a card lined up before that is no longer on the guide. So from
// every stream start the guide is drawn dim with "Focusing…" until the first
// of: a frame the sharpness gate does not class as blurry (the meter's band is
// not red), a card being read, or SETTLE_MS since the start (an empty table
// never leaves the guide dim). It is display only: the loop reads throughout.
// Once ended it stays ended until the next stream start -- a later blurry
// frame is the meter's "Blurry" state, not this one. Pure: the controller
// holds the state and supplies the clock.

/** The longest the guide stays dim after a stream start. */
export const SETTLE_MS = 3000;

export interface SettleState {
  /** Clock time of the stream start (null = no live stream). */
  startedAt: number | null;
  /** What ended it before the time limit, if anything did. */
  endedBy: "sharp" | "read" | null;
}

export type SettleStatus = "off" | "settling" | "sharp" | "read" | "timeout";

export const SETTLE_OFF: SettleState = { startedAt: null, endedBy: null };

/** A stream went live at `now`: the state starts over. */
export function settleStart(now: number): SettleState {
  return { startedAt: now, endedBy: null };
}

/** Where the state stands at `now`. */
export function settleStatus(s: SettleState, now: number): SettleStatus {
  if (s.startedAt === null) return "off";
  if (s.endedBy) return s.endedBy;
  return now - s.startedAt >= SETTLE_MS ? "timeout" : "settling";
}

export function isSettling(s: SettleState, now: number): boolean {
  return settleStatus(s, now) === "settling";
}

/** End it now for `by`; a no-op unless it is still settling at `now`. */
export function settleEnd(s: SettleState, by: "sharp" | "read", now: number): SettleState {
  return isSettling(s, now) ? { startedAt: s.startedAt, endedBy: by } : s;
}

/** A frame was measured at `now` with the meter's band: the first one that is
 * not red ends the state; a red one never brings it back. */
export function settleFrame(
  s: SettleState,
  band: "red" | "amber" | "green",
  now: number
): SettleState {
  return band === "red" ? s : settleEnd(s, "sharp", now);
}

/** What the keypad resolver takes (Spec 24.1: the read fills set + number). */
export interface Target {
  setCode: string;
  cardNumber: string;
  name: string;
  /** BL-262: the printings the camera identified (an exact read's, or the
   * picked row's). {set, number} alone can name more cards than the read did;
   * these let Fast add tell (fastAddTarget). */
  vids: number[];
}

// ── BL-262: the one rule for an automatic add ─────────────────────────────
// The scan loop reads ONE card, but what gets added is whatever the keypad
// resolver makes of {set, number} -- and a number shared inside a set family
// resolves to a default with the choice left on the panel (the base-set card
// under "Which card?", Base Set under "Set"). Before BL-262 Fast add took that
// default at once: no question, and for a Weekly Play printing on a base-set
// number, a token, or a tournament-stamp row, the wrong card. Fast add now
// adds on its own only when all three hold for the read's keypad view:
//   1. Add is possible (padAddable -- the found panel's own Add condition);
//   2. the printing it would add is one the camera read (never another card
//      that happens to hold the number);
//   3. the panel asks nothing about which card or which printing: no
//      "Which card?", "Set" or "Stamp" choice is showing.
// A Finish choice alone does not stop it: early sets print Standard and
// Standard Foil under one number, the camera cannot tell them apart, and the
// keypad's non-foil default (BL-191) is not a choice of card.

/** The printing Fast add may add with no question for this view, or null. */
export function fastAddTarget(
  view: PadView,
  readVids: readonly number[]
): { card: InventoryCard; variant: InventoryVariant } | null {
  const add = padAddable(view);
  if (!add || view.kind !== "card") return null;
  if (!readVids.includes(add.variant.variant_id)) return null;
  if (view.choices.some((c) => c.axis !== "finish")) return null;
  return add;
}

export interface PickRow {
  id: string;
  target: Target;
  subtitle: string;
  /** The printing's variant type (program names come from it). */
  vt: string;
  vids: number[];
}

export type Phase =
  | { kind: "searching" }
  | { kind: "found"; key: string; target: Target; fromPick: boolean }
  | { kind: "pick"; key: string; reason: string; rows: PickRow[] }
  | {
      kind: "hold";
      key: string;
      target: Target;
      entryId: string | null;
      fast: boolean;
      at: number;
    };

export type ScanDecision = "add" | "details" | "wrong_card" | "pick";

export interface FlowEffects {
  now(): number;
  fastAdd(): boolean;
  /** Beep + flash. */
  cue(): void;
  /** One copy into the batch; returns the row id, or null when it could not
   * be added. `camera` = Add in the found panel (what the panel shows, with
   * the user's choices). `camera_fast_add` = an add with no Add tap: null
   * unless `fastAddTarget` allows it (BL-262), and null when signed out. */
  add(target: Target, via: "camera" | "camera_fast_add"): string | null;
  remove(entryId: string): void;
  /** Resume the loop after a decision on `key` (scanLoop.ts ResumeAfter). */
  resume(key: string | null, after: ResumeAfter): void;
  setTimer(fn: () => void, ms: number): () => void;
  /** scan_* analytics (S7-18). */
  recognised?(a: Accepted): void;
  pickShown?(reason: string): void;
  decision?(d: ScanDecision): void;
}

const ROW_SEP = "|";

/** One row per (card, printed set, number): finishes of one printing stay
 * one row (the keypad panel keeps BL-191's non-foil default for them). */
export function pickRows(cards: CandidateCard[]): PickRow[] {
  const rows: PickRow[] = [];
  const seen = new Map<string, PickRow>();
  for (const c of cards) {
    for (const p of c.printings) {
      const id = c.card + ROW_SEP + p.src + ROW_SEP + p.num;
      const have = seen.get(id);
      if (have) {
        have.vids.push(p.vid);
        continue;
      }
      // One array: the row's printings are the target's (BL-262).
      const vids = [p.vid];
      const row: PickRow = {
        id,
        target: { setCode: p.src, cardNumber: String(p.num), name: c.name, vids },
        subtitle: c.subtitle,
        vt: p.vt,
        vids,
      };
      seen.set(id, row);
      rows.push(row);
    }
  }
  return rows;
}

/** rev4 MCamera.jsx:37-41 PROGRAM + M.programName, verbatim. */
const PROGRAM: Record<string, string> = {
  SS: "Store Showdown",
  RQ: "Regional Qualifier",
  PQ: "Planetary Qualifier",
  SQ: "Sector Qualifier",
  GC: "Galactic Championship",
};
export function programName(variantType: string): string {
  const m = /^(SS|RQ|PQ|SQ|GC) (.+)$/.exec(variantType || "");
  return m ? PROGRAM[m[1]] + " · " + m[2] : variantType;
}

/** The exact read's target: its first printing's set + number, with every
 * printing the read named. */
export function targetOf(card: CandidateCard): Target {
  const p = card.printings[0];
  return {
    setCode: p.src,
    cardNumber: String(p.num),
    name: card.name,
    vids: card.printings.map((x) => x.vid),
  };
}

export class CameraFlow {
  phase: Phase = { kind: "searching" };
  private cancelHold: (() => void) | null = null;
  private subs = new Set<() => void>();

  constructor(private fx: FlowEffects) {}

  subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  };

  getPhase = (): Phase => this.phase;

  private set(p: Phase): void {
    this.phase = p;
    this.subs.forEach((f) => f());
  }

  /** The loop accepted an exact read (it is paused now). */
  accepted(a: Accepted): void {
    this.fx.recognised?.(a);
    this.fx.cue();
    this.recognise(a.key, targetOf(a.card), false);
  }

  /** The loop met an ambiguous read (it is paused now). */
  ambiguous(ev: Evaluation, reason: string): void {
    if (!ev.best) return;
    this.fx.pickShown?.(reason);
    this.set({ kind: "pick", key: ev.best.key, reason, rows: pickRows(ev.best.cards) });
  }

  /** A pick row tapped: the pick resolves (cue), then -- under Fast add --
   * the add and the hold (rev4 choosePick 125-132). */
  pick(row: PickRow): void {
    if (this.phase.kind !== "pick") return;
    this.fx.decision?.("pick");
    this.fx.cue();
    this.recognise(this.phase.key, row.target, true);
  }

  /** Under Fast add the add happens here with no Add tap -- when the effect
   * allows it (fastAddTarget: nothing left to choose). Otherwise the found
   * panel, exactly as in prompt mode. */
  private recognise(key: string, target: Target, fromPick: boolean): void {
    if (this.fx.fastAdd()) {
      const id = this.fx.add(target, "camera_fast_add");
      if (id !== null) {
        this.startHold(key, target, id, true);
        return;
      }
    }
    this.set({ kind: "found", key, target, fromPick });
  }

  /** Add in the found panel: one copy, then the hold. With Fast add on (the
   * read needed a choice first -- BL-262) it is the Fast add hold: the card
   * must leave the frame before it is read again. */
  add(): void {
    if (this.phase.kind !== "found") return;
    const { key, target } = this.phase;
    const id = this.fx.add(target, "camera");
    if (id === null) return;
    this.fx.decision?.("add");
    this.startHold(key, target, id, this.fx.fastAdd());
  }

  /** Card details (the card layer opens over the paused camera). */
  details(): void {
    this.fx.decision?.("details");
  }

  /** Wrong card / Neither: restart the scan (in the hold: that copy leaves). */
  wrongCard(): void {
    const p = this.phase;
    if (p.kind === "searching") return;
    this.fx.decision?.("wrong_card");
    this.cancelHold?.();
    this.cancelHold = null;
    if (p.kind === "hold" && p.entryId) this.fx.remove(p.entryId);
    this.set({ kind: "searching" });
    this.fx.resume(p.key, "wrong_card");
  }

  private startHold(key: string, target: Target, entryId: string, fast: boolean): void {
    this.cancelHold?.();
    this.set({ kind: "hold", key, target, entryId, fast, at: this.fx.now() });
    this.cancelHold = this.fx.setTimer(() => {
      this.cancelHold = null;
      if (this.phase.kind !== "hold") return;
      this.set({ kind: "searching" });
      this.fx.resume(key, fast ? "fast_add" : "add");
    }, HOLD_MS);
  }

  /** The screen unmounts (mode change, close): no timer outlives it. The
   * subscriptions stay (StrictMode re-runs the mount on the same instance). */
  dispose(): void {
    this.cancelHold?.();
    this.cancelHold = null;
  }
}
