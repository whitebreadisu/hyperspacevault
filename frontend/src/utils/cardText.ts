// swuapi card-text markup (App Spec §10, "Card-text markup tokens"). The
// text fields (front_text, back_text, epic_action) carry two tokens:
//   - `<uq>`: the unique symbol, inline ("a <uq> unit", "non-<uq>
//     (non-unique) upgrade"), 108 printings (36 distinct texts) in the
//     2026-10-02 export;
//   - `<bullet>...</bullet>`: a list. One opening tag before the first item
//     and one closing tag after the last; the items are the newline-separated
//     lines between them (23 printings, 5 distinct texts, all front text:
//     "Choose one:\n<bullet>A.\nB.</bullet>").
// parseCardText turns a field into blocks the shared CardText component
// renders; cardTextPlain is the plain-text form for any context that cannot
// carry markup (meta, titles, exports). Both are pure, so a page renders the
// same markup on the server and when it hydrates. Any other `<tag>` the
// source may add later passes through as text on purpose: it stays visible,
// and the card-page output check (scripts/public-pages/check-output.mjs)
// reports it as a warning, so a new token gets a rendering rule instead of
// silently losing its meaning (a known token left literal fails that check).

import tokens from "./cardTextTokens.json";

export type CardTextInline = string | { unique: true };

export type CardTextBlock =
  { kind: "paragraph"; parts: CardTextInline[] } | { kind: "list"; items: CardTextInline[][] };

/** The tokens this module has a rule for, exactly as swuapi writes them
 * (`</uq>` is not one). One list, shared with the card-page output check,
 * which fails on any of these left literal and warns on any other tag. */
export const KNOWN_CARD_TEXT_TOKENS: readonly string[] = tokens.known;

const UQ = /<uq>/gi;
const LIST = /<bullet>([\s\S]*?)(?:<\/bullet>|$)/gi;
/** A bullet tag left over after the lists are cut out: a stray `</bullet>`
 * with no opening tag, or a `<bullet>` inside an open list. Dropped, so no
 * known token is ever left literal. */
const STRAY_BULLET = /<\/?bullet>/gi;

/** "a <uq> unit" -> ["a ", {unique}, " unit"]. */
function inline(text: string): CardTextInline[] {
  const parts: CardTextInline[] = [];
  text
    .replace(STRAY_BULLET, "")
    .split(UQ)
    .forEach((piece, i) => {
      if (i > 0) parts.push({ unique: true });
      if (piece) parts.push(piece);
    });
  return parts;
}

/**
 * The printed line breaks, as the panel shows them (white-space: pre-line,
 * CardText.css): edges trimmed (754 front texts in the 2026-10-02 export
 * have an edge newline or space), spaces around a break dropped, and a
 * blank line (347 "Keyword\n\nWhen Played: ..." breaks, where most cards
 * write one "\n") folded to one break, so every keyword-then-ability card
 * reads the same.
 */
export function cardTextLines(text: string): string {
  return text.trim().replace(/[ \t]*\n\s*/g, "\n");
}

function paragraph(text: string): CardTextBlock | null {
  const parts = inline(cardTextLines(text));
  return parts.some((p) => typeof p !== "string" || p.trim()) ? { kind: "paragraph", parts } : null;
}

/** The field as paragraphs and lists, in source order. Null or blank -> []. */
export function parseCardText(raw: string | null | undefined): CardTextBlock[] {
  if (!raw) return [];
  const blocks: CardTextBlock[] = [];
  let at = 0;
  for (const m of raw.matchAll(LIST)) {
    const before = paragraph(raw.slice(at, m.index));
    if (before) blocks.push(before);
    const items = m[1]
      .split("\n")
      .map((line) => line.trim())
      .map(inline)
      .filter((item) => item.length > 0);
    if (items.length) blocks.push({ kind: "list", items });
    at = m.index + m[0].length;
  }
  const after = paragraph(raw.slice(at));
  if (after) blocks.push(after);
  return blocks;
}

/** True when the field carries a token this module renders (the renderer's
 * fast path: a field without one renders as one plain paragraph). */
export function hasCardTextMarkup(raw: string | null | undefined): boolean {
  return !!raw && /<uq>|<\/?bullet>/i.test(raw);
}

/**
 * Plain text: `<uq>` reads as the word "unique" (search snippets and screen
 * readers read words, and the printed sentence "a <uq> unit" means "a
 * unique unit"); a printed reminder after it ("<uq> (unique)", "non-<uq>
 * (non-unique)") folds into that one word; each list item becomes "• item"
 * on its own line. Whitespace runs inside a line collapse to one space.
 * No page context carries card text today (meta, og, JSON-LD, titles, CSV);
 * this is the form the first one uses.
 */
export function cardTextPlain(raw: string | null | undefined): string {
  if (!raw) return "";
  const line = (parts: CardTextInline[]) =>
    parts
      .map((p) => (typeof p === "string" ? p : "unique"))
      .join("")
      .replace(/\bunique\s*\((?:non-)?unique\)/g, "unique")
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
  return parseCardText(raw)
    .map((b) =>
      b.kind === "paragraph" ? line(b.parts) : b.items.map((it) => `• ${line(it)}`).join("\n")
    )
    .join("\n");
}
