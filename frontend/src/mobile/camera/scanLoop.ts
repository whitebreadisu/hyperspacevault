import type { Acceptor, Catalog, CandidateCard, Decision, Evaluation } from "./scanCore";
import { numLenConflict } from "./scanCore";
import { BLUR_THRESHOLD, isBlurry, isSmall } from "./imagePipeline";

// BL-253 S7-13: the read loop + agreement -- the spike's loop / readOnce /
// ocrRead / ocrWithFallbacks / lenCheck / handleResult (app.js:524-529,
// 574-643, 674-723, 844-912, v0.5.5) minus the research logging, crops,
// photo and continuous mode. One frame in flight (`setTimeout(loop, 0)`), an
// 80 ms back-off after a skipped frame, 120 ms while paused, 200 ms with no
// usable frame. Paddle first; Tesseract (PSM 6 then 7 inside the 700 ms
// budget, then a digits pass on the right 40%) only when Paddle gave no code
// or no number, the primary result is non-empty, and at most once per 2
// frames. The Acceptor (3 agreeing reads of the last 4 + the per-reader
// confidence bar) decides; its decision drives the camera's phases
// (cameraFlow.ts). No DOM here: the frame, the readers and the clock are
// injected, so the loop is testable with a stub reader.

export const READ_BUDGET_MS = 700;
/** After WRONG CARD (or "Neither / scan again") the same key is not prompted
 * again for 3 s, so the read the user just rejected does not pop straight
 * back when the scan restarts. It is not a double-add guard: BL-262 (owner
 * 2026-10-13) removed this wait after an ADD -- the hold, the Fast add
 * "until the card leaves the frame" rule and the Acceptor's own duplicate
 * window cover that (app.js:829 applied it after every decision). */
export const WRONG_CARD_QUIET_MS = 3000;

/** What the loop is resumed after:
 *   add       -- Add in the prompt: nothing is held back; the same card is
 *                 read (and prompted) again by the reader's own rules.
 *   fast_add   -- an add under Fast add: the Acceptor ignores the key until
 *                 the card has left the frame (the spike's auto-accept rule).
 *   wrong_card -- the key stays quiet for WRONG_CARD_QUIET_MS. */
export type ResumeAfter = "add" | "fast_add" | "wrong_card";
/** The partial-read window for the keypad prefill (app.js:1017-1022). */
export const PARTIAL_WINDOW = 8;

export interface ReaderOut {
  ok: true;
  text: string;
  confidence: number | null;
  ms: number;
  glyph_px: number | null;
  box_count?: number;
}
export interface ReaderFail {
  ok: false;
  reason: string;
}
export type ReaderResult = ReaderOut | ReaderFail;

export interface FrameSample {
  /** The sharpness gate value of this frame's crop (null = no text band). */
  gate: number | null;
}

export interface LoopDeps {
  catalog: Catalog;
  acceptor: Acceptor;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Grab + measure the crop of the current frame; null = no frame yet. */
  frame(): FrameSample | null;
  /** Paddle on the colour crop of the frame just measured. */
  primary(): Promise<ReaderResult>;
  /** Tesseract on the processed crop (loads Tesseract on the first call). */
  fallback(psm: number): Promise<ReaderResult>;
  /** Tesseract digits pass on the right 40% (`T0123456789/`, PSM 7). */
  digits(): Promise<ReaderResult>;
}

export interface PartialRead {
  code: string | null;
  num: string | null;
}

export interface Accepted {
  key: string;
  ev: Evaluation;
  card: CandidateCard;
  reader: "paddle" | "tesseract";
  keyStrength: "weak" | "strong";
  /** First text -> acceptance, ms (null when no text was timed). */
  tAcceptMs: number | null;
  decision: Decision;
}

export type LoopStatus =
  | { kind: "searching"; reason: string | null }
  | { kind: "small"; key: string; glyph: number | null }
  | { kind: "confirming"; key: string; agree: number }
  | { kind: "suppressed"; key: string }
  | { kind: "held"; key: string };

export interface LoopEvents {
  /** Every frame measured: the gate value (the meter). */
  onGate?(gate: number | null, threshold: number): void;
  onStatus?(s: LoopStatus): void;
  /** An exact read reached agreement and is not suppressed: the loop pauses. */
  onAccept?(a: Accepted): void;
  /** An ambiguous read (a pick): the loop pauses. */
  onAmbiguous?(ev: Evaluation, reason: string, tAcceptMs: number | null): void;
  /** A reader failed for good (the Paddle init): the camera falls back. */
  onReaderFailure?(reason: string): void;
}

interface OcrOut {
  ev: Evaluation;
  out: ReaderOut;
  reader: "paddle" | "tesseract";
  pass2: ReaderOut | null;
  fallbackUsed: boolean;
  fallbackSkipped: string | null;
}

const EMPTY_OUT: ReaderOut = { ok: true, text: "", confidence: null, ms: 0, glyph_px: null };

/** A primary failure that means the reader is gone, not one bad frame. */
export function isFatalReaderFailure(reason: string): boolean {
  return /^(init|worker|not_ready|disposed|post_failed)/.test(reason);
}

/** First text -> prompt, bucketed for scan_recognised (S7-18). */
export function timeBucket(ms: number | null): "<1s" | "1-2s" | "2-5s" | "5-10s" | ">10s" {
  const v = ms ?? 0;
  if (v < 1000) return "<1s";
  if (v < 2000) return "1-2s";
  if (v < 5000) return "2-5s";
  if (v < 10000) return "5-10s";
  return ">10s";
}

/** S7-16 (app.js:1017-1022): the newest read among the last 8 with a parsed
 * code or number. */
export function partialRead(reads: PartialRead[]): PartialRead | null {
  for (let i = reads.length - 1; i >= 0 && i >= reads.length - PARTIAL_WINDOW; i--) {
    if (reads[i].code || reads[i].num) return reads[i];
  }
  return null;
}

export class ScanLoop {
  running = false;
  paused = false;
  private busy = false;
  private fb = { frame: 0, last: -99 };
  private firstTextT: number | null = null;
  /** The key Wrong card rejected, and until when it stays quiet. */
  private suppress: { key: string; until: number } | null = null;
  /** The key of the previous ambiguous read (cleared by any other read):
   * a pick opens only on a second consecutive read of the same key. */
  private ambiguousKey: string | null = null;
  /** The last OCR'd reads' parsed code / number (newest last, capped). */
  reads: PartialRead[] = [];
  /** Counters the tests read. */
  stats = { frames: 0, skippedBlur: 0, ocr: 0, fallbackUsed: 0, fallbackSkipped: 0 };

  constructor(
    private deps: LoopDeps,
    private events: LoopEvents = {}
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resetCycle();
    this.ambiguousKey = null;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  /** The cycle clock behind the first-text timing (app.js resetCycle). */
  resetCycle(): void {
    this.firstTextT = null;
  }

  pause(): void {
    this.paused = true;
  }

  /** app.js:271-273 decide(): resume after a decision on `key`.
   *   wrong_card: the key is not prompted again for 3 s since the resume.
   *   fast_add:   the Acceptor holds the key until the card leaves (the
   *               spike's auto-accept rule, ACC.markAccepted), so a card
   *               left in frame is never counted twice.
   *   add:        neither (BL-262: no timed wait after an add). */
  resume(key: string | null, after: ResumeAfter): void {
    const t = this.deps.now();
    if (key && after === "wrong_card") this.suppress = { key, until: t + WRONG_CARD_QUIET_MS };
    this.deps.acceptor.reset();
    if (key && after === "fast_add") this.deps.acceptor.markAccepted(key, t);
    this.resetCycle();
    this.ambiguousKey = null;
    this.paused = false;
  }

  private async loop(): Promise<void> {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      await this.readOnce();
    } catch {
      /* a read error never stops the loop (app.js:527) */
    }
    this.busy = false;
    if (this.running) setTimeout(() => void this.loop(), 0);
  }

  /** One frame (app.js:674-723). Exposed for the tests. */
  async readOnce(): Promise<void> {
    const d = this.deps;
    if (this.paused) return d.sleep(120);
    const f = d.frame();
    if (!f) return d.sleep(200);
    this.stats.frames++;
    const tStart = d.now();
    const gv = f.gate;
    this.events.onGate?.(gv, BLUR_THRESHOLD);
    if (isBlurry(gv)) {
      this.stats.skippedBlur++;
      this.handle({ result: "skipped" } as unknown as Evaluation, d.now(), {});
      return d.sleep(80);
    }
    const o = await this.ocrRead(tStart);
    if (!o) return d.sleep(80);
    this.stats.ocr++;
    if (this.paused || !this.running) return;
    const ev = o.ev;
    const tNow = d.now();
    const alnum = (o.out.text.match(/[A-Z0-9]/g) || []).length;
    if (alnum >= 3 && this.firstTextT == null) this.firstTextT = tNow;
    const rd = ev.best && ev.best.reading ? ev.best.reading : ev.parse.readings[0] || null;
    this.reads.push({ code: ev.parse.code, num: rd ? rd.numRaw : null });
    if (this.reads.length > PARTIAL_WINDOW)
      this.reads.splice(0, this.reads.length - PARTIAL_WINDOW);
    const small = isSmall(o.out.glyph_px);
    const rdg = ev.result === "exact" && ev.best && ev.best.reading ? ev.best.reading : null;
    const ks = rdg && ev.parse.code ? d.catalog.keyStrength(ev.parse.code, rdg) : null;
    this.handle(ev, tNow, {
      conf: o.out.confidence,
      weak: ks ? ks.strength === "weak" : false,
      reader: o.reader,
      small,
      glyph: o.out.glyph_px,
    });
  }

  /** app.js:574-603 ocrRead (primary + fallback) + lenCheck. Null when the
   * primary failed and no fallback could run. */
  private async ocrRead(tStart: number): Promise<OcrOut | null> {
    const d = this.deps;
    const p = await d.primary();
    if (!p.ok) {
      // The reader never came up (init failure / timeout, dead worker): the
      // camera stops and offers the keypad (S7-05 / S7-16).
      if (isFatalReaderFailure(p.reason)) {
        this.running = false;
        this.events.onReaderFailure?.(p.reason);
        return null;
      }
      // app.js:598: a primary read error falls back to Tesseract.
      const t = await this.ocrWithFallbacks(tStart);
      if (!t) return null;
      return this.lenCheck({
        ...t,
        reader: "tesseract",
        fallbackUsed: true,
        fallbackSkipped: null,
      });
    }
    const o: OcrOut = {
      ev: d.catalog.evaluate(p.text),
      out: p,
      reader: "paddle",
      pass2: null,
      fallbackUsed: false,
      fallbackSkipped: null,
    };
    this.fb.frame++;
    const needs = !(o.ev.parse.code && o.ev.parse.readings.length);
    if (needs) {
      const hasText = String(p.text || "").replace(/\s/g, "").length >= 2;
      const hasBox = (p.box_count || 0) > 0;
      if (!hasText && !hasBox) o.fallbackSkipped = "primary_empty";
      else if (this.fb.frame - this.fb.last < 2) o.fallbackSkipped = "rate_cap_1_per_2_frames";
    }
    if (needs && o.fallbackSkipped) this.stats.fallbackSkipped++;
    if (needs && !o.fallbackSkipped) {
      this.fb.last = this.fb.frame;
      this.stats.fallbackUsed++;
      const t = await this.ocrWithFallbacks(tStart);
      o.fallbackUsed = true;
      if (t && t.ev.parse.code && t.ev.parse.readings.length) {
        o.ev = t.ev;
        o.out = t.out;
        o.reader = "tesseract";
        o.pass2 = t.pass2;
      }
    }
    return this.lenCheck(o);
  }

  /** app.js:605-614: an exact no-denominator read whose digits pass sees a
   * longer digit run is not trusted. */
  private async lenCheck(o: OcrOut): Promise<OcrOut> {
    const ev = o.ev;
    if (ev.result !== "exact" || !ev.best || !ev.best.reading || ev.best.reading.den != null)
      return o;
    let p2 = o.pass2;
    if (!p2) {
      const x = await this.deps.digits();
      p2 = x.ok ? x : null;
      o.pass2 = p2;
    }
    if (p2 && numLenConflict(ev.best.reading, p2.text)) {
      ev.result = "invalid";
      ev.reason = "num_len_conflict";
    }
    return o;
  }

  /** app.js:615-643: Tesseract PSM 6, then 7 within the budget, then the
   * digits pass when a code was read without a number. */
  private async ocrWithFallbacks(
    tStart: number
  ): Promise<{ ev: Evaluation; out: ReaderOut; pass2: ReaderOut | null } | null> {
    const d = this.deps;
    const first = await d.fallback(6);
    if (!first.ok) return null;
    let out: ReaderOut = first;
    let ev = d.catalog.evaluate(first.text);
    const queue = [7];
    let lastMs = first.ms;
    while (!(ev.parse.code && ev.parse.readings.length) && queue.length) {
      if (d.now() - tStart + lastMs > READ_BUDGET_MS) break;
      const psm = queue.shift() as number;
      const o = await d.fallback(psm);
      if (!o.ok) break;
      lastMs = o.ms;
      const e2 = d.catalog.evaluate(o.text);
      if (e2.parse.code && (e2.parse.readings.length || !ev.parse.code)) {
        ev = e2;
        out = o;
      }
    }
    if (ev.parse.code && !ev.parse.readings.length) {
      const o2 = await d.digits();
      if (o2.ok) {
        const ev2 = d.catalog.evaluate(ev.parse.code + " EN " + o2.text);
        if (ev2.result !== "invalid" || ev2.parse.readings.length) ev = ev2;
        return { ev, out, pass2: o2 };
      }
    }
    return { ev, out: out ?? EMPTY_OUT, pass2: null };
  }

  /** app.js:844-912 handleResult, prompt mode only. */
  private handle(
    ev: Evaluation | { result: "skipped" },
    tNow: number,
    meta: {
      conf?: number | null;
      weak?: boolean;
      reader?: "paddle" | "tesseract";
      small?: boolean;
      glyph?: number | null;
    }
  ): void {
    const acc = this.deps.acceptor;
    const isSkip = ev.result === "skipped";
    const full = ev as Evaluation;
    const key = !isSkip && full.best ? full.best.key : null;
    const dcs = acc.feed({
      t: tNow,
      result: isSkip ? "skipped" : full.result,
      key: !isSkip && full.result === "exact" ? key : null,
      conf: meta.conf,
      weak: !!meta.weak,
      small: !!meta.small,
      reader: meta.reader || "tesseract",
    });
    if (dcs.rearm) this.resetCycle();
    // A clean (non-ambiguous) read supersedes a pending ambiguous one.
    if (!isSkip && full.result !== "ambiguous") this.ambiguousKey = null;
    if (isSkip) {
      if (!acc.blocked) this.events.onStatus?.({ kind: "searching", reason: "blurry" });
      return;
    }
    if (dcs.state === "hold") {
      this.events.onStatus?.({ kind: "held", key: acc.blocked ? acc.blocked.key : "" });
      return;
    }
    const tAcc = this.firstTextT != null ? Math.round(tNow - this.firstTextT) : null;
    if (full.result === "exact" && full.best && key) {
      const c = full.best.cards[0];
      if (meta.small) {
        this.events.onStatus?.({ kind: "small", key, glyph: meta.glyph ?? null });
        return;
      }
      if (dcs.accept) {
        // Wrong card on this key less than 3 s ago: not prompted again yet.
        if (this.suppress && this.suppress.key === key && tNow < this.suppress.until) {
          acc.reset();
          this.events.onStatus?.({ kind: "suppressed", key });
          return;
        }
        this.suppress = null;
        this.paused = true;
        this.events.onAccept?.({
          key,
          ev: full,
          card: c,
          reader: meta.reader || "tesseract",
          keyStrength: dcs.key_strength || "weak",
          tAcceptMs: tAcc,
          decision: dcs,
        });
        return;
      }
      this.events.onStatus?.({ kind: "confirming", key, agree: dcs.agree || 1 });
      return;
    }
    if (full.result === "ambiguous" && full.best) {
      // "Neither / scan again" is Wrong card for a pick: the same pick is not
      // shown again for 3 s (the spike re-showed choices only on a new key).
      if (this.suppress && this.suppress.key === full.best.key && tNow < this.suppress.until) {
        this.events.onStatus?.({ kind: "suppressed", key: full.best.key });
        return;
      }
      // One noisy frame (a number_conflict / reading_conflict on trailing
      // noise) is superseded by the next clean read, as in the spike: pause
      // for a pick only on two consecutive same-key ambiguous reads.
      if (this.ambiguousKey !== full.best.key) {
        this.ambiguousKey = full.best.key;
        this.events.onStatus?.({ kind: "searching", reason: full.reason || null });
        return;
      }
      this.ambiguousKey = null;
      this.paused = true;
      this.events.onAmbiguous?.(full, full.reason || full.best.reason, tAcc);
      return;
    }
    this.events.onStatus?.({ kind: "searching", reason: full.reason || null });
  }
}
