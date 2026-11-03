import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../scripts/public-pages/fixtures/catalog.json";
import { buildPages, type PublicCatalog } from "../public/publicCatalog";
import { DesktopCardPage, PhoneCardPage, resetPrintingSelection } from "../public/CardPublicPage";
import { renderCardBody } from "../public/render";
import { cardTextPlain, parseCardText } from "../utils/cardText";
import { CardText } from "./CardText";
import { EpicActionText } from "./EpicActionText";

vi.mock("../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../analytics/analytics")>()),
  capture: vi.fn(),
}));

// The card-text markup tokens (App Spec §10, "Card-text markup tokens"):
// `<uq>` draws the unique mark, `<bullet>...</bullet>` a list, in the one
// renderer every card surface uses; the plain-text form reads "unique" and
// "• item". The sample texts are paraphrased shapes of the swuapi data
// (2026-10-02 export), not card rules text.

const html = (text: string) => renderToString(<CardText text={text} />);
/** A token React escaped into the markup: what a reader would see. */
const LITERAL = /&lt;\/?[a-z][a-z0-9]*&gt;/i;
const MARK = 'aria-label="unique"';

/** Paraphrased shapes found in the export. */
const SHAPES = {
  mid: "Give a Shield token to a <uq> unit.",
  start: "<uq> units you control get +1/+0.",
  multiple: "Return a non-<uq> (non-unique) unit, then ready a <uq> (unique) unit.",
  doubleSpace: "Attach to another <uq>  unit.",
  // The list shapes: lead-in line, then one <bullet> before the first item
  // and one </bullet> after the last, items one per line; a trailing newline
  // after the close on some printings.
  list: "Choose one:\n<bullet>Draw a card.\nHeal 2 damage from a base.</bullet>",
  listTrailing:
    "On Attack: If you control a:\n<bullet>Red unit, deal 1.\nBlue unit, heal 1.</bullet>\n",
  listWithUnique: "Choose one:\n<bullet>Ready a <uq> unit.\nExhaust a unit.</bullet>",
  aspects: "Action [1 resource, Exhaust]: Give a [Heroism] <uq> unit +1/+1.",
} as const;

describe("parseCardText", () => {
  it("splits the unique token out of a line, mid-sentence, at the start and repeated", () => {
    expect(parseCardText(SHAPES.mid)).toEqual([
      { kind: "paragraph", parts: ["Give a Shield token to a ", { unique: true }, " unit."] },
    ]);
    expect(parseCardText(SHAPES.start)).toEqual([
      { kind: "paragraph", parts: [{ unique: true }, " units you control get +1/+0."] },
    ]);
    const parts = (parseCardText(SHAPES.multiple)[0] as { parts: unknown[] }).parts;
    expect(parts.filter((p) => typeof p !== "string")).toHaveLength(2);
  });

  it("reads a bullet block as one list, one item per line", () => {
    expect(parseCardText(SHAPES.list)).toEqual([
      { kind: "paragraph", parts: ["Choose one:"] },
      { kind: "list", items: [["Draw a card."], ["Heal 2 damage from a base."]] },
    ]);
    expect(parseCardText(SHAPES.listTrailing)).toHaveLength(2);
    expect(parseCardText(SHAPES.listWithUnique)[1]).toEqual({
      kind: "list",
      items: [["Ready a ", { unique: true }, " unit."], ["Exhaust a unit."]],
    });
  });

  it("keeps text after a list and an unclosed list", () => {
    expect(parseCardText("Lead:\n<bullet>A.\nB.</bullet>\nThen C.")).toEqual([
      { kind: "paragraph", parts: ["Lead:"] },
      { kind: "list", items: [["A."], ["B."]] },
      { kind: "paragraph", parts: ["Then C."] },
    ]);
    expect(parseCardText("Lead:\n<bullet>A.\nB.")[1]).toEqual({
      kind: "list",
      items: [["A."], ["B."]],
    });
  });

  it("is empty for an absent or blank field", () => {
    expect(parseCardText(null)).toEqual([]);
    expect(parseCardText(undefined)).toEqual([]);
    expect(parseCardText("  ")).toEqual([]);
  });
});

describe("CardText", () => {
  it("renders a field without tokens as the plain paragraph it always was", () => {
    expect(html("Deal 2 damage to a unit.")).toBe(
      '<p class="cp-text__body">Deal 2 damage to a unit.</p>'
    );
    expect(renderToString(<CardText text={null} />)).toBe("");
    expect(renderToString(<CardText text="" />)).toBe("");
  });

  it("draws the unique mark in the line, labelled for assistive tech", () => {
    for (const text of [SHAPES.mid, SHAPES.start, SHAPES.doubleSpace]) {
      const out = html(text);
      expect(out).toMatch(/^<p class="cp-text__body">/);
      expect(out.split(MARK)).toHaveLength(2);
      expect(out).toContain('role="img"');
      expect(out).not.toMatch(LITERAL);
    }
    expect(html(SHAPES.multiple).split(MARK)).toHaveLength(3);
  });

  it("draws a bullet block as a list under its lead-in", () => {
    document.body.innerHTML = html(SHAPES.list);
    const body = document.querySelector(".cp-text__body")!;
    expect(body.tagName).toBe("DIV");
    expect(body.querySelector("p.cp-text__para")!.textContent).toBe("Choose one:");
    const items = [...body.querySelectorAll("ul.cp-text__list > li")].map((li) => li.textContent);
    expect(items).toEqual(["Draw a card.", "Heal 2 damage from a base."]);
    expect(document.body.innerHTML).not.toMatch(LITERAL);
    document.body.innerHTML = html(SHAPES.listWithUnique);
    expect(document.querySelectorAll("li .cp-text__unique")).toHaveLength(1);
    document.body.innerHTML = "";
  });

  it("leaves [Aspect] cost tokens as the text they were, next to a unique mark", () => {
    const out = html(SHAPES.aspects);
    expect(out).toContain("Action [1 resource, Exhaust]: Give a [Heroism] ");
    expect(out.split(MARK)).toHaveLength(2);
  });

  it("passes an unknown tag through, so the page output check can catch it", () => {
    expect(html("A <uq> unit with <foo> text.")).toContain("&lt;foo&gt;");
  });
});

describe("EpicActionText", () => {
  it("keeps the label once and draws the unique mark in the epic action", () => {
    const out = renderToString(
      <EpicActionText text="Epic Action: If you control a <uq> unit, deploy this leader." />
    );
    expect(out.match(/Epic Action:/g)).toHaveLength(1);
    expect(out).toContain(
      '<span class="cp-text__epic-label">Epic Action: </span>If you control a '
    );
    expect(out.split(MARK)).toHaveLength(2);
    expect(out).not.toMatch(LITERAL);
  });

  it("puts the label on the lead-in line of a list", () => {
    document.body.innerHTML = renderToString(
      <EpicActionText text={"Epic Action: Choose one:\n<bullet>Draw.\nHeal 1.</bullet>"} />
    );
    expect(document.querySelector(".cp-text__para")!.textContent).toBe("Epic Action: Choose one:");
    expect(document.querySelectorAll(".cp-text__epic-label")).toHaveLength(1);
    expect(document.querySelectorAll("li")).toHaveLength(2);
    document.body.innerHTML = "";
  });
});

describe("cardTextPlain", () => {
  it("reads the unique token as the word, folding the printed reminder", () => {
    expect(cardTextPlain(SHAPES.mid)).toBe("Give a Shield token to a unique unit.");
    expect(cardTextPlain(SHAPES.start)).toBe("unique units you control get +1/+0.");
    expect(cardTextPlain(SHAPES.multiple)).toBe(
      "Return a non-unique unit, then ready a unique unit."
    );
    expect(cardTextPlain(SHAPES.doubleSpace)).toBe("Attach to another unique unit.");
  });

  it("writes a list as one bullet line per item", () => {
    expect(cardTextPlain(SHAPES.list)).toBe(
      "Choose one:\n• Draw a card.\n• Heal 2 damage from a base."
    );
    expect(cardTextPlain(SHAPES.listWithUnique)).toBe(
      "Choose one:\n• Ready a unique unit.\n• Exhaust a unit."
    );
  });

  it("is empty for an absent field and leaves no token in any shape", () => {
    expect(cardTextPlain(null)).toBe("");
    for (const text of Object.values(SHAPES)) {
      expect(cardTextPlain(text)).not.toMatch(/<\/?[a-z]+>/);
    }
  });
});

// Census (App Spec §10): every text field of the fixture catalog, and every
// shape above, renders with no literal token on any surface -- the public
// card pages render both the desktop popup view and the phone card info.
describe("card-text token census", () => {
  const catalog = fixture as unknown as PublicCatalog;
  const fields = catalog.cards.flatMap((c) =>
    (["front_text", "back_text", "epic_action"] as const)
      .map((f) => c[f])
      .filter((t): t is string => !!t)
  );

  it("the fixture carries both tokens", () => {
    expect(fields.some((t) => t.includes("<uq>"))).toBe(true);
    expect(fields.some((t) => t.includes("<bullet>"))).toBe(true);
  });

  it("no field or shape renders a literal token, rich or plain", () => {
    for (const text of [...fields, ...Object.values(SHAPES)]) {
      expect(html(text), text).not.toMatch(LITERAL);
      expect(renderToString(<EpicActionText text={text} />), text).not.toMatch(LITERAL);
      expect(cardTextPlain(text), text).not.toMatch(/<\/?[a-z]+>/);
    }
  });

  it("no generated card page shows a literal token in either layout tree", () => {
    const pages = buildPages(catalog);
    let marks = 0;
    let lists = 0;
    for (const page of pages) {
      const body = renderCardBody(page).replace(/<script\b[\s\S]*?<\/script>/g, "");
      expect(body, `${page.card.set_code} ${page.card.base_card_number}`).not.toMatch(LITERAL);
      marks += body.split(MARK).length - 1;
      lists += body.split('class="cp-text__list"').length - 1;
    }
    // Both trees draw them: the desktop popup view and the phone card info.
    expect(marks).toBeGreaterThanOrEqual(2 * 4);
    expect(lists).toBe(2);
  });
});

// The pages server-render and then hydrate the same components: a page whose
// text carries both tokens hydrates with no mismatch on either tree.
describe("card-text tokens hydrate", () => {
  const pages = buildPages(fixture as unknown as PublicCatalog).filter((p) =>
    [p.card.front_text, p.card.back_text, p.card.epic_action].some(
      (t) => t && /<uq>|<bullet>/.test(t)
    )
  );
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it.each([
    ["desktop", "pc-desktop", DesktopCardPage],
    ["phone", "pc-phone", PhoneCardPage],
  ] as const)("the %s tree", async (_, id, Page) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      resetPrintingSelection();
      window.history.replaceState(null, "", "/cards/x/");
      document.body.innerHTML = renderCardBody(page);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const recoverable = vi.fn();
      await act(async () => {
        hydrateRoot(document.getElementById(id)!, <Page data={page} />, {
          onRecoverableError: recoverable,
        });
      });
      expect(recoverable).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    }
  });
});
