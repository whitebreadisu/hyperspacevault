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
import type { CardPageData } from "./publicCatalog";
import { publicCapture, referrerKind } from "./publicAnalytics";
import { autoOpenFromLocation } from "./autoOpen";

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
// Before hydrating, a browser that has opened the app before (the app's boot
// marker, utils/appSeen.ts) is sent to this card in the app instead
// (autoOpen.ts): location.replace, so Back does not return to a page that
// would redirect again. `?page` keeps the visitor here. The CTA event goes
// out on a keepalive request, which outlives the navigation.

const PHONE_QUERY = "(max-width: 767px)";

const dataEl = document.getElementById("card-data");
if (dataEl?.textContent) {
  const data = JSON.parse(dataEl.textContent) as CardPageData;
  const target = autoOpenFromLocation(data.card);
  if (target) {
    publicCapture("card_page_cta", { action: "auto_open" });
    window.location.replace(target);
  } else {
    hydrate(data);
  }
}

function hydrate(data: CardPageData) {
  const query = window.matchMedia(PHONE_QUERY);
  const done = new Set<string>();
  const hydrateVisible = () => {
    const phone = query.matches;
    const id = phone ? "pc-phone" : "pc-desktop";
    if (done.has(id)) return;
    done.add(id);
    const root = document.getElementById(id);
    if (root) {
      hydrateRoot(root, phone ? <PhoneCardPage data={data} /> : <DesktopCardPage data={data} />);
    }
    if (done.size === 2) query.removeEventListener("change", hydrateVisible);
  };
  hydrateVisible();
  query.addEventListener("change", hydrateVisible);
  publicCapture("card_page_viewed", {
    set: data.card.set_code,
    number: padNumber(data.card.base_card_number),
    referrer_kind: referrerKind(document.referrer, window.location.hostname),
  });
}
