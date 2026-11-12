import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FEATURE_TOURS } from "../content/featureTours";
import type { FeatureTour, TourPage, TourTip } from "../content/featureTours";
import { useAuth } from "../context/AuthContext";
import { capture } from "../analytics/analytics";
import type { FeatureTourAction } from "../analytics/analytics";
import { SWUButton } from "../components/SWUButton";
import { isNewerBuildKnown, subscribeNewerBuild } from "../components/UpdateBanner";
import { useIsPhone } from "../mobile/useIsPhone";
import {
  activeTour,
  buildPageList,
  canSkip,
  countLabel,
  eligible,
  loadTourRecord,
  placeTip,
  primaryLabel,
  saveTourRecord,
  withSeen,
  withSkipped,
} from "./tourModel";
import type {
  Placement,
  Rect,
  TipAlign,
  TipPlace,
  TourDevice,
  TourOverride,
  TourRecord,
} from "./tourModel";
import "../components/NavPod.css";
import "./featureTour.css";

// The feature tour's runtime (App Spec §20, "Feature tour"; the rules are in
// tourModel.ts). One provider per app tree holds who may see tips and the
// per-browser record; pages say which tour page is showing (`useTourPage`);
// the topmost page runs its own short tour: once the page has settled
// (TOUR_SETTLE_MS with no element added or removed and nothing marked
// `data-tour-busy` open), its list is built from the tips whose target
// (`data-tour="<anchor>"`) is rendered, and the tips show one at a time. A
// tip waits for its target to be in view and never scrolls or navigates.
// Next / Done / using the target mark it seen; an empty-page click or Escape
// closes it without marking; Skip tour marks the whole release seen.

/** The page has settled when nothing was added or removed for this long. */
export const TOUR_SETTLE_MS = 1000;
/** A page that keeps changing is taken as settled after this long. */
export const TOUR_SETTLE_MAX_MS = 4000;
/** After the target was used, the next tip waits for open menus and sheets
 * (`data-tour-busy`) to close, then this long. */
export const TOUR_RESUME_MS = 300;

const BUSY = "[data-tour-busy]";

/** Where the tour stands, on <html data-tour-phase>: "off" (no page tour runs
 * in this tab: not eligible, skipped, no page), else "<page>:<phase>" with
 * phase settle | empty (settled, nothing to show yet) | show | wait | done.
 * Read by the e2e specs to tell "no tip" from "not yet". */
function writePhase(value: string | null): void {
  if (value == null) delete document.documentElement.dataset.tourPhase;
  else document.documentElement.dataset.tourPhase = value;
}

/** The page shown over the others wins: the card window over the Vault. */
const PAGE_RANK: Record<TourPage, number> = { collection: 1, stashes: 1, card: 2 };

declare global {
  interface Window {
    /** Test and e2e switch, honoured on the dev server and under vitest. */
    __hsvTour?: TourOverride;
  }
}

function readOverride(): TourOverride | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "test")) return null;
  const o = typeof window === "undefined" ? undefined : window.__hsvTour;
  return o && typeof o === "object" && typeof o.on === "boolean" ? o : null;
}

/** The tour this tab runs (tourModel.activeTour with this build's facts). */
export function resolveTour(tours: FeatureTour[] = FEATURE_TOURS): FeatureTour | null {
  return activeTour(tours, {
    appVersion: __APP_VERSION__,
    prodBuild: import.meta.env.VITE_FIREBASE_PROJECT_ID === "swu-prod",
    testMode: import.meta.env.MODE === "test",
    override: readOverride(),
  });
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The anchor's rendered element: the first one with a box that is not in a
 * hidden or inert subtree (a closed pod group, a parked screen). */
export function findTarget(anchor: string): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`);
  for (const el of els) {
    if (el.closest('[aria-hidden="true"], [inert], .pod--measure')) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    return el;
  }
  return null;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

function inView(r: Rect): boolean {
  return r.top >= 0 && r.bottom <= window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** The update banner on screen, a box the tip keeps off. */
function bannerRect(): Rect | null {
  const el = document.querySelector(".app-update-banner");
  if (!el) return null;
  const r = rectOf(el);
  return r.width > 0 && r.height > 0 ? r : null;
}

function report(action: FeatureTourAction, tip: TourTip, tour: FeatureTour, page: TourPage) {
  capture("feature_tour", { action, tip: tip.id, version: tour.version, page });
}

// ── Provider and page registration ────────────────────────────────────────

interface Registration {
  page: TourPage | null;
  shared: boolean;
}

interface TourContextValue {
  register: (id: string, reg: Registration) => void;
  unregister: (id: string) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

/** A page says it is showing (`page`), or that it shows nothing a tour
 * covers (null: a modal over it, a shared vault). `shared`: a shared vault is
 * the view, so no tips at all. No-op outside a FeatureTourProvider. */
export function useTourPage(page: TourPage | null, shared = false): void {
  const ctx = useContext(TourContext);
  const id = useId();
  useEffect(() => {
    ctx?.register(id, { page, shared });
  }, [ctx, id, page, shared]);
  useEffect(() => () => ctx?.unregister(id), [ctx, id]);
}

export function FeatureTourProvider({
  children,
  tours = FEATURE_TOURS,
  storage = localStore,
}: {
  children: ReactNode;
  /** Test seams. */
  tours?: FeatureTour[];
  storage?: () => Pick<Storage, "getItem" | "setItem"> | null;
}) {
  const { user } = useAuth();
  const phone = useIsPhone();
  const newerBuild = useSyncExternalStore(subscribeNewerBuild, isNewerBuildKnown);
  const [tour] = useState(() => resolveTour(tours));
  // Read once per load: null when storage is unavailable (then no tips).
  const [rec, setRec] = useState<TourRecord | null>(() => (tour ? loadTourRecord(storage) : null));
  const recRef = useRef(rec);
  const storageRef = useRef(storage);
  const [regs, setRegs] = useState<Record<string, Registration>>({});

  const ctx = useMemo<TourContextValue>(
    () => ({
      register: (id, reg) =>
        setRegs((r) =>
          r[id]?.page === reg.page && r[id]?.shared === reg.shared ? r : { ...r, [id]: reg }
        ),
      unregister: (id) =>
        setRegs((r) => {
          if (!(id in r)) return r;
          const next = { ...r };
          delete next[id];
          return next;
        }),
    }),
    []
  );

  const update = useCallback((fn: (r: TourRecord) => TourRecord) => {
    const cur = recRef.current;
    if (!cur) return;
    const next = fn(cur);
    recRef.current = next;
    saveTourRecord(storageRef.current, next);
    setRec(next);
  }, []);

  const values = Object.values(regs);
  const sharedView = values.some((r) => r.shared);
  let top: TourPage | null = null;
  for (const r of values)
    if (r.page && (top == null || PAGE_RANK[r.page] > PAGE_RANK[top])) top = r.page;

  // The banner gate is the runner's (a visible tip may finish); the rest
  // decides whether a page tour runs at all.
  const ok = eligible({
    tour,
    signedIn: user != null,
    creationTime: user?.metadata?.creationTime,
    sharedView,
    newerBuild: false,
    storageOk: rec != null,
  });
  const skipped = tour != null && rec != null && rec.skipped[tour.version] === true;
  const running = ok && !skipped && top != null;
  useEffect(() => {
    if (!running) writePhase("off");
  }, [running]);
  useEffect(() => () => writePhase(null), []);

  return (
    <TourContext.Provider value={ctx}>
      {children}
      {running && top && tour && rec ? (
        <TourRunner
          // A new visit to a page (or the page changing) starts over.
          key={top}
          tour={tour}
          page={top}
          device={phone ? "phone" : "desktop"}
          rec={rec}
          blocked={newerBuild}
          onSeen={(id) => update((r) => withSeen(r, tour.version, id))}
          onSkip={() => update((r) => withSkipped(r, tour.version))}
        />
      ) : null}
    </TourContext.Provider>
  );
}

// ── One page's tour ───────────────────────────────────────────────────────

type Phase = "settle" | "show" | "wait" | "done";

function TourRunner({
  tour,
  page,
  device,
  rec,
  blocked,
  onSeen,
  onSkip,
}: {
  tour: FeatureTour;
  page: TourPage;
  device: TourDevice;
  rec: TourRecord;
  blocked: boolean;
  onSeen: (id: string) => void;
  onSkip: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("settle");
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    writePhase(`${page}:${phase === "settle" && empty ? "empty" : phase}`);
  }, [page, phase, empty]);
  const [list, setList] = useState<TourTip[]>([]);
  const [index, setIndex] = useState(0);
  const recRef = useRef(rec);
  const blockedRef = useRef(blocked);
  useEffect(() => {
    recRef.current = rec;
    blockedRef.current = blocked;
  });

  // Settle, then build the page's list. A page with nothing to show keeps
  // watching: a target that renders later in this visit still counts.
  useEffect(() => {
    if (phase !== "settle") return undefined;
    const t0 = Date.now();
    let timer: number | undefined;
    const fire = () => {
      if (blockedRef.current || document.querySelector(BUSY)) return arm(true);
      const built = buildPageList(tour, page, device, recRef.current, (a) => findTarget(a) != null);
      if (built.length === 0) {
        setEmpty(true);
        return;
      }
      setList(built);
      setIndex(0);
      setPhase("show");
    };
    function arm(force = false) {
      // Past the cap, a change no longer restarts a running wait.
      if (!force && timer !== undefined && Date.now() - t0 > TOUR_SETTLE_MAX_MS) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, TOUR_SETTLE_MS);
    }
    const mo = new MutationObserver((records) => {
      if (records.some((r) => !(r.target as Element).closest?.(".tour-tip, .tour-glow"))) arm();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    arm(true);
    return () => {
      window.clearTimeout(timer);
      mo.disconnect();
    };
  }, [phase, tour, page, device]);

  // The next tip, or the end. No new tip starts once a newer build is known.
  const advance = useCallback(
    (from: number) => {
      if (blockedRef.current || from + 1 >= list.length) {
        setPhase("done");
        return;
      }
      setIndex(from + 1);
      setPhase("show");
    },
    [list.length]
  );

  // After the target was used: wait for its menu or sheet to close.
  useEffect(() => {
    if (phase !== "wait") return undefined;
    let timer: number | undefined;
    const poll = window.setInterval(() => {
      if (document.querySelector(BUSY)) {
        window.clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        timer = window.setTimeout(() => advance(index), TOUR_RESUME_MS);
      }
    }, 100);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timer);
    };
  }, [phase, index, advance]);

  if (phase !== "show") return null;
  const tip = list[index];
  if (!tip) return null;
  const last = primaryLabel(index, list.length) === "Done";
  return (
    <TipView
      key={tip.id}
      tour={tour}
      tip={tip}
      phone={device === "phone"}
      count={countLabel(index, list.length)}
      primary={primaryLabel(index, list.length)}
      skip={canSkip(tour, device, rec, tip)}
      onMissing={() => advance(index)}
      onShown={() => report("shown", tip, tour, page)}
      onPrimary={() => {
        onSeen(tip.id);
        report(last ? "done" : "next", tip, tour, page);
        if (last) setPhase("done");
        else advance(index);
      }}
      onSkip={() => {
        report("skip", tip, tour, page);
        onSkip();
        setPhase("done");
      }}
      onUsed={() => {
        onSeen(tip.id);
        report("target_used", tip, tour, page);
        if (index + 1 >= list.length) setPhase("done");
        else setPhase("wait");
      }}
      onDismiss={() => {
        report("dismissed", tip, tour, page);
        setPhase("done");
      }}
    />
  );
}

// ── The tip ───────────────────────────────────────────────────────────────

const PLACES: TipPlace[] = ["below", "above", "right"];

function samePlace(a: Placement, b: Placement): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.notch === b.notch &&
    a.notchAt === b.notchAt
  );
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}
const ALIGNS: TipAlign[] = ["start", "center", "end"];

function TipView({
  tour,
  tip,
  phone,
  count,
  primary,
  skip,
  onMissing,
  onShown,
  onPrimary,
  onSkip,
  onUsed,
  onDismiss,
}: {
  tour: FeatureTour;
  tip: TourTip;
  phone: boolean;
  count: string | null;
  primary: "Next" | "Done";
  skip: boolean;
  onMissing: () => void;
  onShown: () => void;
  onPrimary: () => void;
  onSkip: () => void;
  onUsed: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ place: Placement; glow: Rect; h: number } | null>(null);
  const [still] = useState(prefersReducedMotion);
  const measureRef = useRef<(() => void) | null>(null);
  const handlers = useRef({ onMissing, onShown, onUsed, onDismiss });
  useEffect(() => {
    handlers.current = { onMissing, onShown, onUsed, onDismiss };
  });

  // Find the target, wait for it to be in view, keep the tip glued to it.
  useLayoutEffect(() => {
    let frame = 0;
    let shown = false;
    let lost = false;
    const measure = () => {
      const el = findTarget(tip.anchor);
      if (!el) {
        // Gone (the page changed under the tip): this visit moves on.
        if (!lost) {
          lost = true;
          handlers.current.onMissing();
        }
        return;
      }
      setTarget((cur) => (cur === el ? cur : el));
      const r = rectOf(el);
      if (!shown) {
        if (!inView(r)) return;
        shown = true;
        setVisible(true);
        handlers.current.onShown();
      }
      const place = el.dataset.tourPlace as TipPlace | undefined;
      const align = el.dataset.tourAlign as TipAlign | undefined;
      const gap = el.dataset.tourGap != null ? Number(el.dataset.tourGap) : undefined;
      // The tip's own height places it; until it has rendered once it is
      // laid out hidden.
      const h = tipRef.current?.offsetHeight ?? 0;
      const next = placeTip({
        target: r,
        height: h,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        phone,
        place: place && PLACES.includes(place) ? place : undefined,
        align: align && ALIGNS.includes(align) ? align : undefined,
        gap: gap != null && Number.isFinite(gap) ? gap : undefined,
        avoid: bannerRect(),
      });
      setPos((cur) =>
        cur && cur.h === h && samePlace(cur.place, next) && sameRect(cur.glow, r)
          ? cur
          : { place: next, glow: r, h }
      );
    };
    const loop = () => {
      measure();
      frame = requestAnimationFrame(loop);
    };
    measureRef.current = measure;
    measure();
    frame = requestAnimationFrame(loop);
    return () => {
      measureRef.current = null;
      cancelAnimationFrame(frame);
    };
  }, [tip.anchor, phone]);

  // The tip's first render has a height: place it before it paints.
  useLayoutEffect(() => {
    if (visible) measureRef.current?.();
  }, [visible]);

  // Using the target, an empty-page click and Escape.
  useEffect(() => {
    if (!visible || !target) return undefined;
    const inTip = (n: EventTarget | null) => n instanceof Node && !!tipRef.current?.contains(n);
    const onTarget = (n: EventTarget | null) => n instanceof Node && target.contains(n);
    const menu = target.matches("[aria-haspopup]");
    const down = (e: PointerEvent) => {
      if (inTip(e.target) || onTarget(e.target)) return;
      handlers.current.onDismiss();
    };
    const click = (e: MouseEvent) => {
      if (onTarget(e.target)) handlers.current.onUsed();
    };
    // A control that opens its menu on hover or focus is used then.
    const over = (e: PointerEvent) => {
      if (menu && e.pointerType === "mouse" && onTarget(e.target)) handlers.current.onUsed();
    };
    const focus = (e: FocusEvent) => {
      if (menu && onTarget(e.target)) handlers.current.onUsed();
    };
    // Escape closes the tip only: the dialog under it keeps its own Escape.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      handlers.current.onDismiss();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    document.addEventListener("pointerover", over, true);
    document.addEventListener("focusin", focus, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("focusin", focus, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [visible, target]);

  if (!visible) return null;
  const place = pos && pos.h > 0 ? pos.place : null;
  const notchStyle =
    place?.notch === "left" ? { top: place.notchAt } : place ? { left: place.notchAt } : undefined;
  return createPortal(
    <>
      {pos && place ? (
        <span
          className={"tour-glow" + (still ? " tour-glow--still" : "")}
          aria-hidden="true"
          style={{
            left: pos.glow.left,
            top: pos.glow.top,
            width: pos.glow.width,
            height: pos.glow.height,
          }}
        />
      ) : null}
      <div
        ref={tipRef}
        className={
          "tour-tip" +
          (phone ? " tour-tip--phone" : "") +
          (place ? ` tour-tip--${place.notch}` : "") +
          (still ? " tour-tip--still" : "")
        }
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-tip={tip.id}
        style={
          place
            ? { left: place.left, top: place.top, width: place.width }
            : { left: 0, top: 0, visibility: "hidden" }
        }
      >
        <div className="pod-menu__panel tour-tip__panel">
          <span className="tour-tip__label">
            <span className="tour-tip__new">New in v{tour.version}</span>
            {count ? <span className="tour-tip__count">{count}</span> : null}
          </span>
          <span className="tour-tip__title" id={titleId}>
            {phone ? (tip.titlePhone ?? tip.title) : tip.title}
          </span>
          <p className="tour-tip__body" id={bodyId}>
            {phone ? (tip.bodyPhone ?? tip.body) : tip.body}
          </p>
          <span className="tour-tip__foot">
            {skip ? (
              <button type="button" className="tour-tip__skip" onClick={onSkip}>
                Skip tour
              </button>
            ) : null}
            <span className="tour-tip__spacer" />
            <SWUButton size={phone ? "touch" : "sm"} onClick={onPrimary}>
              {primary}
            </SWUButton>
          </span>
        </div>
        {place ? <span className="tour-tip__notch" aria-hidden="true" style={notchStyle} /> : null}
      </div>
    </>,
    document.body
  );
}
