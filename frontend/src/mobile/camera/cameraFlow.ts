import type { CandidateCard, Evaluation } from "./scanCore";
import type { Accepted } from "./scanLoop";

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
//                card shown "In batch n", Add hidden, a 1.5 s bar; then the
//                loop resumes. Wrong card in the hold takes that copy back
//                out (rev4 MCamera.jsx:134-139).
// Wrong card restarts the scan -- no keypad prefill (owner 2026-10-10). After
// every decision the same key is suppressed for 3 s (scanLoop.resume); after
// an automatic add the Acceptor also holds the key until the card leaves.
// Cue (beep + green flash) on every recognition: found, pick resolved, fast add.

/** rev4 MCamera.jsx:29. */
export const HOLD_MS = 1500;

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
   * be added (signed out, or the number needs a pick the panel must ask). */
  add(target: Target, via: "camera" | "camera_fast_add"): string | null;
  remove(entryId: string): void;
  /** Resume the loop (suppressing `key` for 3 s; `holdUntilGone` after an
   * automatic add). */
  resume(key: string | null, holdUntilGone: boolean): void;
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
      const row: PickRow = {
        id,
        target: { setCode: p.src, cardNumber: String(p.num), name: c.name },
        subtitle: c.subtitle,
        vt: p.vt,
        vids: [p.vid],
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

/** The exact read's target: its first printing's set + number. */
export function targetOf(card: CandidateCard): Target {
  const p = card.printings[0];
  return { setCode: p.src, cardNumber: String(p.num), name: card.name };
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

  /** Add in the found panel: one copy, then the hold. */
  add(): void {
    if (this.phase.kind !== "found") return;
    const { key, target } = this.phase;
    const id = this.fx.add(target, "camera");
    if (id === null) return;
    this.fx.decision?.("add");
    this.startHold(key, target, id, false);
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
    this.fx.resume(p.key, false);
  }

  private startHold(key: string, target: Target, entryId: string, fast: boolean): void {
    this.cancelHold?.();
    this.set({ kind: "hold", key, target, entryId, fast, at: this.fx.now() });
    this.cancelHold = this.fx.setTimer(() => {
      this.cancelHold = null;
      if (this.phase.kind !== "hold") return;
      this.set({ kind: "searching" });
      this.fx.resume(key, fast);
    }, HOLD_MS);
  }

  /** The screen unmounts (mode change, close): no timer outlives it. The
   * subscriptions stay (StrictMode re-runs the mount on the same instance). */
  dispose(): void {
    this.cancelHold?.();
    this.cancelHold = null;
  }
}
