import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InventorySummary } from "./InventorySummary";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import type { SetMeta } from "../../utils/completion";

// BL-163 (Definition_CosmeticsBatch_2026-07-26.md §3): the completion panel
// revamp -- four blocks (Playset/Set complete %, Cards, Collection value),
// a Filtered/All scope toggle, and per-block "«metric» by set" breakdown
// popovers. `cards` (the single list prop) is REPLACEd by `filteredCards` +
// optional `allCards`/`isNarrowed`/`baseSetCodes`/`orderedBaseSets` -- every
// pre-BL-163 test below is PORTed onto the new prop name and the new
// 4-value block layout; the calc-rule suites (scope, orphan exclusion,
// value fallback chain, popovers, signed-out) are CREATE.

function makeVariant(overrides: Partial<InventoryVariant> = {}): InventoryVariant {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "1",
    front_image_url: null,
    back_image_url: null,
    quantity: 0,
    ...overrides,
  };
}

function makeCard(overrides: Partial<InventoryCard> = {}): InventoryCard {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "1",
    name: "Card",
    subtitle: null,
    rarity: "C",
    type: "Unit",
    aspects: [],
    keywords: [],
    traits: [],
    cost: 1,
    power: 1,
    hp: 1,
    arena: "Ground",
    is_token: false,
    variants: [],
    inventory: {},
    ...overrides,
  };
}

const SOR_SHD_BASE_SETS: SetMeta[] = [
  { code: "SOR", name: "Spark of Rebellion" },
  { code: "SHD", name: "Shadows of the Galaxy" },
];
const SOR_SHD_CODES = new Set(["SOR", "SHD"]);

function summaryValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".inv-summary__value")).map(
    (el) => el.textContent ?? ""
  );
}

function summarySub(container: HTMLElement): string {
  return container.querySelector(".inv-summary__sub")?.textContent ?? "";
}

function block(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-testid="inv-summary-block-${id}"]`) as HTMLElement;
}

// SWU_Catalog_Redesign_Spec.md §6: tokens behave like normal cards at the
// row level (PlaysetCell pips still render for them -- exercised elsewhere)
// but are excluded from every InventorySummary aggregate: playset %, set %,
// the raw "N cards" count, and the "N unique" count.
describe("InventorySummary token exclusion (§6, PORT)", () => {
  it("excludes a token card from every aggregate", () => {
    const nonToken = makeCard({
      base_card_id: 1,
      type: "Unit",
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 }, // playset-complete, 3 owned
    });
    const token = makeCard({
      base_card_id: 2,
      name: "Battle Droid Token",
      type: "Token Unit",
      is_token: true,
      variants: [makeVariant({ variant_id: 2, quantity: 5 })],
      inventory: { 2: 5 }, // would otherwise dominate the raw count
    });

    const { container } = render(
      <InventorySummary filteredCards={[nonToken, token]} baseSetCodes={SOR_SHD_CODES} />
    );

    // With the token excluded, total=1 and it's playset-complete/owned:
    // playset 100%, set 100%, "3 cards" (not 8), "1 unique" (not 2); no
    // price data on either fixture variant -> Collection value is $0.00.
    expect(summaryValues(container)).toEqual(["100%", "100%", "3", "$0.00"]);
    expect(summarySub(container)).toBe("(1 unique)");
  });

  it("returns 0% / 0 cards when only tokens are present (no divide-by-zero on non-token total)", () => {
    const token = makeCard({
      base_card_id: 2,
      is_token: true,
      variants: [makeVariant({ variant_id: 2, quantity: 5 })],
      inventory: { 2: 5 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[token]} baseSetCodes={SOR_SHD_CODES} />
    );

    expect(summaryValues(container)).toEqual(["0%", "0%", "0", "$0.00"]);
    expect(summarySub(container)).toBe("(0 unique)");
  });
});

// DISPOSITION (BL-56 Slice 4, PORT for BL-163): the em-dash placeholder
// requirement is unchanged, extended to the new Collection-value block.
describe("InventorySummary anonymous placeholder values (BL-56 §5.5, PORT for BL-163)", () => {
  it("renders em-dash values (not 0%/0/$0.00) when isAuthenticated=false, even with populated inventory data", () => {
    const card = makeCard({
      base_card_id: 1,
      type: "Unit",
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });

    const { container } = render(
      <InventorySummary
        filteredCards={[card]}
        baseSetCodes={SOR_SHD_CODES}
        isAuthenticated={false}
      />
    );

    expect(summaryValues(container)).toEqual(["—", "—", "—", "—"]);
    expect(summarySub(container)).toBe("(— unique)");
  });

  it("defaults to authenticated (real numbers) when isAuthenticated is omitted", () => {
    const card = makeCard({
      base_card_id: 1,
      type: "Unit",
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[card]} baseSetCodes={SOR_SHD_CODES} />
    );

    expect(summaryValues(container)).toEqual(["100%", "100%", "3", "$0.00"]);
    expect(summarySub(container)).toBe("(1 unique)");
  });
});

// DISPOSITION (PORT, BL-111 F3): unaffected by BL-163 -- just the prop rename.
describe("InventorySummary view toggle (BL-111 F3, PORT)", () => {
  const card = makeCard({ base_card_id: 1 });

  it("renders no toggle and no actions slot when viewMode is omitted and there are no children", () => {
    const { container } = render(<InventorySummary filteredCards={[card]} />);
    expect(container.querySelector(".inv-summary__actions")).toBeNull();
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
  });

  it("renders Table/Gallery buttons ahead of children when viewMode/onViewModeChange are provided", () => {
    render(
      <InventorySummary filteredCards={[card]} viewMode="table" onViewModeChange={vi.fn()}>
        <button type="button">Add Cards</button>
      </InventorySummary>
    );
    const actions = document.querySelector(".inv-summary__actions")!;
    const buttons = Array.from(actions.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toEqual(["Table", "Gallery", "Add Cards"]);
  });

  it("marks the active button via aria-pressed, matching the viewMode prop", () => {
    render(
      <InventorySummary filteredCards={[card]} viewMode="gallery" onViewModeChange={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByRole("button", { name: "Gallery" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("clicking Gallery calls onViewModeChange('gallery')", () => {
    const onViewModeChange = vi.fn();
    render(
      <InventorySummary
        filteredCards={[card]}
        viewMode="table"
        onViewModeChange={onViewModeChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    expect(onViewModeChange).toHaveBeenCalledWith("gallery");
  });
});

// CREATE (BL-163): the scope toggle only renders when the caller says the
// list is narrowed, and only for authenticated callers.
describe("InventorySummary scope toggle visibility (BL-163, CREATE)", () => {
  const card = makeCard({ base_card_id: 1 });

  it("is hidden when isNarrowed is omitted/false", () => {
    const { container } = render(
      <InventorySummary filteredCards={[card]} allCards={[card]} baseSetCodes={SOR_SHD_CODES} />
    );
    expect(container.querySelector(".inv-summary__scope")).toBeNull();
  });

  it("renders, defaulting to Filtered, when isNarrowed is true and authenticated", () => {
    const { container } = render(
      <InventorySummary
        filteredCards={[card]}
        allCards={[card]}
        isNarrowed
        baseSetCodes={SOR_SHD_CODES}
      />
    );
    expect(container.querySelector(".inv-summary__scope")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtered" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("stays hidden when isNarrowed is true but the caller is anonymous (signed-out rule)", () => {
    const { container } = render(
      <InventorySummary
        filteredCards={[card]}
        allCards={[card]}
        isNarrowed
        baseSetCodes={SOR_SHD_CODES}
        isAuthenticated={false}
      />
    );
    expect(container.querySelector(".inv-summary__scope")).toBeNull();
  });
});

// CREATE (BL-163): switching Filtered/All actually swaps which card list the
// four metrics compute over.
describe("InventorySummary scope toggle switches the computed scope (BL-163, CREATE)", () => {
  it("computes over allCards once 'All' is clicked, and back over filteredCards on 'Filtered'", () => {
    const owned = makeCard({
      base_card_id: 1,
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });
    const unowned = makeCard({
      base_card_id: 2,
      variants: [makeVariant({ variant_id: 2, quantity: 0 })],
      inventory: { 2: 0 },
    });

    const { container } = render(
      <InventorySummary
        filteredCards={[owned]}
        allCards={[owned, unowned]}
        isNarrowed
        baseSetCodes={SOR_SHD_CODES}
      />
    );

    // Filtered (default): just the one owned card -> 100%/100%.
    expect(summaryValues(container)).toEqual(["100%", "100%", "3", "$0.00"]);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    // All: 2 cards, 1 complete -> 50%/50%, but the same 3 owned copies.
    expect(summaryValues(container)).toEqual(["50%", "50%", "3", "$0.00"]);

    fireEvent.click(screen.getByRole("button", { name: "Filtered" }));
    expect(summaryValues(container)).toEqual(["100%", "100%", "3", "$0.00"]);
  });
});

// CREATE (BL-163): a base card whose home set ISN'T one of the ten base
// sets (Definition §3's "orphan" case, e.g. Zam's root in C26) is excluded
// from both completion percentages but still counted in Cards and value.
describe("InventorySummary orphan base-card exclusion (BL-163, CREATE)", () => {
  it("excludes a non-base-set card from the two percentages but includes it in Cards/Value", () => {
    const baseSetCard = makeCard({
      base_card_id: 1,
      set_code: "SOR",
      variants: [makeVariant({ variant_id: 1, quantity: 3 })],
      inventory: { 1: 3 },
    });
    const orphan = makeCard({
      base_card_id: 2,
      set_code: "C26", // not in baseSetCodes -- the orphan case
      variants: [makeVariant({ variant_id: 2, source_set_code: "C26", quantity: 1 })],
      inventory: { 2: 1 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[baseSetCard, orphan]} baseSetCodes={new Set(["SOR"])} />
    );

    // Percentages ignore the orphan entirely: universe = 1 (just baseSetCard),
    // and it's playset-complete/owned -> 100%/100%.
    expect(summaryValues(container)[0]).toBe("100%");
    expect(summaryValues(container)[1]).toBe("100%");
    // Cards/unique DO include the orphan: 3 + 1 = 4 copies, 2 unique.
    expect(summaryValues(container)[2]).toBe("4");
    expect(summarySub(container)).toBe("(2 unique)");
  });
});

// CREATE (BL-163): Collection value's fallback chain -- a variant's own
// price, else the card's Standard-variant price, else $0 + unpriced.
describe("InventorySummary Collection value calc (BL-163, CREATE)", () => {
  it("prices an owned non-Standard variant from its own market price when it has one", () => {
    const card = makeCard({
      base_card_id: 1,
      variants: [
        makeVariant({ variant_id: 1, variant_type: "Standard", quantity: 0 }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          quantity: 2,
          price: { market: 5, low: 3, as_of: "2026-07-25" },
        }),
      ],
      inventory: { 1: 0, 2: 2 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[card]} baseSetCodes={SOR_SHD_CODES} />
    );

    expect(summaryValues(container)[3]).toBe("$10.00"); // 2 * $5
    expect(container.querySelector(".inv-summary__sub")?.textContent).not.toContain("unpriced");
  });

  it("falls back to the card's Standard-variant price when the owned variant itself is unpriced", () => {
    const card = makeCard({
      base_card_id: 1,
      variants: [
        makeVariant({
          variant_id: 1,
          variant_type: "Standard",
          quantity: 0,
          price: { market: 4, low: 2, as_of: "2026-07-25" },
        }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          quantity: 3,
          price: null,
        }),
      ],
      inventory: { 1: 0, 2: 3 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[card]} baseSetCodes={SOR_SHD_CODES} />
    );

    expect(summaryValues(container)[3]).toBe("$12.00"); // 3 * Standard's $4
  });

  it("contributes $0 and counts one unpriced owned variant when neither the variant nor Standard is priced", () => {
    const card = makeCard({
      base_card_id: 1,
      variants: [
        makeVariant({ variant_id: 1, variant_type: "Standard", quantity: 0, price: null }),
        makeVariant({
          variant_id: 2,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          quantity: 3,
          price: null,
        }),
      ],
      inventory: { 1: 0, 2: 3 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[card]} baseSetCodes={SOR_SHD_CODES} />
    );

    expect(summaryValues(container)[3]).toBe("$0.00");
    const subs = container.querySelectorAll(".inv-summary__sub");
    expect(subs[subs.length - 1].textContent).toBe("(1 unpriced)");
  });

  it("switches between market and low price on the Market/Low toggle", () => {
    const card = makeCard({
      base_card_id: 1,
      variants: [
        makeVariant({
          variant_id: 1,
          variant_type: "Standard",
          quantity: 1,
          price: { market: 10, low: 6, as_of: "2026-07-25" },
        }),
      ],
      inventory: { 1: 1 },
    });

    const { container } = render(
      <InventorySummary filteredCards={[card]} baseSetCodes={SOR_SHD_CODES} />
    );

    expect(summaryValues(container)[3]).toBe("$10.00");
    fireEvent.click(screen.getByRole("button", { name: "Low" }));
    expect(summaryValues(container)[3]).toBe("$6.00");
  });
});

// CREATE (BL-163): click-to-expand "«metric» by set" breakdown popovers.
describe("InventorySummary breakdown popovers (BL-163, CREATE)", () => {
  function twoSetCards(): InventoryCard[] {
    return [
      makeCard({
        base_card_id: 1,
        set_code: "SOR",
        variants: [makeVariant({ variant_id: 1, quantity: 3 })],
        inventory: { 1: 3 },
      }),
      makeCard({
        base_card_id: 2,
        set_code: "SHD",
        variants: [makeVariant({ variant_id: 2, source_set_code: "SHD", quantity: 0 })],
        inventory: { 2: 0 },
      }),
    ];
  }

  it("opens a per-set breakdown listing the base sets in the given order, with set logos", () => {
    const { container } = render(
      <InventorySummary
        filteredCards={twoSetCards()}
        baseSetCodes={SOR_SHD_CODES}
        orderedBaseSets={SOR_SHD_BASE_SETS}
      />
    );

    fireEvent.click(block(container, "playset"));

    expect(screen.getByText("Playset complete by set")).toBeInTheDocument();
    const rows = container.querySelectorAll(".inv-summary__popover-row");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector("img")!.getAttribute("src")).toBe("/images/set_SOR.png");
    expect(rows[1].querySelector("img")!.getAttribute("src")).toBe("/images/set_SHD.png");
    // SOR: 1/1 complete -> 100%; SHD: 0/1 complete -> 0%.
    expect(rows[0].textContent).toContain("100%");
    expect(rows[1].textContent).toContain("0%");
  });

  it("closes on an outside click", () => {
    const { container } = render(
      <InventorySummary
        filteredCards={twoSetCards()}
        baseSetCodes={SOR_SHD_CODES}
        orderedBaseSets={SOR_SHD_BASE_SETS}
      />
    );

    fireEvent.click(block(container, "cards"));
    expect(container.querySelector(".inv-summary__popover")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(container.querySelector(".inv-summary__popover")).toBeNull();
  });

  // Owner dev review 2026-07-26: the click-away boundary is the OPEN block's
  // wrap (block + its popover), not the whole summary strip -- a mousedown on
  // a sibling block (or anywhere else in the strip) closes the panel too.
  it("closes when clicking elsewhere in the strip, outside the open block", () => {
    const { container } = render(
      <InventorySummary
        filteredCards={twoSetCards()}
        baseSetCodes={SOR_SHD_CODES}
        orderedBaseSets={SOR_SHD_BASE_SETS}
      />
    );

    fireEvent.click(block(container, "cards"));
    expect(container.querySelector(".inv-summary__popover")).toBeTruthy();

    fireEvent.mouseDown(block(container, "playset"));
    expect(container.querySelector(".inv-summary__popover")).toBeNull();
  });

  it("shows the Cards row's total and unique-owned sub, right-aligned", () => {
    const { container } = render(
      <InventorySummary
        filteredCards={twoSetCards()}
        baseSetCodes={SOR_SHD_CODES}
        orderedBaseSets={SOR_SHD_BASE_SETS}
      />
    );

    fireEvent.click(block(container, "cards"));
    const rows = container.querySelectorAll(".inv-summary__popover-row");
    expect(rows[0].querySelector(".inv-summary__popover-right")!.textContent).toBe("3(1 unique)");
    expect(rows[1].querySelector(".inv-summary__popover-right")!.textContent).toBe("0(0 unique)");
  });

  it("renders the empty state when no base sets are known yet", () => {
    const { container } = render(
      <InventorySummary filteredCards={twoSetCards()} baseSetCodes={SOR_SHD_CODES} />
    );

    fireEvent.click(block(container, "value"));
    expect(screen.getByText("No base-set cards in scope")).toBeInTheDocument();
  });
});

// CREATE (BL-163): signed-out disables every block's click-to-expand and the
// scope toggle -- Definition §3's "popovers and scope toggle hidden/
// disabled" rule.
describe("InventorySummary signed-out disables popovers (BL-163, CREATE)", () => {
  it("renders blocks as non-interactive (no role=button, no chevron) and clicking does nothing", () => {
    const card = makeCard({ base_card_id: 1 });
    const { container } = render(
      <InventorySummary
        filteredCards={[card]}
        baseSetCodes={SOR_SHD_CODES}
        orderedBaseSets={SOR_SHD_BASE_SETS}
        isAuthenticated={false}
      />
    );

    const playsetBlock = block(container, "playset");
    expect(playsetBlock.getAttribute("role")).toBeNull();
    expect(container.querySelector(".inv-summary__chevron")).toBeNull();

    fireEvent.click(playsetBlock);
    expect(container.querySelector(".inv-summary__popover")).toBeNull();
  });
});

// CREATE (BL-179): the popover set rows double as a global home-base-set
// filter control, the strip grows an amber base-set readout row, and the
// scope toggle becomes three-way while selections exist ("Selected sets" =
// filteredCards, "Filtered" = breakdownCards, "All" = allCards).
describe("InventorySummary base-set selection control (BL-179, CREATE)", () => {
  const THREE_BASE_SETS: SetMeta[] = [
    { code: "SOR", name: "Spark of Rebellion" },
    { code: "SHD", name: "Shadows of the Galaxy" },
    { code: "TWI", name: "Twilight of the Republic" },
  ];
  const THREE_CODES = new Set(["SOR", "SHD", "TWI"]);

  const sorCard = makeCard({
    base_card_id: 1,
    set_code: "SOR",
    variants: [makeVariant({ variant_id: 1, quantity: 2 })],
    inventory: { 1: 2 },
  });
  const shdCard = makeCard({
    base_card_id: 2,
    set_code: "SHD",
    variants: [makeVariant({ variant_id: 2, source_set_code: "SHD", quantity: 3 })],
    inventory: { 2: 3 },
  });
  const sorCardB = makeCard({
    base_card_id: 3,
    set_code: "SOR",
    variants: [makeVariant({ variant_id: 3, quantity: 5 })],
    inventory: { 3: 5 },
  });
  // filteredCards ⊂ breakdownCards ⊂ allCards -- the three scope universes.
  const FILTERED = [sorCard];
  const BREAKDOWN = [sorCard, shdCard];
  const ALL = [sorCard, shdCard, sorCardB];

  function renderControl(overrides: Record<string, unknown> = {}) {
    const onToggleHomeSet = vi.fn();
    const onClearHomeSets = vi.fn();
    const utils = render(
      <InventorySummary
        filteredCards={FILTERED}
        breakdownCards={BREAKDOWN}
        allCards={ALL}
        isNarrowed
        baseSetCodes={THREE_CODES}
        orderedBaseSets={THREE_BASE_SETS}
        selectedHomeSets={new Set(["SOR"])}
        onToggleHomeSet={onToggleHomeSet}
        onClearHomeSets={onClearHomeSets}
        {...overrides}
      />
    );
    return { ...utils, onToggleHomeSet, onClearHomeSets };
  }

  function rows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll(".inv-summary__popover-row"));
  }

  it("popover rows are selectable and toggle the home-set selection by code", () => {
    const { container, onToggleHomeSet } = renderControl();
    fireEvent.click(block(container, "cards"));
    const [sor, shd] = rows(container);
    expect(sor.className).toContain("--selectable");
    expect(sor.className).toContain("--selected");
    expect(shd.className).toContain("--selectable");
    expect(shd.className).not.toContain("--selected");
    fireEvent.click(shd);
    expect(onToggleHomeSet).toHaveBeenCalledWith("SHD");
  });

  it("a zero-universe row is inert (no toggle call), but stays clickable while selected", () => {
    const { container, onToggleHomeSet } = renderControl();
    fireEvent.click(block(container, "cards"));
    const twi = rows(container)[2];
    expect(twi.className).toContain("--inert");
    fireEvent.click(twi);
    expect(onToggleHomeSet).not.toHaveBeenCalled();

    // Selected-but-empty: TWI has no cards in scope yet is selected -- the
    // deselect path must stay open or the selection would be stranded.
    const strandedToggle = vi.fn();
    const { container: c2 } = render(
      <InventorySummary
        filteredCards={[]}
        breakdownCards={BREAKDOWN}
        allCards={ALL}
        isNarrowed
        baseSetCodes={THREE_CODES}
        orderedBaseSets={THREE_BASE_SETS}
        selectedHomeSets={new Set(["TWI"])}
        onToggleHomeSet={strandedToggle}
      />
    );
    fireEvent.click(block(c2, "cards"));
    fireEvent.click(rows(c2)[2]);
    expect(strandedToggle).toHaveBeenCalledWith("TWI");
  });

  it("three-way scope: Selected sets / Filtered / All map to the three universes", () => {
    const { container } = renderControl();
    // Mounted WITH a selection already present: no transition has occurred,
    // so scope sits at its "filtered" default = breakdownCards (2+3 copies).
    expect(summaryValues(container)[2]).toBe("5");

    fireEvent.click(screen.getByRole("button", { name: "Selected sets" }));
    expect(summaryValues(container)[2]).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(summaryValues(container)[2]).toBe("10");

    // Popover rows ignore the base-set dimension under Selected sets (SHD
    // row still populated from breakdownCards), whole catalog under All.
    fireEvent.click(screen.getByRole("button", { name: "Selected sets" }));
    fireEvent.click(block(container, "cards"));
    const shdRow = rows(container)[1];
    expect(shdRow.querySelector(".inv-summary__popover-count")?.textContent).toBe("3");
  });

  it("selecting the first base set auto-jumps scope to Selected sets; clearing falls back to Filtered", () => {
    const props = {
      filteredCards: FILTERED,
      breakdownCards: BREAKDOWN,
      allCards: ALL,
      isNarrowed: true,
      baseSetCodes: THREE_CODES,
      orderedBaseSets: THREE_BASE_SETS,
      onToggleHomeSet: vi.fn(),
    };
    const { container, rerender } = render(
      <InventorySummary {...props} selectedHomeSets={new Set<string>()} />
    );
    // No selection: two-way toggle, no amber readout.
    expect(screen.queryByRole("button", { name: "Selected sets" })).toBeNull();
    expect(container.querySelector(".inv-summary__basesets")).toBeNull();

    rerender(<InventorySummary {...props} selectedHomeSets={new Set(["SOR", "SHD"])} />);
    const selectedBtn = screen.getByRole("button", { name: "Selected sets" });
    expect(selectedBtn.className).toContain("--active");
    expect(container.querySelector(".inv-summary__basesets-label")?.textContent).toBe(
      "Base sets: SOR · SHD"
    );

    rerender(<InventorySummary {...props} selectedHomeSets={new Set<string>()} />);
    expect(screen.queryByRole("button", { name: "Selected sets" })).toBeNull();
    expect(container.querySelector(".inv-summary__basesets")).toBeNull();
    expect(screen.getByRole("button", { name: "Filtered" }).className).toContain("--active");
  });

  it("the amber row's ✕ calls onClearHomeSets", () => {
    const { container, onClearHomeSets } = renderControl();
    fireEvent.click(container.querySelector(".inv-summary__basesets-clear") as HTMLElement);
    expect(onClearHomeSets).toHaveBeenCalledTimes(1);
  });

  it("popovers show the FilterPanel facet readout when filterSetCodes is set", () => {
    const { container } = renderControl({ filterSetCodes: ["SORP", "JTL"] });
    fireEvent.click(block(container, "cards"));
    expect(container.querySelector(".inv-summary__popover-filtersets")?.textContent).toBe(
      "Sets selected: SORP, JTL"
    );
  });
});
