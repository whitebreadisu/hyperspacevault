import { repairMojibake } from "./mojibake";

// How a card's epic action reads (App Spec §10). The swuapi field arrives in
// several shapes (2026-10-02 export, 698 printings with one): most start
// with "Epic Action: " (a few wrapped in quotes), the Jump to Lightspeed
// pilots carry "Piloting [cost aspects] ...", a few start with
// "Action [...]: ", "Epic Action [cost]: " or plain text ("When you play
// ...", "When this upgrade detaches ..."). The views used to put
// "Epic Action: " in front of every one of them, so most cards read the label
// twice. The rule: "Epic Action: " shows only when the source text carried
// it -- stripped once (with its optional quotes) and shown once, unless the
// rest carries its own keyword -- and every other text passes through with
// no label. This is the one rule both card views (desktop CardPopupView,
// phone CardInfo) and the public card pages render through.

export interface EpicActionDisplay {
  /** "Epic Action: " when the source carried that label (and the rest has no
   * keyword of its own), else null. */
  label: string | null;
  text: string;
}

const QUOTED_LABEL = /^"\s*Epic Action\b/i;
const COLON_LABEL = /^Epic Action:\s*/i;
const OWN_KEYWORD = /^(Piloting\b|(Epic )?Action \[)/;

export function epicActionDisplay(raw: string | null | undefined): EpicActionDisplay | null {
  if (raw == null) return null;
  let text = repairMojibake(raw).trim();
  // '"Epic Action: ..."' -- the quote opened before the label closes at the end.
  if (QUOTED_LABEL.test(text)) {
    text = text.slice(1);
    if (text.endsWith('"')) text = text.slice(0, -1);
    text = text.trim();
  }
  const label = COLON_LABEL.exec(text);
  if (!label) return text ? { label: null, text } : null;
  text = text.slice(label[0].length).trim();
  if (!text) return null;
  return { label: OWN_KEYWORD.test(text) ? null : "Epic Action: ", text };
}
