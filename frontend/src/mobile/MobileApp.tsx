import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { hasPasswordProvider } from "../utils/googleAuth";
import { AccountSlot } from "./AccountSlot";
import { AuthLayer } from "./AuthLayer";
import { CardDetail } from "./card/CardDetail";
import { ComingSoon } from "./ComingSoon";
import { FeedbackScreen } from "./FeedbackScreen";
import { SheetHost } from "./Sheet";
import { MobileNav } from "./MobileNav";
import { phoneScreenViewed } from "./phoneAnalytics";
import { back, go, useRoute } from "./router";
import type { Route } from "./router";
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
  pad: "The keypad arrives with the next slice.",
  more: "More arrives with a later slice.",
  "more/updates": "[HSV] Updates arrive with a later slice.",
  "more/settings": "Settings arrive with a later slice.",
  "more/password": "Change Password arrives with a later slice.",
  about: "About & Legal arrives with a later slice.",
};

function soonFor(route: Route): Screen | null {
  const [a, b] = route.segs;
  if (a === "pad" || a === "camera") return { key: "pad", el: <ComingSoon sentence={SOON.pad} /> };
  if (a === "about") return { key: "about", el: <ComingSoon sentence={SOON.about} /> };
  if (a === "more" && b === "feedback")
    return { key: "more/feedback", el: <FeedbackScreen onClose={back} /> };
  if (a === "more") {
    const k = b && SOON["more/" + b] ? "more/" + b : "more";
    return { key: k, el: <ComingSoon sentence={SOON[k]} /> };
  }
  return null;
}

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
  const { user, logout } = useAuth();

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

  // S1-07: the title chooser and the release-notes cue.
  const cue = useReleaseCue(route.path);
  const [chooserOpen, setChooserOpen] = useState(false);
  const closeChooser = useCallback(() => setChooserOpen(false), []);

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
  const cardId =
    route.segs[0] === "card" && /^\d+$/.test(route.segs[1] ?? "") ? +route.segs[1] : null;
  const [vaultParams, setVaultParams] = useState(() => (cardId == null ? route.params : {}));
  if (cardId == null && !soonFor(route) && route.params !== vaultParams)
    setVaultParams(route.params);

  const screen: Screen = (cardId == null ? soonFor(route) : null) ?? {
    key: "vault",
    el: (
      <Vault
        params={vaultParams}
        account={account}
        unread={cue.unread}
        onOpenChooser={() => setChooserOpen(true)}
        onOpenFeedback={() => go("#/more/feedback")}
        onSearchMode={setSearchMode}
      />
    ),
  };

  // S1-27: screen_viewed from the router, once per screen (not per param
  // change), for the screens S1 builds; ComingSoon placeholders send nothing
  // until their slices land.
  useEffect(() => {
    if (screen.key === "vault") phoneScreenViewed("vault");
    else if (screen.key === "more/feedback") phoneScreenViewed("feedback");
  }, [screen.key]);

  return (
    <VaultDataProvider isAuthenticated={!!user}>
      <div className={"m-app" + (searchMode && screen.key === "vault" ? " m-app--search" : "")}>
        <SheetHost>
          <div className="m-app__screen" key={screen.key} inert={cardId != null}>
            {screen.el}
          </div>
          <div className="m-app__nav" inert={cardId != null} style={{ display: "contents" }}>
            <MobileNav route={route} />
          </div>
          {cardId != null ? (
            <CardDetail
              key={cardId}
              id={cardId}
              params={route.params}
              onRequestSignIn={openSignIn}
            />
          ) : null}
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
                cue.clear();
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
