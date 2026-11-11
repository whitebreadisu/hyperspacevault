import { useCallback, useEffect, useRef, useState } from "react";
import {
  BAKED_BUILD_ID,
  INTERVAL_MS,
  chunkFailureAction,
  fetchBuildInfo,
  isChunkLoadError,
  isDifferentBuild,
  shouldCheck,
} from "../utils/buildCheck";
import type { CheckReason, GuardStorage } from "../utils/buildCheck";
import { capture } from "../analytics/analytics";
import type { UpdateBannerAction, UpdateBannerSource } from "../analytics/analytics";
import { SWUButton } from "./SWUButton";
import "./VerifyEmailBanner.css";
import "./UpdateBanner.css";

/** Banner keys (a published build id, or "chunk") already reported as shown
 * on this page load; module scope, so it outlives a remount. */
const shownKeys = new Set<string>();

/** Test seam: forget what this page load has reported. */
export function resetShownForTests(): void {
  shownKeys.clear();
}

/** sessionStorage, or null where reading it throws (blocked site data). */
function sessionGuard(): GuardStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export interface BuildUpdateOptions {
  /** The id baked into this bundle (tests pass their own). */
  bakedBuild?: string;
  fetcher?: typeof fetch;
  reload?: () => void;
  storage?: () => GuardStorage | null;
  now?: () => number;
}

/** App Spec §20. Watches for a newer deploy and for a code chunk
 * that no longer exists; returns whether the banner shows and its actions.
 * Checks /build.json when the tab becomes visible or regains focus (at most
 * once per FOCUS_THROTTLE_MS) and every INTERVAL_MS while visible. Nothing
 * reloads on its own except the one guarded chunk-failure reload. */
export function useBuildUpdate({
  bakedBuild = BAKED_BUILD_ID,
  fetcher,
  reload = () => window.location.reload(),
  storage = sessionGuard,
  now = Date.now,
}: BuildUpdateOptions = {}) {
  // The published build that differs from this tab's, once seen.
  const [published, setPublished] = useState<string | null>(null);
  // The chunk-failure guard had already fired: show the banner instead.
  const [chunkFailed, setChunkFailed] = useState(false);
  // The build the user dismissed the banner for.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const lastCheck = useRef<number | null>(null);
  // The latest options, read by the listeners installed once below.
  const opts = useRef({ bakedBuild, fetcher, reload, storage, now });
  useEffect(() => {
    opts.current = { bakedBuild, fetcher, reload, storage, now };
  });

  useEffect(() => {
    let alive = true;
    // One request at a time: a focus or interval check while one is running
    // is skipped, and only the newest request's answer is applied, so an
    // older response can never replace a newer build (or undo a dismissal).
    let inFlight = false;
    let seq = 0;
    const check = async (reason: CheckReason) => {
      if (document.visibilityState !== "visible" || inFlight) return;
      const o = opts.current;
      const t = o.now();
      if (!shouldCheck(reason, t, lastCheck.current)) return;
      lastCheck.current = t;
      inFlight = true;
      const mine = ++seq;
      try {
        const info = await fetchBuildInfo(o.fetcher ?? fetch);
        if (alive && mine === seq && isDifferentBuild(o.bakedBuild, info)) {
          setPublished(info!.build);
        }
      } finally {
        inFlight = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check("focus");
    };
    const onFocus = () => void check("focus");
    const timer = window.setInterval(() => void check("interval"), INTERVAL_MS);

    // (b) a chunk this build names is gone (a deploy replaced it).
    const recover = (prevent: () => void) => {
      const o = opts.current;
      if (chunkFailureAction(o.storage(), o.bakedBuild) === "reload") {
        prevent();
        o.reload();
      } else {
        setChunkFailed(true);
      }
    };
    const onPreloadError = (e: Event) => recover(() => e.preventDefault());
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) recover(() => e.preventDefault());
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("vite:preloadError", onPreloadError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Dismissal is per build: a later, different build shows the banner again.
  const key = published ?? (chunkFailed ? "chunk" : null);
  const show = key != null && key !== dismissed;
  const refresh = useCallback(() => opts.current.reload(), []);
  const dismiss = useCallback(() => setDismissed(key), [key]);
  // Why it shows: a check found a newer build, or only the chunk guard did.
  const source: UpdateBannerSource = published != null ? "check" : "chunk";
  return { show, refresh, dismiss, key, source };
}

/** app_update_banner (App Spec §22): enums only. The phone adds
 * `layout: "phone"` explicitly, as every phone event does. */
function captureBanner(action: UpdateBannerAction, source: UpdateBannerSource, phone: boolean) {
  capture("app_update_banner", phone ? { action, source, layout: "phone" } : { action, source });
}

/** The slim, non-blocking "new version ready" banner (App Spec §20): under
 * the header on desktop, above the bottom bar on the phone. The verify-email
 * banner's strip layout on a neutral surface; its two actions are SWUButtons
 * (Refresh the lit primary, Dismiss the off state), 44 px on the phone. */
export function UpdateBanner({ phone = false, ...opts }: BuildUpdateOptions & { phone?: boolean }) {
  const { show, refresh, dismiss, key, source } = useBuildUpdate(opts);
  // "shown" once per build per page load: the first render that shows the
  // banner for a key, never again for it (a re-render, a remount on a layout
  // switch, or a later check that finds the same build).
  useEffect(() => {
    if (!show || key == null || shownKeys.has(key)) return;
    shownKeys.add(key);
    captureBanner("shown", source, phone);
  }, [show, key, source, phone]);
  if (!show) return null;
  const size = phone ? "touch" : "sm";
  const onRefresh = () => {
    captureBanner("refresh", source, phone);
    refresh();
  };
  const onDismiss = () => {
    captureBanner("dismiss", source, phone);
    dismiss();
  };
  return (
    <div className="verify-email-banner app-update-banner" role="status">
      <span className="verify-email-banner__text">A new version of HyperspaceVault is ready.</span>
      <span className="verify-email-banner__actions">
        <SWUButton size={size} active={false} onClick={onDismiss}>
          Dismiss
        </SWUButton>
        <SWUButton size={size} onClick={onRefresh}>
          Refresh
        </SWUButton>
      </span>
    </div>
  );
}
