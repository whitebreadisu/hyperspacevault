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

// The entry of the public card page document (card.html, prerendered per card
// by scripts/public-pages/generate.mjs). It hydrates the visible layout tree
// from the data embedded in the page; the hidden tree stays static and
// display:none (design note §4 D3). It never mounts App and never calls
// initAnalytics(), so the shared components' capture() calls stay no-ops
// (design note §6, C7); the page's own view event goes through
// publicAnalytics.ts (production hostnames only).

const PHONE_QUERY = "(max-width: 767px)";

const dataEl = document.getElementById("card-data");
if (dataEl?.textContent) {
  const data = JSON.parse(dataEl.textContent) as CardPageData;
  const phone = window.matchMedia(PHONE_QUERY).matches;
  const root = document.getElementById(phone ? "pc-phone" : "pc-desktop");
  if (root) {
    hydrateRoot(root, phone ? <PhoneCardPage data={data} /> : <DesktopCardPage data={data} />);
  }
  publicCapture("card_page_viewed", {
    set: data.card.set_code,
    number: padNumber(data.card.base_card_number),
    referrer_kind: referrerKind(document.referrer, window.location.hostname),
  });
}
