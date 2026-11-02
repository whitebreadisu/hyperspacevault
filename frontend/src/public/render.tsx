import { renderToString } from "react-dom/server";
import { DesktopCardPage, PhoneCardPage } from "./CardPublicPage";
import { scriptJson } from "./head";
import type { CardPageData, IndexPageData, SetPageData } from "./publicCatalog";
import { CardsIndexPage, SetPage } from "./SetPages";

// Server side of the render-then-hydrate harness (design note §4 D3, §7):
// (page data) -> the page body, runnable in Node. The generator
// (scripts/public-pages/generate.mjs) builds this module with Vite's SSR
// build and calls it per page.
//   - Card pages: both layout trees are rendered; the data they were
//     rendered from is embedded once for hydration (card.tsx).
//   - Set pages and the set index: one static tree, no data, no hydration.

export {
  MOJIBAKE,
  buildIndexPage,
  buildPages,
  buildSetPages,
  cardPath,
  setPath,
} from "./publicCatalog";
export { headHtml, indexHeadHtml, setHeadHtml } from "./head";

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

export function renderSetBody(data: SetPageData): string {
  return renderToString(<SetPage data={data} />);
}

export function renderIndexBody(data: IndexPageData): string {
  return renderToString(<CardsIndexPage data={data} />);
}
