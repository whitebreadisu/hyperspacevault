import type { CardSet } from "../../api/sets";
import type { InventoryCard } from "../../utils/inventory";
import { removeCopy } from "../tool/batch";
import { beep } from "../tool/cue";
import { padView, toCatalog } from "../tool/padModel";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import { getScanSettings } from "../tool/scanSettings";
import { NO_PICKS, addPadEntry, getToolState, setToolState } from "../tool/toolStore";
import {
  CameraFlow,
  SETTLE_MS,
  SETTLE_OFF,
  settleEnd,
  settleFrame,
  settleStart,
  settleStatus,
} from "./cameraFlow";
import type { Phase, PickRow, SettleState, SettleStatus } from "./cameraFlow";
import { CameraStream } from "./cameraStream";
import type { StreamLike, StreamState } from "./cameraStream";
import { guideRectInVideo, layoutGuide } from "./guide";
import { FramePipeline, gateValue, meterView } from "./imagePipeline";
import type { Measure, MeterBand } from "./imagePipeline";
import { scanDecision, scanPickShown, scanRecognised } from "./scanAnalytics";
import { buildScanCatalog } from "./scanCatalog";
import { Acceptor, Catalog } from "./scanCore";
import { ScanLoop, partialRead } from "./scanLoop";
import type { LoopStatus, PartialRead, ReaderResult } from "./scanLoop";
import type { ScanDebug } from "./scanBoot";

// BL-253 S7-10 / S7-13 / S7-14: the camera screen's imperative half -- the
// stream, the frame pipeline, the read loop and the decision flow wired
// together, outside React (the screen renders from `getSnapshot()` and feeds
// `setInputs()`). Everything the loop reads at frame time (the catalogue, the
// stage size, the slider offsets, the auth state) lives here, never in React
// refs read during render.

export interface CameraInputs {
  cards: InventoryCard[];
  sets: CardSet[];
  isAuthenticated: boolean;
  onRequestSignIn: () => void;
  offsets: { h: number; v: number };
  size: { w: number; h: number };
}

export interface CameraSnapshot {
  phase: Phase;
  stream: StreamState;
  gate: { pct: number; band: MeterBand };
  status: LoopStatus | null;
  readerFail: string | null;
  /** performance.now() of the last cue (0 = none yet). */
  flashAt: number;
  /** The newest partial read (S7-16), or null. */
  partial: PartialRead | null;
  /** FR5-03: the camera-start focusing state ("settling" = the guide is dim). */
  settle: SettleStatus;
}

const now = () => performance.now();

export class CameraController {
  private inputs: CameraInputs = {
    cards: [],
    sets: [],
    isAuthenticated: false,
    onRequestSignIn: () => {},
    offsets: { h: 0, v: 0 },
    size: { w: 0, h: 0 },
  };
  private catalog: Catalog | null = null;
  private padCatalog: AddCardsCatalogEntry[] = [];
  private catalogFor: InventoryCard[] | null = null;
  private video: HTMLVideoElement | null = null;
  private current: StreamLike | null = null;
  private pipeline: FramePipeline | null = null;
  private measured: Measure | null = null;
  private prepared = false;
  private blocked = false;
  private settle: SettleState = SETTLE_OFF;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private wasLive = false;
  private subs = new Set<() => void>();
  private snap: CameraSnapshot;
  readonly stream: CameraStream;
  readonly loop: ScanLoop;
  readonly flow: CameraFlow;

  constructor(private scan: ScanDebug) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.stream = new CameraStream({
      getUserMedia: (c) =>
        navigator.mediaDevices
          ? (navigator.mediaDevices.getUserMedia(c) as Promise<StreamLike>)
          : Promise.reject(Object.assign(new Error("no mediaDevices"), { name: "NotFoundError" })),
      attach: (s) => {
        this.current = s;
        this.show();
      },
    });
    this.loop = new ScanLoop(
      {
        get catalog() {
          return self.catalog as Catalog;
        },
        acceptor: new Acceptor({ rearmDiffN: Infinity }), // app.js:797 prompt mode
        now,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        frame: () => this.frame(),
        primary: () => this.primary(),
        fallback: (psm) => this.tesseract(false, psm),
        digits: () => this.tesseract(true, 7),
      },
      {
        onGate: (v, thr) => {
          const mv = meterView(v, thr);
          const g = this.snap.gate;
          if (g.band !== mv.band || Math.abs(g.pct - mv.pct) >= 0.01)
            this.patch({ gate: { pct: mv.pct, band: mv.band } });
          // FR5-03: the first frame that is not blurry ends the focusing state.
          this.setSettle(settleFrame(this.settle, mv.band, now()));
        },
        onStatus: (s) => this.patch({ status: s, partial: partialRead(this.loop.reads) }),
        onAccept: (a) => this.flow.accepted(a),
        onAmbiguous: (ev, reason) => this.flow.ambiguous(ev, reason),
        onReaderFailure: (reason) => this.patch({ readerFail: reason }),
      }
    );
    this.flow = new CameraFlow({
      now,
      fastAdd: () => getScanSettings().fastAdd,
      cue: () => {
        beep();
        this.patch({ flashAt: now() });
      },
      add: (target, via) => {
        const I = this.inputs;
        if (!I.isAuthenticated) {
          I.onRequestSignIn();
          return null;
        }
        const picks = via === "camera" ? getToolState().picks : NO_PICKS;
        const v = padView(target.setCode, target.cardNumber, picks, this.padCatalog, I.cards);
        if (v.kind !== "card" || v.resolved.status !== "resolved" || !v.variant || !v.card)
          return null;
        addPadEntry({
          via,
          force: false,
          setCode: target.setCode,
          cardNumber: target.cardNumber,
          picks,
          variantId: v.variant.variant_id,
          baseCardId: v.card.base_card_id,
        });
        return getToolState().lastAdded?.entryId ?? null;
      },
      remove: (id) => removeCopy(id),
      resume: (key, holdUntilGone) => {
        this.loop.resume(key, holdUntilGone);
        if (this.blocked) this.loop.pause();
      },
      setTimer: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      recognised: (a) => scanRecognised(a),
      pickShown: (r) => scanPickShown(r),
      decision: (d) => scanDecision(d),
    });
    this.snap = {
      phase: this.flow.phase,
      stream: this.stream.state,
      gate: { pct: 0, band: "red" },
      status: null,
      readerFail: null,
      flashAt: 0,
      partial: null,
      settle: "off",
    };
    this.flow.subscribe(() => {
      const p = this.flow.phase;
      // A new prompt starts with no axis picks (the keypad's chips are shared).
      if (p.kind === "found" && this.snap.phase !== p) setToolState({ picks: NO_PICKS });
      this.patch({ phase: p, partial: partialRead(this.loop.reads) });
      // FR5-03: a card read while the guide is dim ends the focusing state.
      if (p.kind !== "searching") this.setSettle(settleEnd(this.settle, "read", now()));
    });
    this.stream.subscribe(() => {
      this.patch({ stream: this.stream.state });
      // FR5-03: every stream start begins the focusing state; no stream, none.
      const live = this.stream.live;
      if (live && !this.wasLive) this.setSettle(settleStart(now()));
      else if (!live) this.setSettle(SETTLE_OFF);
      this.wasLive = live;
      this.syncLoop();
    });
  }

  /** FR5-03: hold the focusing state, publish its status when it changes, and
   * keep one timer for the SETTLE_MS limit while it is settling. */
  private setSettle(s: SettleState): void {
    this.settle = s;
    const status = settleStatus(s, now());
    if (this.settleTimer !== null && status !== "settling") {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    if (status === "settling" && this.settleTimer === null && s.startedAt !== null) {
      const left = Math.max(0, s.startedAt + SETTLE_MS - now());
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.setSettle(this.settle); // re-arms if the timer fired early
      }, left + 1);
    }
    if (status !== this.snap.settle) this.patch({ settle: status });
  }

  subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  };

  getSnapshot = (): CameraSnapshot => this.snap;

  private patch(p: Partial<CameraSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    this.subs.forEach((f) => f());
    if ("readerFail" in p) this.syncLoop();
  }

  private syncLoop(): void {
    if (this.stream.live && !this.snap.readerFail) this.loop.start();
    else this.loop.stop();
  }

  setInputs(i: CameraInputs): void {
    this.inputs = i;
    if (i.cards !== this.catalogFor) {
      this.catalogFor = i.cards;
      this.catalog = i.cards.length ? new Catalog(buildScanCatalog(i.cards, i.sets)) : null;
      this.padCatalog = toCatalog(i.cards);
    }
  }

  attachVideo = (v: HTMLVideoElement | null): void => {
    this.video = v;
    if (v && !this.pipeline) this.pipeline = new FramePipeline(v.ownerDocument);
    this.show();
  };

  /** Put the live stream (or nothing) on the preview element. */
  private show(): void {
    const v = this.video;
    if (!v) return;
    const s = this.current as MediaStream | null;
    if (v.srcObject !== s) v.srcObject = s;
    if (s) void v.play()?.catch?.(() => {});
  }

  /** Mount: start the stream and the reader; the page hiding stops the
   * stream (app.js:1327-1330). Returns the unmount. */
  mount(): () => void {
    void this.stream.start();
    void this.scan.startReader();
    const vis = () => {
      if (document.visibilityState === "hidden") this.stream.stop("paused");
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      this.stream.stop();
      this.loop.stop();
      this.flow.dispose();
    };
  }

  /** Something is over the preview (card layer, sheet, guard): no reads. */
  setBlocked(b: boolean): void {
    this.blocked = b;
    if (b) this.loop.pause();
    else if (this.flow.phase.kind === "searching") this.loop.paused = false;
  }

  startStream(): void {
    void this.stream.start();
  }

  add = (): void => this.flow.add();
  wrongCard = (): void => this.flow.wrongCard();
  pick = (r: PickRow): void => this.flow.pick(r);
  details = (): void => this.flow.details();

  // ── Loop deps ──────────────────────────────────────────────────────────
  private frame(): { gate: number | null } | null {
    const v = this.video;
    const I = this.inputs;
    if (!v || !this.catalog || !this.pipeline || !v.videoWidth || !I.size.w) return null;
    const g = layoutGuide(
      I.size.w,
      I.size.h,
      v.videoWidth,
      v.videoHeight,
      I.offsets.h,
      I.offsets.v
    );
    const r = guideRectInVideo(g, v.videoWidth, v.videoHeight);
    if (!r || r.w < 8 || r.h < 8) return null;
    const m = this.pipeline.measure(v, r);
    m.implied_text_px = g.impliedTextPx;
    this.measured = m;
    this.prepared = false;
    return { gate: gateValue(m) };
  }

  private async primary(): Promise<ReaderResult> {
    const init = await this.scan.startReader();
    if (!init.ok) return { ok: false, reason: init.reason };
    const m = this.measured;
    if (!m || !this.pipeline) return { ok: false, reason: "no_frame" };
    const c = this.pipeline.colourFixedWidth(m);
    let frame: ImageBitmap | ImageData;
    try {
      frame = await createImageBitmap(c);
    } catch {
      const ctx = c.getContext("2d");
      if (!ctx) return { ok: false, reason: "no_canvas" };
      frame = ctx.getImageData(0, 0, c.width, c.height);
    }
    return this.scan.reader.read(frame);
  }

  private async tesseract(digits: boolean, psm: number): Promise<ReaderResult> {
    const e = await this.scan.fallback.ensure();
    if (!e.ok) return e;
    const m = this.measured;
    if (!m || !this.pipeline) return { ok: false, reason: "no_frame" };
    if (!this.prepared) {
      this.pipeline.scaleAndClean(m);
      this.prepared = true;
    }
    return digits
      ? this.scan.fallback.read(this.pipeline.rightPart(), { whitelist: "T0123456789/", psm: 7 })
      : this.scan.fallback.read(this.pipeline.processed, { psm });
  }
}
