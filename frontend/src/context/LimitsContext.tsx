import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getLimits, putLimits } from "../api/settingsLimits";
import type { CapMode, LimitCell, LimitOverrideInput } from "../api/settingsLimits";
import { getSharedLimits } from "../api/sharedView";
import { toMatrix } from "../utils/limits";
import type { LimitsMatrix } from "../utils/limits";

/** BL-35: what an unauthenticated / not-yet-fetched / failed-fetch tenant
 * resolves to -- mirrors the backend's own no-tenant_settings-row default
 * (repositories/tenant_settings.py's DEFAULT_CAP_MODE), so pre-auth and
 * pre-fetch behavior is byte-identical to hard mode. */
const DEFAULT_CAP_MODE: CapMode = "hard";

interface LimitsContextValue {
  /** The tenant's effective keep-limit matrix as a lookup map, or null when
   * anonymous / not yet fetched / fetch failed -- every consumer treats null
   * as "use the code defaults" (utils/limits.ts), so nothing breaks
   * pre-auth. */
  limits: LimitsMatrix | null;
  /** The same matrix as the raw cell list (GET response order) -- what the
   * settings grid renders from, since it also needs is_default per cell. */
  cells: LimitCell[] | null;
  /** BL-35: the tenant's keep-limit enforcement mode. "hard" (default)
   * blocks an increment at/over a variant's effective limit; "soft" commits
   * it and flags the response over_limit=True instead. Defaults to "hard"
   * when anonymous / not yet fetched / fetch failed. */
  capMode: CapMode;
  /** Re-fetches the matrix (e.g. after an auth change). */
  refresh: () => Promise<void>;
  /** PUTs the complete override set and re-renders the whole app's limit
   * state from the response's new effective matrix. capMode is OPTIONAL --
   * omit it to leave the tenant's current cap_mode untouched, mirroring the
   * backend's PUT semantics (services/settings.py's replace_limits). Throws
   * LimitsApiError on failure (state is left untouched -- the caller
   * surfaces the error). */
  save: (overrides: LimitOverrideInput[], capMode?: CapMode) => Promise<void>;
}

/** Default value doubles as the anonymous/standalone behavior: limits stay
 * null (code defaults), capMode stays "hard", and mutations are no-ops.
 * Components can therefore consume useLimits() without a provider (unit
 * tests, pre-auth renders) and get exactly the pre-BL-25 constants -- unlike
 * useAuth, which throws, because auth has no meaningful "no provider"
 * fallback while limits do (the code defaults). */
const DEFAULT_VALUE: LimitsContextValue = {
  limits: null,
  cells: null,
  capMode: DEFAULT_CAP_MODE,
  refresh: async () => {},
  save: async () => {},
};

const LimitsContext = createContext<LimitsContextValue>(DEFAULT_VALUE);

interface Props {
  /** Whether a user is signed in -- passed by App from useAuth() rather than
   * read here, keeping this provider mockable/composable the same way
   * CardsPage receives isAuthenticated as a prop. Ignored when `shareToken`
   * is set (see that prop's own doc comment). */
  isAuthenticated: boolean;
  /** BL-205: when set, this provider serves the READ-ONLY shared-vault
   * limits (GET /api/shared/{token}/limits, the share's OWNER-tenant
   * matrix) instead of the caller's own tenant limits -- independent of
   * `isAuthenticated`. A signed-in viewer browsing someone else's share
   * still sees the OWNER's limits, not their own; an anonymous viewer sees
   * the same real matrix a signed-in owner would (§19.1: "full fidelity").
   * `save()` is a no-op while set (mutation is owner-only; SharedVaultPage
   * never mounts a Settings pane that could call it, this is a defensive
   * second gate). SharedVaultPage nests a SEPARATE LimitsProvider around
   * just its own CardsPage subtree with this set -- React context lookup is
   * nearest-provider-wins, so it shadows the app-wide provider (App.tsx's
   * LimitsGate) for that subtree only, without either provider needing to
   * know about the other. */
  shareToken?: string;
  children: ReactNode;
}

/** BL-25: fetches the effective keep-limit matrix once authenticated
 * (mirroring CardsPage's quantities fetch: auth-gated, cleared on sign-out)
 * and provides it to the enforcement pre-checks (Add Cards resolver,
 * CardPopup's stepper) and the settings grid. A fetch failure
 * degrades to the code defaults rather than blocking the app -- the backend
 * still enforces the real limits on every increment.
 *
 * BL-35: the same GET/PUT round trip also carries cap_mode (hard/soft
 * enforcement), so this provider exposes it alongside the matrix rather
 * than needing a second fetch. */
export function LimitsProvider({ isAuthenticated, shareToken, children }: Props) {
  const [cells, setCells] = useState<LimitCell[] | null>(null);
  const [capMode, setCapMode] = useState<CapMode>(DEFAULT_CAP_MODE);

  const refresh = useCallback(async () => {
    // BL-205: shareToken wins outright, checked before isAuthenticated --
    // see this prop's own doc comment for why the two are independent.
    if (shareToken) {
      try {
        const body = await getSharedLimits(shareToken);
        setCells(body.limits);
        setCapMode(body.cap_mode);
      } catch (err) {
        console.error("Failed to fetch shared vault limits:", err);
        setCells(null);
        setCapMode(DEFAULT_CAP_MODE);
      }
      return;
    }
    if (!isAuthenticated) {
      setCells(null);
      setCapMode(DEFAULT_CAP_MODE);
      return;
    }
    try {
      const body = await getLimits();
      setCells(body.limits);
      setCapMode(body.cap_mode);
    } catch (err) {
      console.error("Failed to fetch inventory limits:", err);
      setCells(null);
      setCapMode(DEFAULT_CAP_MODE);
    }
  }, [isAuthenticated, shareToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // BL-205: a no-op while shareToken is set -- see this provider's
  // `shareToken` doc comment for why (defensive second gate; nothing in
  // viewer mode ever calls save() in practice since no Settings pane is
  // mounted there).
  const save = useCallback(
    async (overrides: LimitOverrideInput[], nextCapMode?: CapMode) => {
      if (shareToken) return;
      const body = await putLimits(overrides, nextCapMode);
      setCells(body.limits);
      setCapMode(body.cap_mode);
    },
    [shareToken]
  );

  const value = useMemo<LimitsContextValue>(
    () => ({
      limits: cells ? toMatrix(cells) : null,
      cells,
      capMode,
      refresh,
      save,
    }),
    [cells, capMode, refresh, save]
  );

  return <LimitsContext.Provider value={value}>{children}</LimitsContext.Provider>;
}

export function useLimits(): LimitsContextValue {
  return useContext(LimitsContext);
}
