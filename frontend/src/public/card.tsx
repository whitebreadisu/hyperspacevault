import { hydrateRoot } from "react-dom/client";
import "../index.css";
import "../mobile/mobile.css";
import "../mobile/vault/vault.css";
import "../mobile/card/card.css";
// The Market/Low switch (ValueSwitch) is styled in the Vault's sheet.
import "../screens/cards/cards.css";
import "./public.css";
import { DesktopCardPage, PhoneCardPage } from "./CardPublicPage";
import { padNumber } from "./publicCatalog";
import { hydrateTreesOnReveal } from "./treeHydration";
import type { CardPageData } from "./publicCatalog";
import { publicCapture, referrerKind } from "./publicAnalytics";
import {
  AUTO_OPEN_FLAG,
  AUTO_OPEN_STALLED_EVENT,
  autoOpenFromLocation,
  bootStep,
} from "./autoOpen";

// The entry of the public card page document (card.html, prerendered per card
// by scripts/public-pages/generate.mjs). It hydrates the visible layout tree
// from the data embedded in the page; the hidden tree stays static and
// display:none (design note §4 D3) until the viewport crosses the 767 px
// switch, when it is hydrated too (once; the first tree stays hydrated), so
// the tree the CSS reveals always has live controls. It never mounts App and
// never calls initAnalytics(), so the shared components' capture() calls stay no-ops
// (design note §6, C7); the page's own view event goes through
// publicAnalytics.ts (production hostnames only).
//
// A browser that has opened the app before (the app's boot marker,
// utils/appSeen.ts) is sent to this card in the app by the inline script at
// the top of the head (autoOpen.ts AUTO_OPEN_JS), before the page paints.
// What this script then does is autoOpen.ts bootStep: while the head
// script's navigation is pending it waits, and hydrates only if that
// navigation stalls; without a head script the same check runs here as a
// fallback (location.replace, so Back does not return to a page that would
// redirect again; the event on a keepalive request). `?page` keeps the
// visitor here.

const PHONE_QUERY = "(max-width: 767px)";

const dataEl = document.getElementById("card-data");
if (dataEl?.textContent) {
  const data = JSON.parse(dataEl.textContent) as CardPageData;
  const headState = (window as unknown as Record<string, unknown>)[AUTO_OPEN_FLAG];
  const target = autoOpenFromLocation(data.card);
  const step = bootStep(headState, target);
  if (step === "wait") {
    window.addEventListener(AUTO_OPEN_STALLED_EVENT, () => hydrate(data), { once: true });
  } else if (step === "redirect" && target) {
    publicCapture("card_page_cta", { action: "auto_open" });
    window.location.replace(target);
  } else {
    hydrate(data);
  }
}

function hydrate(data: CardPageData) {
  hydrateTreesOnReveal(window.matchMedia(PHONE_QUERY), (phone) => {
    const root = document.getElementById(phone ? "pc-phone" : "pc-desktop");
    if (root) {
      hydrateRoot(root, phone ? <PhoneCardPage data={data} /> : <DesktopCardPage data={data} />);
    }
  });
  publicCapture("card_page_viewed", {
    set: data.card.set_code,
    number: padNumber(data.card.base_card_number),
    referrer_kind: referrerKind(document.referrer, window.location.hostname),
  });
}
