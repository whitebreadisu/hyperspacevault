// BL-253 S7-10: camera start / stop (spike app.js:107-149, 250-261), without
// the spike's device / resolution pickers and research logging. The request
// is the spike's: facingMode environment, ideal 3840 x 2160, no audio. On
// start the zoom is put back to 1.0 if the camera did not start there -- the
// only zoom ever applied (no automatic zoom; Spec 24.2). A track the phone
// ends -> "ended" (the screen offers Start); permission denied / no camera ->
// an inline state with "Use the keypad" (never `alert`). The page going
// hidden stops the stream (and the screen stops the loop).

export type StreamState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "paused" }
  | { kind: "ended" }
  | { kind: "denied" }
  | { kind: "nocamera" }
  | { kind: "error"; message: string };

interface TrackLike {
  stop(): void;
  readyState?: string;
  addEventListener(t: "ended", f: () => void): void;
  removeEventListener?(t: "ended", f: () => void): void;
  getCapabilities?(): { zoom?: { min: number; max: number } };
  getSettings?(): { zoom?: number };
  applyConstraints?(c: unknown): Promise<void>;
}
export interface StreamLike {
  getTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
}

export interface StreamDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<StreamLike>;
  attach(s: StreamLike | null): void;
}

/** app.js:112-115 (the spike's "4k" choice, its default). */
export const STREAM_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } },
};

export class CameraStream {
  state: StreamState = { kind: "idle" };
  private stream: StreamLike | null = null;
  private track: TrackLike | null = null;
  private onEnded = () => {
    this.release();
    this.set({ kind: "ended" });
  };
  private subs = new Set<() => void>();
  private gen = 0;

  constructor(private deps: StreamDeps) {}

  subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  };
  getState = (): StreamState => this.state;

  private set(s: StreamState): void {
    this.state = s;
    this.subs.forEach((f) => f());
  }

  get live(): boolean {
    return this.state.kind === "live";
  }

  async start(): Promise<void> {
    this.release();
    const my = ++this.gen;
    this.set({ kind: "starting" });
    let s: StreamLike;
    try {
      s = await this.deps.getUserMedia(STREAM_CONSTRAINTS);
    } catch (e) {
      if (my !== this.gen) return;
      const name = (e as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") this.set({ kind: "denied" });
      else if (
        name === "NotFoundError" ||
        name === "OverconstrainedError" ||
        name === "NotReadableError"
      )
        this.set({ kind: "nocamera" });
      else this.set({ kind: "error", message: String((e as Error)?.message ?? e) });
      return;
    }
    if (my !== this.gen) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = s;
    this.track = s.getVideoTracks()[0] ?? null;
    this.track?.addEventListener("ended", this.onEnded);
    this.deps.attach(s);
    this.set({ kind: "live" });
    void this.resetZoom();
  }

  /** app.js:250-261 resetNativeZoom: back to 1.0 only if it is not. */
  private async resetZoom(): Promise<void> {
    const t = this.track;
    try {
      const caps = t?.getCapabilities?.() ?? {};
      const st = t?.getSettings?.() ?? {};
      if (
        t?.applyConstraints &&
        caps.zoom &&
        st.zoom != null &&
        st.zoom !== 1 &&
        caps.zoom.min <= 1 &&
        caps.zoom.max >= 1
      )
        await t.applyConstraints({ advanced: [{ zoom: 1 }] });
    } catch {
      /* a camera without zoom control: nothing to put back */
    }
  }

  private release(): void {
    this.gen++;
    this.track?.removeEventListener?.("ended", this.onEnded);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.deps.attach(null);
  }

  /** Stop: the page went hidden (`paused`) or the screen leaves (`idle`). */
  stop(kind: "idle" | "paused" = "idle"): void {
    this.release();
    this.set({ kind });
  }
}
