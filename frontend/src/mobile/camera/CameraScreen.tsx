import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import { useLimits } from "../../context/LimitsContext";
import { SWUButton } from "../../components/SWUButton";
import { go } from "../router";
import { Sheet } from "../Sheet";
import { cellImage } from "../vault/cardImage";
import { Playset } from "../vault/Playset";
import { useVaultData } from "../vault/useVaultData";
import { useBatch } from "../tool/batch";
import { cameraKeypadRoute, setCameraKeypadExit } from "../tool/cameraHop";
import type { CameraScreenProps } from "../tool/cameraHop";
import { audioUnlock } from "../tool/cue";
import { Identified, VerifyButton } from "../tool/Pad";
import { padReadout, padView, toCatalog } from "../tool/padModel";
import { OFFSET_LIMIT_MM, setScanSettings, useScanSettings } from "../tool/scanSettings";
import { NO_PICKS, setToolMode, useToolState } from "../tool/toolStore";
import { HOLD_MS, programName } from "./cameraFlow";
import type { Phase, PickRow } from "./cameraFlow";
import { CameraController } from "./cameraController";
import { layoutGuide } from "./guide";
import type { GuideLayout } from "./guide";
import { Meter } from "./Meter";
import type { MeterMode } from "./Meter";
import { cameraScreenViewed, scanFallbackKeypad } from "./scanAnalytics";
import type { ScanDebug } from "./scanBoot";
import "./camera.css";

// BL-253 S7-10 .. S7-17: the camera screen (rev4 MCamera.jsx, rendered
// reference; the spike's behaviour). Body of the tool layer in camera mode:
// the live preview (a real <video playsinline muted autoplay>, object-fit
// cover) under the guide (bottom-right corner outline, the group box, the
// surroundings dimmed for the user only -- the reader samples the <video>),
// the sharpness meter with the Keypad link, the rising panel (found / hold /
// pick), the Guide alignment control, and the bottom bar with the shared
// Verify button. Reading pauses while a panel, a sheet, the close guard or the
// card layer is up; the stream stops when the page hides or the screen leaves.
// No toast, no haptics, no zoom control, no orientation toggle, no demo strip.

const FLASH_MS = 180; // app.js:961-965 bigFlash
const PARTIAL_SETS = /^[A-Z0-9]{2,5}$/;

interface Bound extends CameraScreenProps {
  scan: ScanDebug;
}

function useSize(el: HTMLElement | null): { w: number; h: number } {
  const [s, setS] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return undefined;
    const on = () => setS({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
    ro?.observe(el);
    window.addEventListener("resize", on);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", on);
    };
  }, [el]);
  return s;
}

function Guide({ g, phase }: { g: GuideLayout; phase: Phase["kind"] }) {
  const tone =
    phase === "pick"
      ? " m-guide__box--amber"
      : phase === "found" || phase === "hold"
        ? " m-guide__box--read"
        : "";
  return (
    <>
      <span
        className="m-guide__card"
        style={{
          left: g.card.x,
          top: g.card.y,
          width: g.card.w,
          height: g.card.h,
          borderBottomRightRadius: g.card.radius,
        }}
      />
      <span
        className={"m-guide__box" + tone}
        style={{ left: g.box.x, top: g.box.y, width: g.box.w, height: g.box.h }}
      >
        <span
          className="m-guide__mk m-guide__mk--set"
          style={{ left: g.markers.setLeft + "%", width: g.markers.setWidth + "%" }}
        >
          Set • EN
        </span>
        <span
          className="m-guide__mk m-guide__mk--num"
          style={{ right: g.markers.numRight + "%", width: g.markers.numWidth + "%" }}
        >
          Number
        </span>
      </span>
    </>
  );
}

function Panel({ children, tone }: { children: ReactNode; tone?: string | null }) {
  return (
    <div className={"m-cam__panel" + (tone ? " m-cam__panel--" + tone : "")}>
      <div className="m-cam__panelin">{children}</div>
    </div>
  );
}

/** S7-11: one +/-4 mm slider (index.html:39-40): `input` re-lays the guide
 * out live, the native `change` (the release) persists (app.js:1303-1306). */
function OffsetSlider({
  label,
  aria,
  value,
  onLive,
  onCommit,
}: {
  label: string;
  aria: string;
  value: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [el, setEl] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!el) return undefined;
    const on = () => onCommit(+el.value);
    el.addEventListener("change", on);
    return () => el.removeEventListener("change", on);
  }, [el, onCommit]);
  return (
    <label className="m-camalign__row">
      <span className="m-camalign__l">
        {label}
        <b className="m-camalign__v">{value.toFixed(1)}</b>
      </span>
      <input
        ref={setEl}
        type="range"
        min={-OFFSET_LIMIT_MM}
        max={OFFSET_LIMIT_MM}
        step={0.1}
        value={value}
        aria-label={aria}
        onChange={(e) => onLive(+e.target.value)}
      />
    </label>
  );
}

const commitH = (v: number) => setScanSettings({ boxOffsetMm: v });
const commitV = (v: number) => setScanSettings({ boxOffsetVMm: v });

/** S7-11: the "Guide alignment" sheet (X top-right): the two sliders and a
 * reset to 0. Zoom / torch / focus controls are out (ruling 6). */
function AlignSheet({
  live,
  onLive,
  onClose,
}: {
  live: { h: number; v: number };
  onLive: (v: { h: number; v: number }) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Guide alignment" labelId="m-cam-align" onClose={onClose} className="m-camalign">
      <div className="m-camalign__body">
        <OffsetSlider
          label="Box offset (mm, + moves the strip box right of the card outline)"
          aria="Box offset, horizontal, millimetres"
          value={live.h}
          onLive={(h) => onLive({ h, v: live.v })}
          onCommit={commitH}
        />
        <OffsetSlider
          label="Box offset vertical (mm, + moves the strip box up)"
          aria="Box offset, vertical, millimetres"
          value={live.v}
          onLive={(v) => onLive({ h: live.h, v })}
          onCommit={commitV}
        />
        <div className="m-camalign__foot">
          <button
            type="button"
            className="m-textbtn"
            onClick={() => {
              onLive({ h: 0, v: 0 });
              setScanSettings({ boxOffsetMm: 0, boxOffsetVMm: 0 });
            }}
          >
            Reset to 0
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function PickPanel({
  phase,
  onPick,
  onNeither,
}: {
  phase: Extract<Phase, { kind: "pick" }>;
  onPick: (r: PickRow) => void;
  onNeither: () => void;
}) {
  const { cards, isAuthenticated } = useVaultData();
  const collision = phase.reason === "printed_code_collision";
  return (
    <Panel tone="amber">
      <div className="m-cam__strip">
        <span className="m-cam__state m-cam__state--amber">
          <span className="m-cam__dot" aria-hidden="true" />
          {phase.rows.length === 2 ? "Two cards" : phase.rows.length + " cards"}
          <span className="m-cam__code">{phase.key}</span>
        </span>
      </div>
      <p className="m-cam__pickq">
        {collision
          ? "This code is printed on two promos. Pick the card you have."
          : "This code matches more than one card. Pick the card you have."}
      </p>
      <div className="m-cam__picks" role="group" aria-label="Pick the card you have">
        {phase.rows.map((r) => {
          const card = cards.find((c) => c.variants.some((v) => r.vids.includes(v.variant_id)));
          const variant = card?.variants.find((v) => r.vids.includes(v.variant_id)) ?? null;
          const img = card && variant ? cellImage(card, variant, "thumb", "60px") : null;
          return (
            <button
              key={r.id}
              type="button"
              className="m-result m-cam__pick"
              data-set={r.target.setCode}
              onClick={() => onPick(r)}
            >
              <span className="m-result__thumb m-cam__pickthumb">
                {img?.images ? (
                  <img
                    src={img.images.src}
                    srcSet={img.images.srcSet}
                    sizes={img.images.sizes}
                    onError={img.images.onError}
                    alt=""
                  />
                ) : null}
              </span>
              <span className="m-result__text">
                <span className="m-result__name">{r.target.name}</span>
                <span className="m-cam__program">{programName(r.vt)}</span>
                <span className="m-result__meta">
                  <span className="m-result__num">
                    {r.target.setCode} {r.target.cardNumber}
                  </span>
                  {r.subtitle ? <span className="m-result__subt">{r.subtitle}</span> : null}
                </span>
              </span>
              {card ? (
                <span className="m-cam__owned">
                  <Playset card={card} scope={null} isAuthenticated={isAuthenticated} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="m-cam__pickfoot">
        <button type="button" className="m-textbtn" onClick={onNeither}>
          Neither · scan again
        </button>
      </div>
    </Panel>
  );
}

function FoundPanel({
  phase,
  onAdd,
  onWrong,
  onDetails,
}: {
  phase: Extract<Phase, { kind: "found" | "hold" }>;
  onAdd: () => void;
  onWrong: () => void;
  onDetails: (variantId: number | null) => void;
}) {
  const { cards, isAuthenticated } = useVaultData();
  const { limits, capMode } = useLimits();
  const st = useToolState();
  const batch = useBatch();
  const catalog = useMemo(() => toCatalog(cards), [cards]);
  const hold = phase.kind === "hold";
  const t = phase.target;
  const entry = hold && phase.entryId ? (batch.find((e) => e.id === phase.entryId) ?? null) : null;
  const picks = hold ? (entry?.picks ?? NO_PICKS) : st.picks;
  const view = padView(t.setCode, t.cardNumber, picks, catalog, cards);
  const readout =
    view.kind === "card"
      ? padReadout(t.setCode, t.cardNumber, picks, batch, catalog, limits, capMode)
      : null;
  const inBatch = entry ? batch.filter((b) => b.variantId === entry.variantId).length : 0;
  let body: ReactNode;
  if (view.kind === "card") {
    const res = view.resolved;
    const canAdd = res.status === "resolved" && !!view.variant;
    body = (
      <Identified
        name={res.card.needsPick ? "Which card is it?" : (res.name ?? t.name)}
        subtitle={res.card.needsPick ? null : res.subtitle}
        card={view.card}
        variant={view.variant}
        readout={hold ? null : readout}
        signedIn={isAuthenticated}
        choices={hold ? [] : view.choices}
        hint={hold ? null : view.hint}
        note={null}
        compact={!hold && view.choices.length > 0}
        justAdded={hold ? phase.at : 0}
        inBatch={hold ? inBatch : undefined}
        hideAdd={hold}
        addLabel="Add to batch"
        canAdd={canAdd && isAuthenticated}
        onAdd={canAdd ? onAdd : () => {}}
        onDetails={
          view.card && view.variant
            ? () => onDetails(view.variant ? view.variant.variant_id : null)
            : null
        }
      />
    );
  } else {
    body = (
      <div className="m-padmsg m-padmsg--error">
        <div className="m-padmsg__err">{t.name}</div>
        <div className="m-padmsg__rec">
          {t.setCode} {t.cardNumber} is not in the catalogue this app loaded.
        </div>
      </div>
    );
  }
  return (
    <Panel tone={hold ? "added" : null}>
      <div className="m-cam__strip">
        <span className={"m-cam__state" + (hold ? " m-cam__state--added" : "")}>
          <span className="m-cam__dot" aria-hidden="true" />
          Read<span className="m-cam__code">{phase.key}</span>
        </span>
        <button
          type="button"
          className="m-textbtn m-cam__wrong"
          onClick={onWrong}
          aria-label={
            hold ? "Wrong card: take this copy back out and scan again" : "Wrong card: scan again"
          }
        >
          Wrong card
        </button>
      </div>
      {hold ? (
        <div className="m-cam__hold" aria-label="Pausing before the next read">
          <span
            className="m-cam__holdbar"
            key={phase.at}
            style={{ animationDuration: HOLD_MS + "ms" }}
          />
          <span className="m-cam__holdtxt">
            {phase.fast ? "Fast add · " : ""}next card in 1.5 s
          </span>
        </div>
      ) : null}
      {body}
    </Panel>
  );
}

const STREAM_TEXT: Record<string, { line: string; sub: string; start: boolean }> = {
  starting: { line: "Starting the camera…", sub: "", start: false },
  ended: { line: "Camera stopped by the phone", sub: "Tap Start to scan again.", start: true },
  paused: { line: "Camera paused", sub: "Tap Start to scan again.", start: true },
  idle: { line: "Camera off", sub: "Tap Start to scan.", start: true },
  denied: {
    line: "Camera access is off",
    sub: "Allow the camera for this site (Safari: aA > Website Settings > Camera), then tap Start.",
    start: true,
  },
  nocamera: {
    line: "No camera found",
    sub: "This device has no camera the page can use.",
    start: false,
  },
};

function CameraScreen({ covered, busy, onRequestSignIn, onOpenCard, onOpenVerify, scan }: Bound) {
  const { cards, sets, setNameByCode, isAuthenticated } = useVaultData();
  const settings = useScanSettings();
  const batch = useBatch();
  const [ctl] = useState(() => new CameraController(scan));
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useEffect(() => ctl.attachVideo(videoEl), [ctl, videoEl]);
  const size = useSize(stageEl);
  const [vdim, setVdim] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState({ h: settings.boxOffsetMm, v: settings.boxOffsetVMm });
  const [alignOpen, setAlignOpen] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const { phase, gate, status, readerFail, partial: loopPartial } = snap;
  const streamState = snap.stream;

  // What the loop reads at frame time.
  useLayoutEffect(() => {
    ctl.setInputs({ cards, sets, isAuthenticated, onRequestSignIn, offsets: live, size });
  });

  useEffect(() => ctl.mount(), [ctl]);

  // S7-18: screen_viewed {screen: "camera"} once per mount.
  useEffect(() => {
    cameraScreenViewed();
  }, []);

  // S7-17: iOS starts audio only inside a user gesture -- any tap while the
  // camera is up unlocks it (the camera-mode tap in ToolLayer already did when
  // the mode was switched inside this document).
  useEffect(() => {
    const on = () => audioUnlock();
    document.addEventListener("pointerdown", on, { capture: true });
    return () => document.removeEventListener("pointerdown", on, { capture: true });
  }, []);

  // Reading pauses while anything is over the preview.
  const blocked = covered || busy || alignOpen;
  useEffect(() => {
    ctl.setBlocked(blocked);
  }, [ctl, blocked, phase.kind]);

  // The flash (rev4 .m-camflash): on for 180 ms (app.js:961-965), then the .35 s fade.
  useEffect(() => {
    if (!snap.flashAt) return undefined;
    const on = setTimeout(() => setFlashOn(true), 0);
    const off = setTimeout(() => setFlashOn(false), FLASH_MS);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [snap.flashAt]);

  // S7-16: what a leave to the keypad prefills (+ scan_fallback_keypad).
  const partial: { code: string | null; num: string | null } | null =
    phase.kind === "found" || phase.kind === "hold"
      ? { code: phase.target.setCode, num: phase.target.cardNumber }
      : loopPartial
        ? {
            code: loopPartial.code,
            num: loopPartial.num ? loopPartial.num.replace(/^T/, "") : null,
          }
        : null;
  useEffect(() => {
    setCameraKeypadExit(() => keypadRoute(partial, setNameByCode));
  });
  useEffect(() => () => setCameraKeypadExit(null), []);
  const toKeypad = () => {
    setToolMode("keypad");
    go(cameraKeypadRoute(), true);
  };

  const g = size.w ? layoutGuide(size.w, size.h, vdim.w, vdim.h, live.h, live.v) : null;

  // Meter words.
  let mode: MeterMode;
  if (phase.kind === "found") mode = { kind: "paused", sub: "Choose below" };
  else if (phase.kind === "pick") mode = { kind: "paused", sub: "Pick the card" };
  else if (phase.kind === "hold") mode = { kind: "paused", sub: "Next card shortly" };
  else if (gate.band === "red") mode = { kind: "blurry" };
  else if (status?.kind === "small") mode = { kind: "small" };
  else mode = { kind: gate.band === "amber" ? "ok" : "sharp" };
  const partialText =
    phase.kind === "searching" && partial && partial.code
      ? partial.code + (partial.num ? " " + partial.num : " ···")
      : null;

  const paused = phase.kind !== "searching";
  const streamMsg =
    streamState.kind === "live"
      ? null
      : (STREAM_TEXT[streamState.kind] ?? {
          line: "The camera could not start",
          sub: streamState.kind === "error" ? streamState.message : "",
          start: true,
        });

  const details = (variantId: number | null) => {
    ctl.details();
    const c = cards.find((x) => x.variants.some((v) => v.variant_id === variantId));
    const v = c?.variants.find((x) => x.variant_id === variantId);
    if (c && v) onOpenCard(c, v);
  };

  let panel: ReactNode = null;
  if (phase.kind === "found" || phase.kind === "hold")
    panel = (
      <FoundPanel phase={phase} onAdd={ctl.add} onWrong={ctl.wrongCard} onDetails={details} />
    );
  else if (phase.kind === "pick")
    panel = <PickPanel phase={phase} onPick={ctl.pick} onNeither={ctl.wrongCard} />;

  return (
    <div
      className={"m-cam" + (paused ? " m-cam--paused" : "")}
      data-phase={phase.kind}
      data-stream={streamState.kind}
    >
      <div className={"m-camflash" + (flashOn ? " m-camflash--on" : "")} aria-hidden="true" />
      <div className="m-cam__stage">
        <div className="m-cam__view" ref={setStageEl}>
          <video
            ref={setVideoEl}
            className="m-cam__video"
            playsInline
            muted
            autoPlay
            onLoadedMetadata={(e) =>
              setVdim({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
            }
            onResize={(e) =>
              setVdim({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
            }
          />
          {g && streamState.kind === "live" ? <Guide g={g} phase={phase.kind} /> : null}
          {readerFail ? (
            <div className="m-cam__msg" role="alert">
              <p className="m-cam__msgline">The card reader could not start</p>
              <p className="m-cam__msgsub">{readerFail}</p>
              <SWUButton size="md" onClick={toKeypad}>
                Use the keypad
              </SWUButton>
            </div>
          ) : streamMsg ? (
            <div className="m-cam__msg" role="status">
              <p className="m-cam__msgline">{streamMsg.line}</p>
              {streamMsg.sub ? <p className="m-cam__msgsub">{streamMsg.sub}</p> : null}
              <div className="m-cam__msgacts">
                {streamMsg.start ? (
                  <SWUButton
                    size="md"
                    onClick={() => {
                      audioUnlock();
                      ctl.startStream();
                    }}
                  >
                    Start
                  </SWUButton>
                ) : null}
                <button type="button" className="m-textbtn" onClick={toKeypad}>
                  Use the keypad
                </button>
              </div>
            </div>
          ) : (
            <Meter
              mode={mode}
              pct={gate.pct}
              band={gate.band}
              partial={partialText}
              onKeypad={toKeypad}
            />
          )}
          {!paused && streamState.kind === "live" ? (
            <div className="m-cam__align">
              <SWUButton size="touch" onClick={() => setAlignOpen(true)}>
                Align guide
              </SWUButton>
            </div>
          ) : null}
        </div>
        {panel}
      </div>
      <div className="m-cam__bar">
        <span className="m-cam__spacer" />
        <VerifyButton n={batch.length} onOpen={onOpenVerify} />
      </div>
      {alignOpen ? (
        <AlignSheet live={live} onLive={setLive} onClose={() => setAlignOpen(false)} />
      ) : null}
    </div>
  );
}

/** S7-16: the keypad route for a partial read (`#/pad?set=&num=` only when
 * the set exists -- rev4 MCamera.jsx:143-152), sending scan_fallback_keypad. */
export function keypadRoute(
  partial: { code: string | null; num: string | null } | null,
  setNameByCode: Record<string, string>
): string {
  scanFallbackKeypad(!!(partial && (partial.code || partial.num)));
  if (partial && partial.code && PARTIAL_SETS.test(partial.code) && setNameByCode[partial.code]) {
    const num = partial.num && /^\d{1,4}$/.test(partial.num) ? "&num=" + String(+partial.num) : "";
    return "#/pad?set=" + partial.code + num;
  }
  return "#/pad";
}

/** S7-10: the screen bound to the scanner document's reader (scanBoot
 * registers it into the tool layer's camera slot). */
export function bindCameraScreen(scan: ScanDebug): ComponentType<CameraScreenProps> {
  function BoundCameraScreen(p: CameraScreenProps) {
    return <CameraScreen {...p} scan={scan} />;
  }
  return BoundCameraScreen;
}
