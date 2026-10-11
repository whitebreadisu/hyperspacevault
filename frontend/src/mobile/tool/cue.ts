// BL-253 S7-17: the camera's recognition cue's sound half -- a port of the
// spike's fbAudioUnlock / feedback() oscillator (app.js:952-977), minus the
// research logging and minus `navigator.vibrate` (owner: no haptics -- iOS has
// no Vibration API; the call is deliberately absent). The visual half (the
// green full-screen flash) is the camera screen's. Lives under tool/ (not
// camera/) because the header's camera-mode and Fast add taps -- the user
// gestures iOS needs to start audio -- are in ToolLayer, which the main
// document loads; nothing here is scanner code.

interface AudioCtxLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void> | void;
  createOscillator(): {
    frequency: { value: number };
    connect(n: unknown): void;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(v: number, t: number): void;
      exponentialRampToValueAtTime(v: number, t: number): void;
    };
    connect(n: unknown): void;
  };
}

let ctx: AudioCtxLike | null = null;

/** Beep attempts (e2e / vitest observe the cue without hearing it). */
export const cueCounts = { beeps: 0, sounded: 0 };

/** Create / resume the AudioContext. Call from inside a user tap (iOS starts
 * audio only there). Never throws; returns the context state or a reason. */
export function audioUnlock(): string {
  try {
    const w = window as unknown as {
      AudioContext?: new () => AudioCtxLike;
      webkitAudioContext?: new () => AudioCtxLike;
    };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return "no AudioContext";
    if (!ctx) ctx = new AC();
    if (ctx.state !== "running") void ctx.resume();
    return ctx.state;
  } catch (e) {
    return "error: " + String((e as Error)?.message ?? e);
  }
}

/** The beep: 1320 Hz, gain 0.0001 -> 0.2 (10 ms) -> 0.0001 (80 ms), stop at
 * +90 ms (app.js:970-977). Silent (no throw) without a running context. */
export function beep(): boolean {
  cueCounts.beeps++;
  try {
    if (!ctx || ctx.state !== "running") return false;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.09);
    cueCounts.sounded++;
    return true;
  } catch {
    return false;
  }
}

/** Test seam. */
export function resetCueForTest(): void {
  ctx = null;
  cueCounts.beeps = 0;
  cueCounts.sounded = 0;
}
