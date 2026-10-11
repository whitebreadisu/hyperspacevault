import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { hasPasswordProvider } from "../utils/googleAuth";
import { AccountSlot } from "./AccountSlot";
import { AuthLayer } from "./AuthLayer";
import { CardDetail } from "./card/CardDetail";
import { FinishSheetHost } from "./card/FinishSheet";
import { ComingSoon } from "./ComingSoon";
import { FeedbackScreen } from "./FeedbackScreen";
import { AboutScreen } from "./more/AboutScreen";
import { MoreScreen } from "./more/MoreScreen";
import { UpdatesScreen } from "./more/UpdatesScreen";
import { SheetHost } from "./Sheet";
import { MobileNav } from "./MobileNav";
import type { ScreenViewedScreen } from "../analytics/analytics";
import { phoneScreenViewed } from "./phoneAnalytics";
import { back, go, parseHash, useRoute } from "./router";
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
 * and the title chooser + release-notes cue (R5-2). Screens later slices
 * build render ComingSoon until then. */

interface Screen {
  key: string;
  el: ReactNode;
}

const SOON: Record<string, string> = {
  "more/settings": "Settings arrive with a later slice.",
  "more/password": "Change Password arrives with a later slice.",
  "more/sharing": "Sharing arrives with a later slice.",
  "more/importexport": "Import & Export arrives with a later slice.",
};

/** BL-250 S4: the routed (non-Vault) screen a route shows, by key -- null
 * for the Vault (and the card / tool layers, which sit over a screen).
 * `#/more/<unknown>` falls back to the More list (rev4 F-6). */
function screenKey(route: Route): string | null {
  const [a, b] = route.segs;
  if (a === "about") return "about";
  if (a !== "more") return null;
  if (b === "about" || b === "updates" || b === "feedback" || (b && SOON["more/" + b]))
    return "more/" + b;
  return "more";
}

/** S1-27 / S4-06: screen_viewed values by screen key. Updates reports
 * desktop's `new_arrivals` (App Spec §22 names it for the same screen). */
const SCREEN_VIEWED: Record<string, ScreenViewedScreen> = {
  vault: "vault",
  more: "more",
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
  const { user, logout, emailVerified } = useAuth();

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

  const key = (cardId == null || toolShown ? screenKey(screenRoute) : null) ?? "vault";
  // BL-250 S4-05: a More sub-page entered from More shows the back chevron;
  // entered any other way (chooser, account menu, rail chip, deep link) the X.
  const [shownKey, setShownKey] = useState(key);
  const [enteredFrom, setEnteredFrom] = useState<string | null>(null);
  if (shownKey !== key) {
    setEnteredFrom(shownKey);
    setShownKey(key);
  }
  const fromMore = (shownKey === key ? enteredFrom : shownKey) === "more";

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
    if (k === "about" || k === "more/about") return <AboutScreen fromMore={fromMore} />;
    if (k === "more/updates") return <UpdatesScreen fromMore={fromMore} onSeen={cue.clear} />;
    if (k === "more/feedback") return <FeedbackScreen onClose={back} />;
    return <ComingSoon sentence={SOON[k]} />;
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
  useEffect(() => {
    const v = SCREEN_VIEWED[screen.key];
    if (v) phoneScreenViewed(v);
    if (screen.key === "more") noteMore();
  }, [screen.key, noteMore]);

  return (
    <VaultDataProvider isAuthenticated={!!user}>
      <div className={"m-app" + (searchMode && screen.key === "vault" ? " m-app--search" : "")}>
        <SheetHost>
          <div className="m-app__screen" key={screen.key} inert={cardId != null || toolShown}>
            {screen.el}
          </div>
          <div
            className="m-app__nav"
            inert={cardId != null || toolShown}
            style={{ display: "contents" }}
          >
            <MobileNav route={screenRoute} />
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
