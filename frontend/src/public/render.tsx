import { renderToString } from "react-dom/server";
import { DesktopCardPage, PhoneCardPage } from "./CardPublicPage";
import { scriptJson } from "./head";
import type { CardPageData } from "./publicCatalog";

// Server side of the render-then-hydrate harness (design note §4 D3, §7):
// (page data) -> the page body, runnable in Node. The generator
// (scripts/public-pages/generate.mjs) builds this module with Vite's SSR
// build and calls it per card. Both layout trees are rendered; the data
// they were rendered from is embedded once for hydration (card.tsx).

export { buildPages } from "./publicCatalog";
export { headHtml } from "./head";

export const DESKTOP_ROOT_ID = "pc-desktop";
export const PHONE_ROOT_ID = "pc-phone";
export const DATA_ID = "card-data";

export function renderCardBody(data: CardPageData): string {
  const desktop = renderToString(<DesktopCardPage data={data} />);
  const phone = renderToString(<PhoneCardPage data={data} />);
  return [
    `<div id="${DESKTOP_ROOT_ID}" class="pc-tree pc-tree--desktop">${desktop}</div>`,
    `<div id="${PHONE_ROOT_ID}" class="pc-tree pc-tree--phone">${phone}</div>`,
    `<script type="application/json" id="${DATA_ID}">${scriptJson(data)}</script>`,
  ].join("\n    ");
}
