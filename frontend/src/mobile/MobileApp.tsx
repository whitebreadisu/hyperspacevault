import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { LimitsProvider } from "../context/LimitsContext";
import { hasPasswordProvider } from "../utils/googleAuth";
import { AccountSlot } from "./AccountSlot";
import { AuthLayer } from "./AuthLayer";
import { CardDetail } from "./card/CardDetail";
import { FinishSheetHost } from "./card/FinishSheet";
import { AccountLayer } from "./account/AccountLayer";
import { SettingsScreen } from "./account/SettingsScreen";
import { FeedbackScreen } from "./FeedbackScreen";
import { AboutScreen } from "./more/AboutScreen";
import { ImportExportScreen } from "./more/ImportExportScreen";
import { MoreScreen } from "./more/MoreScreen";
import { UpdatesScreen } from "./more/UpdatesScreen";
import { SheetHost } from "./Sheet";
import { MobileNav } from "./MobileNav";
import type { NavShare } from "./MobileNav";
import { SharedStatus } from "./shared/SharedStatus";
import { useShare } from "./shared/useShare";
import type { ScreenViewedScreen } from "../analytics/analytics";
import { phoneScreenViewed } from "./phoneAnalytics";
import { RotateScreen } from "./RotateScreen";
import { back, backOr, go, parseHash, setBgRoute, useRoute } from "./router";
import type { Route } from "./router";
import { rehydrateBatch } from "./tool/batch";
import {
  bounceSignIn,
  finishSignInBounce,
  getCameraScreen,
  hopToCamera,
  isScanDocument,
  pendingSignInReturn,
} from "./tool/cameraHop";
import { ToolLayer } from "./tool/ToolLayer";
import { rehydrateTool } from "./tool/toolStore";
import { TitleChooser } from "./TitleChooser";
import { useReleaseCue } from "./useReleaseCue";
import { VaultDataProvider, VaultDataValue, useVaultDataSource } from "../vault/useVaultData";
import { StashProvider } from "../stashes/StashContext";
import { CardParamBoot } from "./CardParamBoot";
import { bootSignupParam, clearSignupParam } from "../utils/cardParam";
import { Vault } from "./vault/Vault";
import "./mobile.css";
import "./shell.css";

/** The phone app root (App Spec §25): the route -> screen map and the
 * layers over it. Owns the auth layer's open state with desktop's auto-close
 * rule (App.tsx's signupInFlight / googleLinkedInFlight effect) and the title
 * chooser + release-notes cue (App Spec §25.4). */

interface Screen {
  key: string;
  el: ReactNode;
}

/** The routed (non-Vault) screen a route shows, by key -- null for the
 * Vault (and the card / tool layers, which sit over a screen).
 * `#/more/<unknown>` falls back to the More list. */
function screenKey(route: Route): string | null {
  const [a, b] = route.segs;
  if (a === "about") return "about";
  if (a !== "more") return null;
  // Settings; Delete Account is a layer over it, so its
  // route keeps the Settings screen mounted underneath.
  if (b === "settings" || b === "delete") return "more/settings";
  // Change Password is a layer over whatever screen it was opened from
  // (see `layerBase` below).
  if (b === "password") return "more/password";
  // Sharing is a layer too (desktop's ShareManageModal, unchanged).
  if (b === "sharing") return "more/sharing";
  if (b === "about" || b === "updates" || b === "feedback" || b === "importexport")
    return "more/" + b;
  return "more";
}

/** screen_viewed values by screen key. Updates reports
 * desktop's `new_arrivals` (App Spec §22 names it for the same screen). */
const SCREEN_VIEWED: Record<string, ScreenViewedScreen> = {
  vault: "vault",
  more: "more",
  "more/settings": "settings",
  password: "password",
  delete: "delete",
  sharing: "sharing",
  about: "about",
  "more/about": "about",
  "more/updates": "new_arrivals",
  "more/feedback": "feedback",
  // The shared vault shown (desktop App.tsx's `shared` pane).
  shared: "shared_view",
};

/** Routes that act on the viewer's own vault or account; inside a share
 * they land on the (trimmed) More. Delete Account's route maps to the
 * Settings key, so it is covered too. */
const BLOCKED_IN_SHARE = new Set([
  "more/settings",
  "more/password",
  "more/sharing",
  "more/importexport",
]);

/** The shared vault's own data instance + the share
 * owner's limits (desktop SharedVaultPage's nested LimitsProvider with
 * `shareToken` around its read-only CardsPage). Mounted only once the
 * share has resolved (an invalid / rate-limited token or an unswitched
 * restored session downloads nothing, as desktop mounts CardsPage
 * only when ready); read by the shared pane, its card layer and its
 * Owned-by-finish host. */
function ShareScope({ token, children }: { token: string; children: ReactNode }) {
  const value = useVaultDataSource(false, token);
  return (
    <LimitsProvider isAuthenticated={false} shareToken={token}>
      {/* nothing under a share reads or fetches stash data. */}
      <StashProvider enabled={false}>
        <VaultDataValue value={value}>{children}</VaultDataValue>
      </StashProvider>
    </LimitsProvider>
  );
}

/** The app frame follows the visual viewport, so with the keyboard up the list's bottom
 * edge sits on the keyboard's top edge. */
function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const root = document.documentElement;
    const on = () => {
      root.style.setProperty("--app-h", vv.height + "px");
      root.style.setProperty("--app-top", vv.offsetTop + "px");
    };
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    on();
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
    };
  }, []);
}

/** A page restored from the back/forward cache is frozen memory --
 * the other document (main / isolated /scan/) may have changed the batch in
 * between, so re-read the sessionStorage mirror. */
function useRehydrateOnPageShow(): void {
  useEffect(() => {
    const on = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      rehydrateBatch();
      rehydrateTool();
    };
    window.addEventListener("pageshow", on);
    return () => window.removeEventListener("pageshow", on);
  }, []);
}

export function MobileApp() {
  const route = useRoute();
  useRehydrateOnPageShow();
  const { user, logout, emailVerified, loading } = useAuth();

  // The auth layer, closed by desktop's single-source-of-truth rule -- a
  // successful sign-in closes it, except mid-signup / mid-Google-link where
  // AuthModal owns its own follow-up screen (as in App.tsx).
  // The isolated /scan/ document cannot
  // run the Google popup, so its sign-in bounces here (cameraHop.bounceSignIn);
  // this document opens the auth layer for a pending bounce and returns once
  // signed in (or walks back if the layer is closed without signing in).
  const [bounce] = useState(() => !isScanDocument() && pendingSignInReturn() !== null);
  // `signup=1` at boot (a public card page's "Create free account"): the
  // auth layer opens in create-account mode, beside any `?card=` card, and
  // the parameter leaves the address bar (desktop: App.tsx).
  const [bootSignup] = useState(() => !bounce && !isScanDocument() && bootSignupParam());
  const [authOpen, setAuthOpen] = useState(bounce || bootSignup);
  const [authMode, setAuthMode] = useState<"login" | "signup">(bootSignup ? "signup" : "login");
  useEffect(() => {
    if (bootSignup) clearSignupParam();
  }, [bootSignup]);
  const [signupInFlight, setSignupInFlight] = useState(false);
  const [googleLinkedInFlight, setGoogleLinkedInFlight] = useState(false);
  useEffect(() => {
    if (user && !signupInFlight && !googleLinkedInFlight) {
      setAuthOpen(false);
      setAuthMode("login");
      if (bounce) finishSignInBounce(true);
    }
  }, [user, signupInFlight, googleLinkedInFlight, bounce]);
  const openSignIn = useCallback(() => {
    if (isScanDocument()) bounceSignIn();
    else setAuthOpen(true);
  }, []);
  const closeAuth = useCallback(() => {
    setAuthOpen(false);
    setAuthMode("login");
    setSignupInFlight(false);
    setGoogleLinkedInFlight(false);
    if (bounce && !user) finishSignInBounce(false);
  }, [bounce, user]);

  // The title chooser and the release-notes cue.
  const cue = useReleaseCue();
  const [chooserOpen, setChooserOpen] = useState(false);
  const closeChooser = useCallback(() => setChooserOpen(false), []);
  const { noteTitle, noteMore } = cue;
  const openChooser = useCallback(() => {
    setChooserOpen(true);
    noteTitle();
  }, [noteTitle]);

  // The tab's share session; `inShare` = the shared vault is
  // the vault shown (desktop's `shared` pane).
  const share = useShare();
  const inShare = share.shown;
  const { setShown: setShareShown } = share;
  // A deep-link param left in the hash (a closed sheet's `?sheet=`) belongs to
  // the vault that consumed it: switching vaults first clears it (synchronously,
  // in the same batch) so the incoming pane never re-applies it.
  const pickVault = (shared: boolean) => {
    if (window.location.hash.includes("?")) go("#/vault", true);
    setShareShown(shared);
  };
  const navShare: NavShare | null = share.token
    ? { name: share.name, shown: inShare, onPick: pickVault }
    : null;

  const account = (
    <AccountSlot
      email={user?.email ?? null}
      hasPasswordProvider={hasPasswordProvider(user)}
      onSignIn={openSignIn}
      onLogout={() => void logout()}
      shared={inShare}
      onLeaveShare={() => setShareShown(false)}
    />
  );

  // Search mode collapses the bottom bar as well as the headers.
  const [searchMode, setSearchMode] = useState(false);
  useVisualViewport();

  // #/card/<id> is a layer over the Vault, which stays mounted
  // under it with the params it last had (filters, scope, scroll and list
  // survive the visit, as under desktop's popup).
  // A non-numeric id is still the card layer (id -1: not in the
  // catalogue), not a fall-through to the Vault under a card hash.
  const cardId =
    route.segs[0] === "card" ? (/^\d+$/.test(route.segs[1] ?? "") ? +route.segs[1] : -1) : null;
  // #/pad (and #/camera) is the tool LAYER over the screen it was opened
  // from (baseRoute: the last route that is neither the tool nor a card),
  // which stays mounted beneath it with the bar covered. A card opened from
  // the tool layers over the tool, which stays mounted (inert) so its state
  // is untouched when the card closes.
  const seg0 = route.segs[0];
  const isTool = seg0 === "pad" || seg0 === "camera";
  const [baseRoute, setBaseRoute] = useState<Route>(() =>
    isTool || cardId != null ? parseHash("#/vault") : route
  );
  if (!isTool && cardId == null && route !== baseRoute) setBaseRoute(route);
  const [prevSeg, setPrevSeg] = useState(seg0);
  const [toolUnderCard, setToolUnderCard] = useState(false);
  if (prevSeg !== seg0) {
    setPrevSeg(seg0);
    setToolUnderCard(seg0 === "card" && (prevSeg === "pad" || prevSeg === "camera"));
  }
  const toolShown = isTool || (cardId != null && toolUnderCard);
  // Which tool the layer shows (kept while a card is over it).
  const [toolSeg, setToolSeg] = useState(seg0 === "camera" ? "camera" : "pad");
  if (isTool && seg0 !== toolSeg) setToolSeg(seg0);
  const cameraShown = toolShown && toolSeg === "camera";
  // The tool layer's X / Back returns to the screen beneath it; the
  // camera hop rewrites the main document's entry to it before leaving.
  useEffect(() => {
    setBgRoute(baseRoute.hash);
  }, [baseRoute]);
  // `#/camera` on the main document (a deep link, a stale history
  // entry) is the hop to the isolated document -- it has no camera here.
  const hopNeeded = seg0 === "camera" && !inShare && !getCameraScreen();
  useEffect(() => {
    if (hopNeeded) hopToCamera(true);
  }, [hopNeeded]);
  const screenRoute = toolShown ? baseRoute : route;

  const [vaultParams, setVaultParams] = useState(() =>
    cardId == null && !isTool ? route.params : {}
  );
  if (cardId == null && !isTool && !screenKey(route) && route.params !== vaultParams)
    setVaultParams(route.params);
  // Each vault pane keeps the params it last had while parked
  // (a deep-link param applies once, to the vault that was shown).
  const [ownParams, setOwnParams] = useState<Record<string, string>>(() =>
    inShare ? {} : vaultParams
  );
  const [sharedParams, setSharedParams] = useState<Record<string, string>>({});
  if (!inShare && ownParams !== vaultParams) setOwnParams(vaultParams);
  if (inShare && sharedParams !== vaultParams) setSharedParams(vaultParams);

  const routeKey = (cardId == null || toolShown ? screenKey(screenRoute) : null) ?? "vault";
  // Inside a share the own-account routes show the trimmed More (the
  // effect below rewrites the hash) -- never their screens, not for a frame.
  const blocked = inShare && BLOCKED_IN_SHARE.has(routeKey);
  const rawKey = blocked ? "more" : routeKey;
  // Change Password and Delete Account are layers
  // (desktop's modals, unchanged) over a screen that stays mounted beneath:
  // Delete over Settings (its route maps to the Settings key), Password over
  // the last screen shown (More on a deep link).
  const isPassword = rawKey === "more/password";
  // Sharing is the same kind of layer, over the screen it was opened from.
  const isSharing = rawKey === "more/sharing";
  const acctLayer: "password" | "delete" | "sharing" | null = isPassword
    ? "password"
    : isSharing
      ? "sharing"
      : rawKey === "more/settings" && screenRoute.segs[1] === "delete"
        ? "delete"
        : null;
  const overLayer = isPassword || isSharing;
  const [layerBase, setLayerBase] = useState("more");
  if (!overLayer && rawKey !== layerBase) setLayerBase(rawKey);
  const key = overLayer ? layerBase : rawKey;
  // Under an account layer the bar highlights the route beneath, as it
  // does under the tool layer.
  const navRoute = overLayer ? parseHash("#/" + layerBase) : screenRoute;
  // The account screens need a signed-in user (Settings / Delete) and a
  // password provider (Change Password): anything else lands on the Vault /
  // More, as desktop's panes snap back to Cards on sign-out (App.tsx). After a
  // successful Delete Account, Firebase signs out and this returns the shell
  // to the anonymous Vault.
  const pwProvider = hasPasswordProvider(user);
  useEffect(() => {
    // No keypad and no own-account screens inside a share.
    if (inShare && isTool) {
      go("#/vault", true);
      return;
    }
    if (blocked) {
      go("#/more", true);
      return;
    }
    if (loading) return;
    if (!user && (rawKey === "more/settings" || isPassword)) go("#/vault", true);
    else if (user && isPassword && !pwProvider) go("#/more", true);
    // Signed out at the Sharing deep link -> More, with sign-in raised
    // (the More row does the same for a tap; desktop's Share button opens it).
    else if (!user && isSharing) {
      go("#/more", true);
      openSignIn();
    }
  }, [
    loading,
    user,
    rawKey,
    isPassword,
    isSharing,
    pwProvider,
    openSignIn,
    inShare,
    isTool,
    blocked,
  ]);
  // A More sub-page entered from More shows the back chevron; entered any
  // other way (chooser, account menu, rail chip, deep link) the X. The
  // decision is kept per screen key, so a history return (More ->
  // Updates -> rail About -> X) re-enters Updates with its chevron. Cleared on
  // reaching More or the Vault (a later chooser / menu entry is not "from More").
  const [shownKey, setShownKey] = useState(key);
  const [movedFromMore, setMovedFromMore] = useState<Record<string, true>>({});
  if (shownKey !== key) {
    setShownKey(key);
    if (key === "more" || key === "vault") setMovedFromMore({});
    else if (shownKey === "more") setMovedFromMore({ ...movedFromMore, [key]: true });
  }
  const fromMore = movedFromMore[key] === true;
  // The own Vault is parked (mounted, hidden) while the share is shown.
  const ownParked = key === "vault" && inShare;

  const routed = (k: string): ReactNode => {
    if (k === "more")
      return (
        <MoreScreen
          signedIn={!!user}
          emailVerified={emailVerified}
          hasPasswordProvider={hasPasswordProvider(user)}
          updatesCue={cue.moreCue}
          account={account}
          onSignIn={openSignIn}
          onLogout={() => void logout()}
          inShare={inShare}
        />
      );
    if (k === "more/settings")
      return <SettingsScreen fromMore={fromMore} onDeleteAccount={() => go("#/more/delete")} />;
    if (k === "about" || k === "more/about") return <AboutScreen fromMore={fromMore} />;
    if (k === "more/updates") return <UpdatesScreen fromMore={fromMore} onSeen={cue.clear} />;
    if (k === "more/importexport")
      return (
        <ImportExportScreen
          fromMore={fromMore}
          signedIn={!!user}
          emailVerified={emailVerified}
          onRequestSignIn={openSignIn}
        />
      );
    if (k === "more/feedback") return <FeedbackScreen onClose={back} fromMore={fromMore} />;
    return null;
  };

  const screen: Screen =
    key !== "vault"
      ? { key, el: routed(key) }
      : {
          key: "vault",
          el: (
            <Vault
              // The parked own vault keeps the params it last had.
              params={inShare ? ownParams : vaultParams}
              account={account}
              unread={cue.unread}
              onOpenChooser={openChooser}
              onOpenFeedback={() => go("#/more/feedback")}
              onSearchMode={setSearchMode}
              // The Filters sheet's signed-out route.
              onRequestSignIn={openSignIn}
            />
          ),
        };

  // The shared pane mounts the first time the share is shown
  // and then stays mounted beside the own Vault (two data instances, like
  // desktop's two display-toggled panes); each keeps its own filters, scope
  // and scroll while the other is shown. Like the own Vault it leaves with
  // the Vault route (More, About, ...); its data instance stays.
  const [sharedMounted, setSharedMounted] = useState(inShare);
  if (inShare && !sharedMounted) setSharedMounted(true);
  const sharedPaneOn = key === "vault" && share.token != null && sharedMounted;
  const sharedPane = sharedPaneOn ? (
    <div
      className={"m-app__screen" + (inShare ? "" : " m-app__screen--parked")}
      key="vault-shared"
      data-pane="shared"
      aria-hidden={inShare ? undefined : true}
      inert={!inShare || cardId != null || acctLayer != null}
    >
      {share.status === "ready" ? (
        <Vault
          params={inShare ? vaultParams : sharedParams}
          account={account}
          unread={cue.unread}
          onOpenChooser={openChooser}
          onOpenFeedback={() => go("#/more/feedback")}
          onSearchMode={setSearchMode}
          onRequestSignIn={openSignIn}
          collectionLabel={`${share.name ?? ""}'s collection`}
        />
      ) : (
        <SharedStatus status={share.status} account={account} />
      )}
    </div>
  ) : null;

  // screen_viewed from the router, once per screen (not per param change).
  // Reaching More notes it for the Updates-row rule (useReleaseCue).
  // The password / delete / sharing layers report as their own screens;
  // closing one back onto the screen beneath it is not a new view of that
  // screen. The shared vault reports as desktop's shared_view.
  const viewKey = acctLayer ?? (screen.key === "vault" && inShare ? "shared" : screen.key);
  const prevView = useRef(viewKey);
  // The last non-layer screen actually reported, so closing a layer
  // onto a screen that was never reported (cold deep link, guard redirect)
  // still reports it once.
  const lastReportedScreen = useRef<string | null>(null);
  useEffect(() => {
    const closing =
      prevView.current === "password" ||
      prevView.current === "delete" ||
      prevView.current === "sharing";
    prevView.current = viewKey;
    if (closing && !acctLayer && viewKey === lastReportedScreen.current) return;
    // A signed-out visitor on an account route is being sent to the Vault.
    if (!user && (viewKey === "more/settings" || acctLayer)) return;
    // A Google-only account at the Change Password deep link is bounced to More.
    if (acctLayer === "password" && !pwProvider) return;
    if (!acctLayer) lastReportedScreen.current = viewKey;
    const v = SCREEN_VIEWED[viewKey];
    if (v) phoneScreenViewed(v);
    if (viewKey === "more") noteMore();
  }, [viewKey, acctLayer, user, pwProvider, noteMore]);

  return (
    <VaultDataProvider isAuthenticated={!!user}>
      {/* the caller's own stashes, signed in and on the own vault only. */}
      <StashProvider enabled={!!user} paused={inShare}>
        <CardParamBoot disabled={inShare} />
        <div
          className={"m-app" + (searchMode && screen.key === "vault" ? " m-app--search" : "")}
          data-share={inShare ? "shown" : undefined}
        >
          <SheetHost>
            <div
              className={"m-app__screen" + (ownParked ? " m-app__screen--parked" : "")}
              key={screen.key}
              data-pane={screen.key === "vault" ? "own" : undefined}
              aria-hidden={ownParked ? true : undefined}
              inert={cardId != null || toolShown || acctLayer != null || ownParked}
            >
              {screen.el}
            </div>
            {share.token && share.status !== "ready" ? sharedPane : null}
            {share.token && share.status === "ready" ? (
              <ShareScope token={share.token}>
                {sharedPane}
                {inShare && cardId != null ? (
                  <CardDetail
                    key={cardId}
                    id={cardId}
                    params={route.params}
                    onRequestSignIn={openSignIn}
                  />
                ) : null}
                {inShare ? <FinishSheetHost /> : null}
              </ShareScope>
            ) : null}
            <div
              className="m-app__nav"
              inert={cardId != null || toolShown || acctLayer != null}
              style={{ display: "contents" }}
            >
              <MobileNav route={navRoute} share={navShare} />
            </div>
            {toolShown && !inShare ? (
              <ToolLayer
                params={isTool ? route.params : {}}
                camera={cameraShown}
                covered={cardId != null}
                onRequestSignIn={openSignIn}
              />
            ) : null}
            {cardId != null && !inShare ? (
              <CardDetail
                key={cardId}
                id={cardId}
                params={route.params}
                onRequestSignIn={openSignIn}
              />
            ) : null}
            {/* Owned by finish opened from a Vault row. */}
            {inShare ? null : <FinishSheetHost />}
            {chooserOpen ? (
              <TitleChooser
                unread={cue.unread}
                onClose={closeChooser}
                onAbout={() => {
                  setChooserOpen(false);
                  go("#/about");
                }}
                onUpdates={() => {
                  setChooserOpen(false);
                  go("#/more/updates");
                }}
              />
            ) : null}
            {/* A signed-out visitor is being redirected (guard above): the layer
              would otherwise mount for a frame and call its API unauthenticated. */}
            {acctLayer && user && !inShare ? (
              <AccountLayer
                key={acctLayer}
                kind={acctLayer}
                onClose={() => backOr(acctLayer === "delete" ? "#/more/settings" : "#/more")}
              />
            ) : null}
            {authOpen ? (
              <AuthLayer
                initialMode={authMode}
                onClose={closeAuth}
                onSignedUp={() => setSignupInFlight(true)}
                onGoogleLinked={() => setGoogleLinkedInFlight(true)}
              />
            ) : null}
          </SheetHost>
        </div>
        {/* A phone on its side (App Spec §25.0) -- the app above stays mounted. */}
        <RotateScreen />
      </StashProvider>
    </VaultDataProvider>
  );
}
