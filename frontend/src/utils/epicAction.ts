import { repairMojibake } from "./mojibake";

// How a card's epic action reads (BL-326). The swuapi field arrives in
// several shapes (2026-10-02 export, 698 printings with one): 498 start with
// "Epic Action: ", 2 with a quoted '"Epic Action: ...', 184 are Jump to
// Lightspeed pilot text ("Piloting [cost aspects] ..."), 6 start with
// "Action [...]: ..." and 8 with "When you play ...". The catalogue also holds
// two rarer forms: LAW 13 "Epic Action [4 resources]: ..." (its own label
// with a cost, kept as is) and JTL 83 "When this upgrade detaches ..." (no
// keyword, so it gets the label). The views used to put "Epic Action: " in
// front of every one of them, so most cards read the label twice. This is
// the one rule both card views (desktop CardPopupView, phone CardInfo) and
// the public card pages render through.

export interface EpicActionDisplay {
  /** "Epic Action: " -- or null when the text carries its own keyword
   * (Piloting, Action [...], Epic Action [...]). */
  label: string | null;
  text: string;
}

const LEADING_LABEL = /^\s*("?)\s*Epic Action:\s*/i;
const OWN_KEYWORD = /^(Piloting\b|(Epic )?Action \[)/;

export function epicActionDisplay(raw: string | null | undefined): EpicActionDisplay | null {
  if (raw == null) return null;
  let text = repairMojibake(raw).trim();
  const m = LEADING_LABEL.exec(text);
  if (m) {
    text = text.slice(m[0].length);
    // A quote opened before the label closes at the end of the text.
    if (m[1] && text.endsWith('"')) text = text.slice(0, -1);
    text = text.trim();
  }
  if (!text) return null;
  return { label: OWN_KEYWORD.test(text) ? null : "Epic Action: ", text };
}
