import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
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
import type { ScreenViewedScreen } from "../analytics/analytics";
import { phoneScreenViewed } from "./phoneAnalytics";
import { back, backOr, go, parseHash, useRoute } from "./router";
import type { Route } from "./router";
import { ToolLayer } from "./tool/ToolLayer";
import { TitleChooser } from "./TitleChooser";
import { useReleaseCue } from "./useReleaseCue";
import { VaultDataProvider } from "./vault/useVaultData";
import { Vault } from "./vault/Vault";
import "./mobile.css";
import "./shell.css";

/** BL-247: the phone app root (S1-04 shell). Route -> screen map as rev4
 * MApp.jsx:60-67 + 104-128, minus the prototype's stage chrome. Owns the
 * auth layer's open state with desktop's auto-close rule (App.tsx:186-191)
 * and the title chooser + release-notes cue (R5-2). */

interface Screen {
  key: string;
  el: ReactNode;
}

/** BL-250 S4: the routed (non-Vault) screen a route shows, by key -- null
 * for the Vault (and the card / tool layers, which sit over a screen).
 * `#/more/<unknown>` falls back to the More list (rev4 F-6). */
function screenKey(route: Route): string | null {
  const [a, b] = route.segs;
  if (a === "about") return "about";
  if (a !== "more") return null;
  // BL-251 S5-01: Settings; Delete Account is a layer over it (S5-03), so its
  // route keeps the Settings screen mounted underneath.
  if (b === "settings" || b === "delete") return "more/settings";
  // S5-02: Change Password is a layer over whatever screen it was opened from
  // (see `layerBase` below).
  if (b === "password") return "more/password";
  // S5-07: Sharing is a layer too (desktop's ShareManageModal, unchanged).
  if (b === "sharing") return "more/sharing";
  if (b === "about" || b === "updates" || b === "feedback" || b === "importexport")
    return "more/" + b;
  return "more";
}

/** S1-27 / S4-06: screen_viewed values by screen key. Updates reports
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
};

/** S1-15 (rev4 MApp.jsx:404-415, m-layout.css:643-655): the app frame
 * follows the visual viewport, so with the keyboard up the list's bottom
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

export function MobileApp() {
  const route = useRoute();
  const { user, logout, emailVerified, loading } = useAuth();

  // S1-09: the auth layer, closed by desktop's single-source-of-truth rule --
  // a successful sign-in closes it, except mid-signup / mid-Google-link where
  // AuthModal owns its own follow-up screen (App.tsx BL-16 / BL-118).
  const [authOpen, setAuthOpen] = useState(false);
  const [signupInFlight, setSignupInFlight] = useState(false);
  const [googleLinkedInFlight, setGoogleLinkedInFlight] = useState(false);
  useEffect(() => {
    if (user && !signupInFlight && !googleLinkedInFlight) setAuthOpen(false);
  }, [user, signupInFlight, googleLinkedInFlight]);
  const openSignIn = useCallback(() => setAuthOpen(true), []);
  const closeAuth = useCallback(() => {
    setAuthOpen(false);
    setSignupInFlight(false);
    setGoogleLinkedInFlight(false);
  }, []);

  // S1-07 / S4-04: the title chooser and the release-notes cue.
  const cue = useReleaseCue();
  const [chooserOpen, setChooserOpen] = useState(false);
  const closeChooser = useCallback(() => setChooserOpen(false), []);
  const { noteTitle, noteMore } = cue;
  const openChooser = useCallback(() => {
    setChooserOpen(true);
    noteTitle();
  }, [noteTitle]);

  const account = (
    <AccountSlot
      email={user?.email ?? null}
      hasPasswordProvider={hasPasswordProvider(user)}
      onSignIn={openSignIn}
      onLogout={() => void logout()}
    />
  );

  // S1-15: search mode collapses the bottom bar as well as the headers.
  const [searchMode, setSearchMode] = useState(false);
  useVisualViewport();

  // BL-248 S2-01: #/card/<id> is a layer over the Vault, which stays mounted
  // under it with the params it last had (filters, scope, scroll and list
  // survive the visit, as under desktop's popup).
  // F9: a non-numeric id is still the card layer (id -1: not in the
  // catalogue), not a fall-through to the Vault under a card hash.
  const cardId =
    route.segs[0] === "card" ? (/^\d+$/.test(route.segs[1] ?? "") ? +route.segs[1] : -1) : null;
  // BL-249 S3-01: #/pad (and #/camera) is the tool LAYER over the screen it
  // was opened from (baseRoute: the last route that is neither the tool nor
  // a card), which stays mounted beneath it with the bar covered. S3-06: a
  // card opened from the tool layers over the tool, which stays mounted
  // (inert) so its state is untouched when the card closes.
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
  const screenRoute = toolShown ? baseRoute : route;

  const [vaultParams, setVaultParams] = useState(() =>
    cardId == null && !isTool ? route.params : {}
  );
  if (cardId == null && !isTool && !screenKey(route) && route.params !== vaultParams)
    setVaultParams(route.params);

  const rawKey = (cardId == null || toolShown ? screenKey(screenRoute) : null) ?? "vault";
  // BL-251 S5-02 / S5-03: Change Password and Delete Account are layers
  // (desktop's modals, unchanged) over a screen that stays mounted beneath:
  // Delete over Settings (its route maps to the Settings key), Password over
  // the last screen shown (More on a deep link).
  const isPassword = rawKey === "more/password";
  // S5-07: Sharing is the same kind of layer, over the screen it was opened from.
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
  // S5 F5: under an account layer the bar highlights the route beneath, as it
  // does under the tool layer.
  const navRoute = overLayer ? parseHash("#/" + layerBase) : screenRoute;
  // The account screens need a signed-in user (Settings / Delete) and a
  // password provider (Change Password): anything else lands on the Vault /
  // More, as desktop's panes snap back to Cards on sign-out (App.tsx). After a
  // successful Delete Account, Firebase signs out and this returns the shell
  // to the anonymous Vault.
  const pwProvider = hasPasswordProvider(user);
  useEffect(() => {
    if (loading) return;
    if (!user && (rawKey === "more/settings" || isPassword)) go("#/vault", true);
    else if (user && isPassword && !pwProvider) go("#/more", true);
    // S5-07: signed out at the Sharing deep link -> More, with sign-in raised
    // (the More row does the same for a tap; desktop's Share button opens it).
    else if (!user && isSharing) {
      go("#/more", true);
      openSignIn();
    }
  }, [loading, user, rawKey, isPassword, isSharing, pwProvider, openSignIn]);
  // BL-250 S4-05: a More sub-page entered from More shows the back chevron;
  // entered any other way (chooser, account menu, rail chip, deep link) the X.
  // S4 F2: the decision is kept per screen key, so a history return (More ->
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
              params={vaultParams}
              account={account}
              unread={cue.unread}
              onOpenChooser={openChooser}
              onOpenFeedback={() => go("#/more/feedback")}
              onSearchMode={setSearchMode}
              // ── RUN 2B BEGIN (signin) ── the Filters sheet's signed-out route
              onRequestSignIn={openSignIn}
              // ── RUN 2B END (signin) ──
            />
          ),
        };

  // S1-27 / S4-06: screen_viewed from the router, once per screen (not per
  // param change); ComingSoon placeholders send nothing until their slices
  // land. S4-04: reaching More notes it for the Updates-row rule.
  // S5-05: the password / delete layers report as their own screens; closing
  // one back onto the screen beneath it is not a new view of that screen.
  const viewKey = acctLayer ?? screen.key;
  const prevView = useRef(viewKey);
  // S5 F1: the last non-layer screen actually reported, so closing a layer
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
      <div className={"m-app" + (searchMode && screen.key === "vault" ? " m-app--search" : "")}>
        <SheetHost>
          <div
            className="m-app__screen"
            key={screen.key}
            inert={cardId != null || toolShown || acctLayer != null}
          >
            {screen.el}
          </div>
          <div
            className="m-app__nav"
            inert={cardId != null || toolShown || acctLayer != null}
            style={{ display: "contents" }}
          >
            <MobileNav route={navRoute} />
          </div>
          {toolShown ? (
            <ToolLayer
              params={isTool ? route.params : {}}
              covered={cardId != null}
              onRequestSignIn={openSignIn}
            />
          ) : null}
          {cardId != null ? (
            <CardDetail
              key={cardId}
              id={cardId}
              params={route.params}
              onRequestSignIn={openSignIn}
            />
          ) : null}
          {/* BL-248 S2-10: Owned by finish opened from a Vault row. */}
          <FinishSheetHost />
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
          {acctLayer && user ? (
            <AccountLayer
              key={acctLayer}
              kind={acctLayer}
              onClose={() => backOr(acctLayer === "delete" ? "#/more/settings" : "#/more")}
            />
          ) : null}
          {authOpen ? (
            <AuthLayer
              onClose={closeAuth}
              onSignedUp={() => setSignupInFlight(true)}
              onGoogleLinked={() => setGoogleLinkedInFlight(true)}
            />
          ) : null}
        </SheetHost>
      </div>
    </VaultDataProvider>
  );
}
