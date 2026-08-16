import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CardsTable } from "./CardsTable";
import type { InventoryCard } from "../../utils/inventory";
import type { SortState } from "../../utils/cardSort";

// DISPOSITION (PORT, BL-56 Slice 3): ported from the retired
// screens/inventory/InventoryTable.test.tsx onto the unified CardsTable.
// Behavior (read-only owned-variant chips, name/inventory click handlers)
// is unchanged -- only the component under test and the added Variants
// column are new.

// DISPOSITION (PORT, BL-44 Slice C -- table virtualization): every test
// below renders 1-2 cards, well under a windowful (~28 rows at the
// estimated 34px row height against the 600px viewport mocked in
// src/test/setup.ts), so react-virtual renders every one of them -- the
// existing assertions (column order, chips, click handlers, tooltip)
// exercise identical DOM output before and after virtualization and are
// carried over unchanged. New below: an empty-state test (previously
// implicit/untested) and a windowing test proving a large list does NOT
// mount every row, using a card-count assertion rather than any
// react-virtual/jsdom-measurement internals -- see src/test/setup.ts for why
// the mocked offsetWidth/offsetHeight are what make this deterministic.

// DISPOSITION (BL-162, this change): CardsTable's `isAuthenticated` prop is
// new and required (CardsPage always has a real auth boolean to pass -- same
// precedent GalleryGrid's own required `isAuthenticated` prop set, see
// GalleryGrid.test.tsx's disposition note). Every pre-existing render() call
// below is mechanically given `isAuthenticated`, true unless a test is
// specifically about signed-out behavior -- none of the ported tests assert
// on Playset-cell chip/pips/dossier content that BL-162 changed, only on
// name/variants/stat-badge/aspect/virtualization behavior it didn't touch.
//
// DISPOSITION (RETIRE, BL-162): the standalone Inventory column (and its
// VariantInventory.tsx component) is designed away -- its job (owned-variant
// display + click-to-edit) moves into the merged Playset cell
// (PlaysetCell.tsx). "CardsTable read-only inventory display"'s two
// .variant-inv__chip / .td-inventory assertions and its .td-inventory
// click-wiring test are retired below; the click-wiring behavior itself is
// PORTed onto the new .td-playset cell (still authenticated-only), and new
// coverage for the merged cell's chip/pips/dossier/signed-out contract is
// added in dedicated describe blocks further down.

const SET_NAMES = { SOR: "Spark of Rebellion" };

const mockCard: InventoryCard = {
  base_card_id: 1,
  set_code: "SOR",
  base_card_number: "001",
  name: "Test Unit",
  subtitle: null,
  rarity: "C",
  type: "Unit",
  aspects: [],
  keywords: [],
  traits: ["Rebel"],
  cost: 3,
  power: 2,
  hp: 3,
  arena: "Ground",
  is_token: false,
  variants: [
    {
      variant_id: 101,
      variant_type: "Standard",
      finish: "Standard",
      channel: "Retail",
      source_set_code: "SOR",
      card_number: "001",
      front_image_url: null,
      back_image_url: null,
      quantity: 1,
    },
    {
      variant_id: 102,
      variant_type: "Foil",
      finish: "Standard Foil",
      channel: "Retail",
      source_set_code: "SOR",
      card_number: "001",
      front_image_url: null,
      back_image_url: null,
      quantity: 0,
    },
  ],
  inventory: { 101: 1, 102: 0 },
};

const zeroOwnedCard: InventoryCard = {
  ...mockCard,
  base_card_id: 2,
  base_card_number: "002",
  name: "Owns Nothing",
  variants: mockCard.variants.map((v) => ({ ...v, quantity: 0 })),
  inventory: { 101: 0, 102: 0 },
};

describe("CardsTable column order (BL-56 §5.5)", () => {
  // DISPOSITION (REPLACE, BL-162): "Inventory" dropped from the expected
  // header list -- 15 columns become 14 (see CardsTable.tsx's COLUMN_WIDTHS
  // doc comment).
  // DISPOSITION (REPLACE, BL-173): a new Value column lands between Playset
  // and Rarity -- 14 columns become 15. Header text-content assertions below
  // now include the Playset header's own scope-trigger text
  // and the Value header's "MKT"/"LOW" toggle text (unscoped defaults, no
  // `scope`/`priceKind` props passed) since `textContent` reads everything
  // inside the <th>, not just the static label.
  // DISPOSITION (REPLACE, BL-173 review round 2): controls now stack ABOVE
  // their labels (trigger before "Playset", toggle before "Unit Value" in
  // DOM order) and the Value column is renamed "Unit Value" -- the two
  // concatenated textContent expectations flip/rename accordingly.
  // DISPOSITION (REPLACE, owner request 2026-07-31, dialed across the local
  // round): the Value header is TWO rows -- the UNIT/TOTAL switch above
  // (active label only, inside the track), then a static "Value" label with
  // the MKT/LOW SWITCH (same idiom, small size) to its right. Default
  // textContent: UNIT MARKET Value.
  it("renders the exact spec column order", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "#",
      "Name",
      "Variants",
      "ALL FINISHESPlayset",
      "UNITMARKETValue",
      "Rarity",
      "Aspect",
      "Type",
      "Cost",
      "Power",
      "HP",
      "Trait",
      "Keyword",
      "Arena",
      "Set",
    ]);
  });
});

describe("CardsTable name cell", () => {
  it("clicking the card name calls onSelectCard with the base_card_id", () => {
    const onSelectCard = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={onSelectCard}
        onSelectInventory={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Test Unit" }));
    expect(onSelectCard).toHaveBeenCalledWith(1);
  });

  // DISPOSITION (CREATE, BL-132 J1): the whole Name <td> is now a click
  // target (matching the Playset cell's established click-to-edit pattern),
  // not just the inner .card-name-link button. Clicking the cell itself must
  // fire onSelectCard exactly once; clicking the inner button must ALSO fire
  // it exactly once, not twice -- the button's onClick calls
  // e.stopPropagation() specifically to stop its own click from also
  // bubbling into the cell's handler, so call-count (not just "was called")
  // is the assertion that actually guards the stopPropagation.
  it("clicking the td-name cell itself calls onSelectCard exactly once", () => {
    const onSelectCard = vi.fn();
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={onSelectCard}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-name")!;
    fireEvent.click(cell);
    expect(onSelectCard).toHaveBeenCalledTimes(1);
    expect(onSelectCard).toHaveBeenCalledWith(1);
  });

  it("clicking the inner name button calls onSelectCard exactly once (stopPropagation guards against the cell handler double-firing)", () => {
    const onSelectCard = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={onSelectCard}
        onSelectInventory={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Test Unit" }));
    expect(onSelectCard).toHaveBeenCalledTimes(1);
    expect(onSelectCard).toHaveBeenCalledWith(1);
  });
});

// DISPOSITION (BL-129 R2, PORT): the hover-target used to render the literal
// word "Variants"; it now renders the card's variant COUNT instead (the
// hover popup + border treatment are unchanged) -- queried by its
// aria-label (VariantsTooltip.tsx) now that the visible glyph is a bare
// number rather than a fixed word.
describe("CardsTable Variants column", () => {
  it("renders a variant-count control between Name and Playset", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const variantsBtn = screen.getByRole("button", { name: "2 variants" });
    expect(variantsBtn).toBeTruthy();
    expect(variantsBtn.textContent).toBe("2");

    fireEvent.mouseEnter(variantsBtn.parentElement!);
    const rows = document.querySelectorAll(".vt-popover__row");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe("Standard – 001 – Spark of Rebellion");
    expect(rows[1].textContent).toBe("Standard Foil – 001 – Spark of Rebellion");
  });
});

// CREATE (BL-161): the Rarity column now renders a symbol image + colored
// label (RarityBadge.tsx) instead of bare text. Component-level coverage
// (every rarity's color/asset, the no-meta fallback) lives in
// RarityBadge.test.tsx; this just proves the table wires the card's raw
// `rarity` value into the badge.
describe("CardsTable Rarity column (BL-161)", () => {
  it("renders the rarity symbol image and the spelled-out label", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const badge = container.querySelector(".rarity-badge")!;
    const icon = badge.querySelector(".rarity-badge__icon")!;
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
    const label = badge.querySelector(".rarity-badge__label")!;
    expect(label.textContent).toBe("Common");
    expect(label.className).toContain("rarity-badge__label--common");
  });
});

// DISPOSITION (CREATE, BL-111 F3): new contract from the design handoff §3
// -- Cost/Power/HP render through StatBadge (BL-111 F1) instead of plain
// numerals, and aspect icons grow from 16px to 22px to match. StatBadge's
// own geometry/gradient contract is covered exhaustively in
// StatBadge.test.tsx; this just proves the table wires the right `type`
// into each column (via the SVG's `data-testid`, StatBadge's own query
// hook) and sizes the aspect icons per spec.
describe("CardsTable stat badges + aspect icon sizing (BL-111 F3)", () => {
  it("renders a StatBadge for each of Cost/Power/HP, sized to match the aspect icons", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(container.querySelector('[data-testid="stat-badge-cost"]')).toHaveAttribute(
      "width",
      "22"
    );
    expect(container.querySelector('[data-testid="stat-badge-power"]')).toHaveAttribute(
      "width",
      "22"
    );
    expect(container.querySelector('[data-testid="stat-badge-hp"]')).toHaveAttribute("width", "22");
  });

  // DISPOSITION (REPLACE, BL-132 J2): the old assertion locked in a — numeral
  // badge for a null stat. J2 designs that away entirely -- a null stat now
  // renders NO badge in its cell (an empty <td>), while a non-null stat
  // (including the real value 0) still renders one.
  it("renders no StatBadge for a null stat, but still renders one for a present stat (incl. zero)", () => {
    const noCostCard: InventoryCard = { ...mockCard, base_card_id: 3, cost: null };
    const { container } = render(
      <CardsTable
        cards={[noCostCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(container.querySelector('[data-testid="stat-badge-cost"]')).toBeNull();
    // power/hp are still non-null on this fixture -- their badges persist.
    expect(container.querySelector('[data-testid="stat-badge-power"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="stat-badge-hp"]')).not.toBeNull();
  });

  it("still renders a StatBadge when the stat is zero (a real value, not absent)", () => {
    const zeroCostCard: InventoryCard = { ...mockCard, base_card_id: 5, cost: 0 };
    const { container } = render(
      <CardsTable
        cards={[zeroCostCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const badge = container.querySelector('[data-testid="stat-badge-cost"]')!;
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("aria-label", "Cost 0");
  });

  // REPLACE (owner dev review 2026-07-26 round 2): 22 -> 24px, the true
  // height match for the stat badges' rendered 23-24px at size 22.
  it("renders aspect icons at 24px (stat-badge height match)", () => {
    const aspectCard: InventoryCard = { ...mockCard, base_card_id: 4, aspects: ["Command"] };
    const { container } = render(
      <CardsTable
        cards={[aspectCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const icon = container.querySelector(".aspect-cell img")!;
    expect(icon).toHaveAttribute("width", "24");
  });

  // DISPOSITION (PORT w/ index fix, BL-162): the Cost/Power/HP <col> widths
  // stay equal (60 each, BL-129 R8's fix) -- only their <colgroup> INDEX
  // shifts, since the Inventory column ahead of them is gone (14 columns,
  // not 15). See CardsTable.tsx's COLUMN_WIDTHS doc comment.
  // DISPOSITION (PORT w/ index fix, BL-173): indices shift again -- the new
  // Value column (index 4) pushes Cost/Power/HP from [7,8,9] to [8,9,10].
  it("gives Cost/Power/HP equal <col> widths so their StatBadge gaps read as uniform", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cols = container.querySelectorAll("colgroup col");
    // Column order (CardsTable.tsx doc comment): # Name Variants Playset
    // Value Rarity Aspect Type Cost Power HP Trait Keyword Arena Set.
    const [costCol, powerCol, hpCol] = [cols[8], cols[9], cols[10]];
    const widthOf = (col: Element) => (col as HTMLElement).style.width;
    expect(widthOf(costCol)).toBe(widthOf(powerCol));
    expect(widthOf(powerCol)).toBe(widthOf(hpCol));
  });
});

// CREATE (BL-162): the merged Playset/Inventory cell -- pips + the
// always-on count chip, LEFT of the pips (owner-saved defaults). Semantics
// mirror GalleryGrid's console-plate coverage (same utils/inventory.ts
// completion functions), scoped to the table's own markup/classes
// (PlaysetCell.tsx, not GalleryCell).
describe("CardsTable Playset cell -- signed-in (BL-162)", () => {
  it("0 owned: chip shows 0 (always-on, not overflow-only), pips unfilled, not complete", () => {
    const { container } = render(
      <CardsTable
        cards={[zeroOwnedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelector(".playset--complete")).toBeNull();
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(0);
    const chip = cell.querySelector(".playset-chip")!;
    expect(chip.textContent).toBe("0");
    expect(chip.className).toContain("playset-chip--empty");
  });

  it("partial (owned < playset size): chip shows the raw count, some pips filled, not complete", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelector(".playset--complete")).toBeNull();
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(1);
    const chip = cell.querySelector(".playset-chip")!;
    expect(chip.textContent).toBe("1");
    expect(chip.className).not.toContain("playset-chip--empty");
    expect(chip.className).not.toContain("playset-chip--complete");
  });

  it("complete (owned >= playset size): all pips filled, chip marked complete", () => {
    const completeCard: InventoryCard = {
      ...mockCard,
      base_card_id: 6,
      variants: [
        { ...mockCard.variants[0], quantity: 3 },
        { ...mockCard.variants[1], quantity: 0 },
      ],
      inventory: { 101: 3, 102: 0 },
    };
    const { container } = render(
      <CardsTable
        cards={[completeCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelector(".playset--complete")).not.toBeNull();
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(3);
    const chip = cell.querySelector(".playset-chip")!;
    expect(chip.textContent).toBe("3");
    expect(chip.className).toContain("playset-chip--complete");
  });

  it("clicking the playset cell calls onSelectInventory with the base_card_id (ported from the retired Inventory cell)", () => {
    const onSelectInventory = vi.fn();
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={onSelectInventory}
      />
    );
    fireEvent.click(container.querySelector("td.td-playset")!);
    expect(onSelectInventory).toHaveBeenCalledWith(1);
  });

  it("has the click-to-edit affordance (clickable class + title) when signed in", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.className).toContain("td-playset--clickable");
    expect(cell).toHaveAttribute("title", "Edit inventory");
  });

  it("hover reveals a dossier listing owned finishes; mouse-leave hides it again", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    // PORT (owner dev review 2026-07-26 round 2): the dossier's hover target
    // is the count CHIP, not the whole cell (Variants-column behavior).
    const row = screen.getByText("Test Unit").closest("tr")!;
    const chip = row.querySelector(".playset-chip")!;
    fireEvent.mouseEnter(chip);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("OWNED");
    expect(tooltip.textContent).toContain("1/3");
    const rows = tooltip.querySelectorAll(".gallery-dossier__row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Standard");
    expect(rows[0].textContent).toContain("1");

    fireEvent.mouseLeave(chip);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("dossier empty state: 0 owned shows NO COPIES OWNED and no finish rows", () => {
    render(
      <CardsTable
        cards={[zeroOwnedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    // PORT (round 2): hover target is the chip -- see the test above.
    const row = screen.getByText("Owns Nothing").closest("tr")!;
    fireEvent.mouseEnter(row.querySelector(".playset-chip")!);

    const tooltip = screen.getByRole("tooltip");
    expect(screen.getByText("NO COPIES OWNED")).toBeTruthy();
    expect(tooltip.querySelectorAll(".gallery-dossier__row")).toHaveLength(0);
  });
});

// CREATE (BL-162, Definition_CosmeticsBatch_2026-07-26.md §2): signed-out
// contract for the merged cell -- em-dash in the chip slot, empty (unfilled)
// pips, and both the hover dossier and the click-to-edit affordance
// disabled entirely (no clickable class/title/onClick, hover produces no
// tooltip).
describe("CardsTable Playset cell -- signed-out (BL-162)", () => {
  it("shows an em-dash chip and empty pips instead of the owned count", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={false}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    const chip = cell.querySelector(".playset-chip")!;
    expect(chip.textContent).toBe("—");
    expect(chip.className).toContain("playset-chip--signed-out");
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(0);
    expect(cell.querySelector(".playset--complete")).toBeNull();
  });

  it("has no click-to-edit affordance (no clickable class, no title, click is a no-op)", () => {
    const onSelectInventory = vi.fn();
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={false}
        onSelectCard={vi.fn()}
        onSelectInventory={onSelectInventory}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.className).not.toContain("td-playset--clickable");
    expect(cell).not.toHaveAttribute("title");

    fireEvent.click(cell);
    expect(onSelectInventory).not.toHaveBeenCalled();
  });

  it("never shows a dossier on hover", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={false}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    fireEvent.mouseEnter(container.querySelector("td.td-playset")!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

// DISPOSITION (CREATE, BL-44 Slice C): the empty-state message previously
// had no direct test coverage (it was exercised only incidentally through
// CardsPage). Virtualization touches the render path enough (early return
// before the virtualizer's output is used) that it's worth a direct
// regression guard now.
describe("CardsTable empty state", () => {
  it("shows the placeholder message and renders no table when there are no cards", () => {
    const { container } = render(
      <CardsTable
        cards={[]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(screen.getByText("No cards match the current filters.")).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });
});

// DISPOSITION (CREATE, BL-44 Slice C): proves the actual point of this
// slice -- that a large list does not mount a row per card. Asserts on row
// *count* (fewer DOM rows than data length) rather than on any
// react-virtual/jsdom-measurement internals, so the test stays meaningful
// even if the estimated row height or overscan is tuned later.
describe("CardsTable virtualization (BL-44 Slice C)", () => {
  it("renders the header and a windowful of rows without mounting the full list", () => {
    const manyCards: InventoryCard[] = Array.from({ length: 200 }, (_, i) => ({
      ...mockCard,
      base_card_id: i + 1,
      base_card_number: String(i + 1).padStart(3, "0"),
      name: `Card ${i + 1}`,
    }));

    const { container } = render(
      <CardsTable
        cards={manyCards}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );

    // DISPOSITION (REPLACE, BL-162): 15 -> 14 columns (Inventory retired).
    // DISPOSITION (REPLACE, BL-173): 14 -> 15 columns (Value added).
    expect(screen.getAllByRole("columnheader")).toHaveLength(15);

    const renderedRows = container.querySelectorAll("tbody tr[data-index]");
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(manyCards.length);
  });

  it("keeps filtering (the already-computed card list) intact -- fewer cards in means fewer rows out", () => {
    const { container: fullContainer } = render(
      <CardsTable
        cards={[mockCard, zeroOwnedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(fullContainer.querySelectorAll("tbody tr[data-index]")).toHaveLength(2);

    const { container: narrowedContainer } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(narrowedContainer.querySelectorAll("tbody tr[data-index]")).toHaveLength(1);
  });
});

// CREATE (BL-173, Definition_VariantScope_2026-07-26.md): the Value column
// (between Playset and Rarity) -- unit-price display, Standard-default with
// min-priced fallback, em-dash for unpriced, Market/Low toggle, and the
// scoped-price override. cardValuePrice's own fallback/kind/null-vs-undefined
// rules are unit-tested directly in utils/variantScope.test.ts; these tests
// only prove the table wires that util correctly and renders its result.
describe("CardsTable Value column (BL-173, CREATE)", () => {
  const pricedCard: InventoryCard = {
    ...mockCard,
    base_card_id: 10,
    base_card_number: "010",
    name: "Priced Card",
    variants: [
      {
        ...mockCard.variants[0],
        variant_id: 201,
        variant_type: "Standard",
        finish: "Standard",
        quantity: 1,
        price: { market: 5, low: 4, as_of: "2026-07-26" },
      },
      {
        ...mockCard.variants[1],
        variant_id: 202,
        variant_type: "Hyperspace Foil",
        finish: "Hyperspace Foil",
        quantity: 0,
        price: { market: 55, low: 48, as_of: "2026-07-26" },
      },
    ],
    inventory: { 201: 1, 202: 0 },
  };

  function valueCell(container: HTMLElement): HTMLElement {
    return container.querySelector("td.td-value")!;
  }

  it("renders the Standard printing's market price by default (unscoped, Market default)", () => {
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(valueCell(container).textContent).toBe("$5.00");
    expect(valueCell(container).className).not.toContain("cell-muted");
    expect(valueCell(container).className).not.toContain("td-value--scoped");
  });

  it("renders an em-dash with the muted class for an unpriced card", () => {
    const unpriced: InventoryCard = { ...mockCard, base_card_id: 11, name: "Unpriced Card" };
    const { container } = render(
      <CardsTable
        cards={[unpriced]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(valueCell(container).textContent).toBe("—");
    expect(valueCell(container).className).toContain("cell-muted");
  });

  it("switches to the Low price when priceKind is 'low'", () => {
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        priceKind="low"
      />
    );
    expect(valueCell(container).textContent).toBe("$4.00");
  });

  // DISPOSITION (REPLACE, owner-dialed 2026-07-31): the MKT/LOW pill became
  // a single-label SWITCH -- one control that flips kinds per click.
  it("the MKT/LOW switch shows the active kind and each click flips it", () => {
    const onPriceKindChange = vi.fn();
    const { rerender } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onPriceKindChange={onPriceKindChange}
      />
    );
    const kindSwitch = () => screen.getByRole("switch", { name: /market price|low price/i });
    expect(kindSwitch().textContent).toBe("MARKET");
    fireEvent.click(kindSwitch());
    expect(onPriceKindChange).toHaveBeenCalledWith("low");
    rerender(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        priceKind="low"
        onPriceKindChange={onPriceKindChange}
      />
    );
    expect(kindSwitch().textContent).toBe("LOW");
    fireEvent.click(kindSwitch());
    expect(onPriceKindChange).toHaveBeenLastCalledWith("market");
  });

  // Owner request 2026-07-31: Collection display mode -- per-row owned-copies
  // value (utils/variantScope.ts cardCollectionValue; rule coverage lives
  // there, these prove the wiring + header behavior).
  it("collection mode renders qty x owned variants' own prices and the switch reads TOTAL", () => {
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        valueDisplay="collection"
      />
    );
    // 1 owned Standard @ $5 market; the unowned Hyperspace Foil contributes nothing.
    expect(valueCell(container).textContent).toBe("$5.00");
    expect(screen.getByRole("switch", { name: /total value/i }).textContent).toBe("COLLECTION");
  });

  it("collection mode renders the em-dash for an unowned card that has catalog prices", () => {
    const unowned: InventoryCard = {
      ...pricedCard,
      base_card_id: 12,
      name: "Unowned Priced Card",
      variants: pricedCard.variants.map((v) => ({ ...v, quantity: 0 })),
      inventory: { 201: 0, 202: 0 },
    };
    const { container } = render(
      <CardsTable
        cards={[unowned]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        valueDisplay="collection"
      />
    );
    expect(valueCell(container).textContent).toBe("—");
  });

  it("the UNIT/TOTAL switch shows only the active mode and each click flips it", () => {
    const onValueDisplayChange = vi.fn();
    const { rerender } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onValueDisplayChange={onValueDisplayChange}
      />
    );
    const sw = () => screen.getByRole("switch", { name: /unit value|total value/i });
    expect(sw().textContent).toBe("UNIT");
    expect(screen.queryByText("TOTAL")).toBeNull();
    fireEvent.click(sw());
    expect(onValueDisplayChange).toHaveBeenCalledWith("collection");
    rerender(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        valueDisplay="collection"
        onValueDisplayChange={onValueDisplayChange}
      />
    );
    expect(sw().textContent).toBe("COLLECTION");
    expect(screen.queryByText("UNIT")).toBeNull();
    fireEvent.click(sw());
    expect(onValueDisplayChange).toHaveBeenLastCalledWith("unit");
  });

  // DISPOSITION (REPLACE, owner-dialed 2026-07-31): aria-pressed on two
  // buttons becomes aria-checked on the single switch.
  it("reflects aria-checked for the active kind", () => {
    render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        priceKind="low"
      />
    );
    expect(screen.getByRole("switch", { name: /low price/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("scoped: shows the SCOPED variant's own price, not Standard's, with the scoped-column tint", () => {
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    expect(valueCell(container).textContent).toBe("$55.00");
    expect(valueCell(container).className).toContain("td-value--scoped");
  });

  it("scoped to a finish the card doesn't carry: em-dash (no fallback to Standard while scoped)", () => {
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Movie Promo"
      />
    );
    expect(valueCell(container).textContent).toBe("—");
  });
});

// CREATE (BL-173): the Playset header's scope trigger + option-set-C
// dropdown menu (VariantScopeControls.tsx). The menu portals to
// document.body (same FILTER_MENU_PORTAL_ATTR/outside-mousedown/Escape
// dismissal shape as FinishFilter.tsx), so queries below use `screen`
// (global) rather than `container`.
describe("CardsTable variant-scope control (BL-173, CREATE)", () => {
  function triggerBtn(): HTMLElement {
    return screen.getByTitle("Scope pips + Value to a single variant");
  }

  it("defaults to 'ALL FINISHES' when unscoped", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(triggerBtn().textContent).toContain("ALL FINISHES");
    expect(triggerBtn().className).not.toContain("vs-header-scope__trigger--on");
  });

  it("shows 'PIPS · <short name>' and the amber-on class when scoped", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    expect(triggerBtn().textContent).toContain("PIPS · HS Foil");
    expect(triggerBtn().className).toContain("vs-header-scope__trigger--on");
  });

  it("opens the menu on click and picking a pair row's Non-foil chip calls onScopeChange with the raw finish value", () => {
    const onScopeChange = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onScopeChange={onScopeChange}
      />
    );
    fireEvent.click(triggerBtn());

    const pairRows = document.querySelectorAll(".vs-scope-menu__row--chips");
    const standardRow = Array.from(pairRows).find(
      (r) => r.querySelector(".vs-scope-menu__row-label")?.textContent === "Standard"
    )!;
    fireEvent.click(within(standardRow as HTMLElement).getByText("Foil"));

    expect(onScopeChange).toHaveBeenCalledWith("Standard Foil");
    // Picking closes the menu -- the portal's listbox no longer renders.
    expect(document.querySelector(".vs-scope-menu")).toBeNull();
  });

  // REPLACE (round 4 owner revisions): the pinned plain row (Showcase) is
  // REMOVED from the picker and the "leaders · playset 1" notes are dropped;
  // Prestige moved up into the pinned rows as a chip group -- the pinned
  // pick path is now asserted through a Prestige chip.
  it("picking a pinned Prestige chip calls onScopeChange with its full raw value", () => {
    const onScopeChange = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onScopeChange={onScopeChange}
      />
    );
    fireEvent.click(triggerBtn());
    // Showcase is gone from the picker; no annotation text remains.
    expect(screen.queryByText("Showcase")).toBeNull();
    expect(screen.queryByText("leaders · playset 1")).toBeNull();
    fireEvent.click(screen.getByText("Serialized"));
    expect(onScopeChange).toHaveBeenCalledWith("Serialized Prestige");
  });

  // Round 4: language normalized -- "All variants" became "All finishes".
  it("clicking 'All finishes' while scoped clears the scope (calls onScopeChange with null)", () => {
    const onScopeChange = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Standard"
        onScopeChange={onScopeChange}
      />
    );
    fireEvent.click(triggerBtn());
    fireEvent.click(screen.getByText("All finishes"));
    expect(onScopeChange).toHaveBeenCalledWith(null);
  });

  it("'Show all finishes…' reveals the 4 extra plain rows (Prestige is pinned above the line); picking one scopes to it", () => {
    const onScopeChange = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onScopeChange={onScopeChange}
      />
    );
    fireEvent.click(triggerBtn());
    // Round 4: Prestige is a core (pinned) chip row, visible pre-expand.
    expect(screen.getByText("Prestige")).toBeTruthy();
    expect(screen.queryByText("Convention Exclusive")).toBeNull();

    fireEvent.click(screen.getByText("Show all finishes…"));
    expect(screen.getByText("Convention Exclusive")).toBeTruthy();

    fireEvent.click(screen.getByText("Convention Exclusive"));
    expect(onScopeChange).toHaveBeenCalledWith("Convention Exclusive");
  });

  // DISPOSITION (RETIRE, BL-173 review round 4): "shows the footer coverage
  // line" -- the menu's "Set C — 14 scopes / 99.0% of catalog" footer was
  // removed outright by owner call (the coverage stat was analysis-time
  // context, not user-facing value); the behavior is designed away, nothing
  // to port.

  it("Escape closes the open menu", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    fireEvent.click(triggerBtn());
    expect(document.querySelector(".vs-scope-menu")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".vs-scope-menu")).toBeNull();
  });

  it("clicking outside the menu closes it", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    fireEvent.click(triggerBtn());
    expect(document.querySelector(".vs-scope-menu")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector(".vs-scope-menu")).toBeNull();
  });
});

// CREATE (BL-173, mapping visuals) / REPLACE (review round 2): the amber
// bracket originally shipped as its own thead <tr> (3/2/10 colSpan split)
// plus an amber finish tag in the Value header. Round 2 owner calls: the
// bracket moves INSIDE the header row (`.vs-bracket--inhead` overlay
// anchored on the Playset th) and the Value-header tag is retired outright
// -- the colSpan/tag assertions are superseded by the overlay assertions
// below; the scoped-only + aria-hidden + label contracts carry over intact.
describe("CardsTable in-header bracket (BL-173, round 2)", () => {
  it("renders no bracket and no thead bracket row when unscoped", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(container.querySelector(".vs-bracket")).toBeNull();
    expect(container.querySelector(".vs-bracket-row")).toBeNull();
    expect(container.querySelector(".vs-tag")).toBeNull();
  });

  it("when scoped, renders the bracket INSIDE the Playset header cell (no separate row, no Value tag)", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    // Exactly one thead row -- the retired separate bracket row must not
    // come back.
    expect(container.querySelectorAll("thead tr")).toHaveLength(1);
    expect(container.querySelector(".vs-bracket-row")).toBeNull();

    const bracket = container.querySelector("th.th-playset .vs-bracket--inhead")!;
    expect(bracket).not.toBeNull();
    expect(bracket).toHaveAttribute("aria-hidden", "true");
    // Owner dev-review 2026-08-05 (REPLACE): the bracket now encompasses
    // the # column too, and its label names the affected columns.
    expect(bracket.querySelector(".vs-bracket__label")!.textContent!.trim()).toBe(
      "HS Foil - CARD # + PIPS + VALUE"
    );

    // Round 2: the Value header carries NO finish tag anymore.
    expect(container.querySelector(".vs-tag")).toBeNull();
  });

  // DISPOSITION (REPLACE, BL-194): the # header used to join the same
  // faint `.th-scoped` tint as Playset/Value (BL-187, "2 scoped th's became
  // 3"). The owner upgraded # to the STRONGER `.th-cardnum-scoped` treatment
  // instead (full scope-control active-state styling) -- Playset/Value keep
  // the original faint wash, so the th-scoped count reverts to 2 and # gets
  // its own dedicated class.
  it("gives Playset and Value headers the faint scoped tint class, and # the strong scoped-cardnum class", () => {
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Standard"
      />
    );
    expect(container.querySelectorAll("th.th-scoped")).toHaveLength(2);
    expect(container.querySelectorAll("th.th-cardnum-scoped")).toHaveLength(1);
  });

  // CREATE (BL-194): # is the ONLY header carrying the strong class; absent
  // entirely while unscoped.
  it("BL-194: the # th carries th-cardnum-scoped only while scoped, never th-scoped", () => {
    const { container, rerender } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Standard"
      />
    );
    const scopedHeader = container.querySelectorAll("thead th")[0];
    expect(scopedHeader.className).toContain("th-cardnum-scoped");
    expect(scopedHeader.className).not.toContain("th-scoped");

    rerender(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope={null}
      />
    );
    const unscopedHeader = container.querySelectorAll("thead th")[0];
    expect(unscopedHeader.className).toBe("");
  });
});

// CREATE (BL-187): the # column
// follows the active scope -- the scoped variant's own card_number when the
// card carries one, base_card_number otherwise. Matching rule is the same
// `(v.finish ?? v.variant_type) === scope` every scope helper in
// utils/variantScope.ts already uses.
describe("CardsTable # column -- scoped card number (BL-187, CREATE)", () => {
  const dualNumberCard: InventoryCard = {
    ...mockCard,
    base_card_id: 40,
    base_card_number: "019",
    name: "Dual Number Card",
    variants: [
      { ...mockCard.variants[0], variant_id: 701, card_number: "019" },
      {
        ...mockCard.variants[1],
        variant_id: 702,
        variant_type: "Hyperspace Foil",
        finish: "Hyperspace Foil",
        card_number: "508",
      },
    ],
  };

  function cardNumCell(container: HTMLElement): HTMLElement {
    return container.querySelector("td.td-cardnum")!;
  }

  it("unscoped: shows base_card_number, no scoped class", () => {
    const { container } = render(
      <CardsTable
        cards={[dualNumberCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(cardNumCell(container).textContent).toBe("019");
    expect(cardNumCell(container).className).not.toContain("td-cardnum--scoped");
  });

  it("scoped to a finish the card carries: shows THAT variant's own card_number, with the scoped class", () => {
    const { container } = render(
      <CardsTable
        cards={[dualNumberCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    expect(cardNumCell(container).textContent).toBe("508");
    expect(cardNumCell(container).className).toContain("td-cardnum--scoped");
  });

  it("scoped to a finish the card does NOT carry: falls back to base_card_number, no scoped class", () => {
    const { container } = render(
      <CardsTable
        cards={[dualNumberCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Movie Promo"
      />
    );
    expect(cardNumCell(container).textContent).toBe("019");
    expect(cardNumCell(container).className).not.toContain("td-cardnum--scoped");
  });
});

// CREATE (BL-173): scoped pips (PlaysetCell.tsx) -- fill from the SCOPED
// variant's own owned count, not the total; the count chip stays wired to
// the total/complete-green rule unchanged (Definition §1). Leader/Base
// playset-1 sizing is untouched by scope (getPlaysetSize) -- exercised
// directly below since it's the sharpest edge case for scoped-complete math.
describe("CardsTable Playset cell -- scoped pips (BL-173, CREATE)", () => {
  const scopedCard: InventoryCard = {
    ...mockCard,
    base_card_id: 20,
    base_card_number: "020",
    name: "Scoped Pips Card",
    type: "Unit",
    variants: [
      {
        ...mockCard.variants[0],
        variant_id: 301,
        variant_type: "Standard",
        finish: "Standard",
        quantity: 1,
      },
      {
        ...mockCard.variants[1],
        variant_id: 302,
        variant_type: "Hyperspace Foil",
        finish: "Hyperspace Foil",
        quantity: 2,
      },
    ],
    inventory: { 301: 1, 302: 2 },
  };

  it("fills pips from the scoped variant's own owned count (not the total)", () => {
    const { container } = render(
      <CardsTable
        cards={[scopedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    // Total owned across all variants is 3 (1 + 2) -- playset size 3 -- but
    // scoped to Hyperspace Foil the pips should fill only 2, not 3.
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(2);
    expect(cell.querySelectorAll(".playset__pip--scoped")).toHaveLength(2);
    // Round 4 owner revision: the plate appears ONLY at scoped-complete --
    // an incomplete scoped row (2/3 here) has NO plate; the cell itself
    // carries the faint amber wash instead.
    expect(cell.querySelector(".playset__pips--scoped-complete")).toBeNull();
    expect(cell.className).toContain("td-playset--scoped");
    // The count chip is UNCHANGED -- still the total (3), still green
    // (complete), regardless of scope.
    const chip = cell.querySelector(".playset-chip")!;
    expect(chip.textContent).toBe("3");
    expect(chip.className).toContain("playset-chip--complete");
  });

  // REPLACE (round 4 owner revision, final scheme): scoped-complete = GREEN
  // pips inside an AMBER-outlined plate; short of complete = amber pips, no
  // plate. The green fill is applied by CSS via the container's
  // --scoped-complete class, so at the class level filled pips carry
  // --scoped in both states -- these assertions are structural.
  it("at scoped-complete: pips keep the --scoped class and the plate renders (green fill via container CSS)", () => {
    const completeScoped: InventoryCard = {
      ...scopedCard,
      base_card_id: 21,
      variants: [
        { ...scopedCard.variants[0], quantity: 0 },
        { ...scopedCard.variants[1], quantity: 3 },
      ],
      inventory: { 301: 0, 302: 3 },
    };
    const { container } = render(
      <CardsTable
        cards={[completeScoped]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(3);
    expect(cell.querySelectorAll(".playset__pip--scoped")).toHaveLength(3);
    expect(cell.querySelector(".playset__pips--scoped-complete")).not.toBeNull();
  });

  it("leader/base playset-1: a single scoped copy fills the one pip and reads scoped-complete", () => {
    const leaderCard: InventoryCard = {
      ...scopedCard,
      base_card_id: 22,
      type: "Leader",
      variants: [
        { ...scopedCard.variants[0], variant_type: "Standard", finish: "Standard", quantity: 1 },
        // Round 4: Showcase left the picker's option set, so the leader
        // playset-1 case runs on a finish the picker actually offers.
        {
          ...scopedCard.variants[1],
          variant_type: "Prerelease Promo",
          finish: "Prerelease Promo",
          quantity: 1,
        },
      ],
      inventory: { 301: 1, 302: 1 },
    };
    const { container } = render(
      <CardsTable
        cards={[leaderCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Prerelease Promo"
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    // Playset SIZE stays 1 for a Leader regardless of scope.
    expect(cell.querySelectorAll(".playset__pip")).toHaveLength(1);
    // Round 4: amber fill + green-outlined completion plate.
    expect(cell.querySelectorAll(".playset__pip--scoped")).toHaveLength(1);
    expect(cell.querySelector(".playset__pips--scoped-complete")).not.toBeNull();
  });

  it("scoped to a finish the card owns none of: 0 filled pips even though the total is non-zero", () => {
    const { container } = render(
      <CardsTable
        cards={[scopedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Movie Promo"
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(0);
    // Round 4: no plate at 0 filled (plate = scoped-complete only); the
    // scope's presence shows via the cell's amber wash instead.
    expect(cell.querySelector(".playset__pips--scoped-complete")).toBeNull();
    expect(cell.className).toContain("td-playset--scoped");
  });

  it("unscoped rendering is completely unaffected -- no scoped classes at all", () => {
    const { container } = render(
      <CardsTable
        cards={[scopedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelectorAll(".playset__pip--scoped")).toHaveLength(0);
    expect(cell.querySelectorAll(".playset__pip--scoped-complete")).toHaveLength(0);
    expect(cell.querySelector(".playset__pips--scoped")).toBeNull();
    // Total fill (1 + 2 = 3) is the pre-existing unscoped behavior.
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(3);
  });

  it("scoped hover dossier: head label reads 'OWNED — ALL VARIANTS' and the scoped row is marked", () => {
    render(
      <CardsTable
        cards={[scopedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    const row = screen.getByText("Scoped Pips Card").closest("tr")!;
    fireEvent.mouseEnter(row.querySelector(".playset-chip")!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("OWNED — ALL VARIANTS");
    const scopedRow = tooltip.querySelector(".gallery-dossier__row--scoped")!;
    expect(scopedRow).not.toBeNull();
    expect(scopedRow.textContent).toContain("Hyperspace Foil");
    expect(scopedRow.textContent).toContain("◂ scope");
  });

  it("unscoped hover dossier still reads plain 'OWNED' (regression guard)", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    const row = screen.getByText("Test Unit").closest("tr")!;
    fireEvent.mouseEnter(row.querySelector(".playset-chip")!);
    expect(screen.getByRole("tooltip").textContent).toContain("OWNED");
    expect(screen.getByRole("tooltip").textContent).not.toContain("ALL VARIANTS");
  });
});

// CREATE (BL-173, Definition §1 "Anonymous"): scope + Value work signed-out
// (catalog + prices are public); pips keep their existing signed-out empty
// state regardless of scope.
describe("CardsTable Playset/Value -- anonymous with a scope active (BL-173, CREATE)", () => {
  const pricedCard: InventoryCard = {
    ...mockCard,
    base_card_id: 30,
    name: "Anon Priced Card",
    variants: [
      {
        ...mockCard.variants[0],
        variant_id: 401,
        variant_type: "Standard",
        finish: "Standard",
        quantity: 1,
        price: { market: 5, low: 4, as_of: "2026-07-26" },
      },
      {
        ...mockCard.variants[1],
        variant_id: 402,
        variant_type: "Hyperspace Foil",
        finish: "Hyperspace Foil",
        quantity: 3,
        price: { market: 55, low: 48, as_of: "2026-07-26" },
      },
    ],
    inventory: { 401: 0, 402: 0 },
  };

  it("Value column still resolves and the scope trigger still works when signed out", () => {
    const onScopeChange = vi.fn();
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={false}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
        onScopeChange={onScopeChange}
      />
    );
    expect(container.querySelector("td.td-value")!.textContent).toBe("$55.00");
    expect(container.querySelector(".vs-header-scope__trigger")!.textContent).toContain(
      "PIPS · HS Foil"
    );
  });

  it("pips stay in the signed-out empty state (no fill, no scoped amber) even while scoped", () => {
    const { container } = render(
      <CardsTable
        cards={[pricedCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={false}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        scope="Hyperspace Foil"
      />
    );
    const cell = container.querySelector("td.td-playset")!;
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(0);
    expect(cell.querySelector(".playset__pips--scoped")).toBeNull();
    expect(cell.querySelector(".playset-chip")!.textContent).toBe("—");
  });
});

// CREATE (BL-213, Issue #122): the sortable header affordances -- clicking a
// sortable header's label reports the column up via onSortChange,
// aria-sort reflects the active column/direction (and "none" for an
// inactive sortable one), and the five non-sortable columns (Aspect, Type,
// Trait, Keyword, Arena) carry no sort affordance at all. The comparator
// RULES themselves are covered exhaustively in utils/cardSort.test.ts --
// this file only proves CardsTable wires that module's SortState/
// onSortChange contract into the header DOM correctly, since sorting the
// actual row order is CardsPage's job (it calls sortCards before handing
// `cards` to this component), not CardsTable's.
describe("CardsTable sortable headers (BL-213, CREATE)", () => {
  // Exact string match (Testing Library's default for a plain-string `name`)
  // -- deliberately NOT a substring/regex match: the Playset header's
  // accessible name ("ALL FINISHESPlayset" unscoped) contains the substring
  // "set", which would ambiguously match a loose "Set" query too.
  function headerCell(name: string): HTMLElement {
    return screen.getByRole("columnheader", { name });
  }

  it("defaults to # ascending when no sortState prop is passed -- matches CardsPage's own default", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    expect(headerCell("#")).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("button", { name: "#" }).className).toContain("th-sort-btn--asc");
  });

  it("every OTHER sortable header reads aria-sort='none' while # is active", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    for (const name of ["Name", "Variants", "Rarity", "Cost", "Power", "HP", "Set"]) {
      expect(headerCell(name)).toHaveAttribute("aria-sort", "none");
    }
    // Playset/Value are compound headers (their own scope-trigger/toggle
    // buttons live alongside the sort button) -- queried directly by class
    // rather than by accessible name.
    expect(document.querySelector("th.th-playset")).toHaveAttribute("aria-sort", "none");
    expect(document.querySelector("th.th-value")).toHaveAttribute("aria-sort", "none");
  });

  it("the five non-sortable columns (Aspect, Type, Trait, Keyword, Arena) carry no aria-sort attribute and no button", () => {
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
      />
    );
    for (const name of ["Aspect", "Type", "Trait", "Keyword", "Arena"]) {
      const header = screen.getByRole("columnheader", { name });
      expect(header).not.toHaveAttribute("aria-sort");
      expect(within(header).queryByRole("button")).toBeNull();
    }
  });

  it("clicking a simple sortable header's label calls onSortChange with that column", () => {
    const onSortChange = vi.fn();
    render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onSortChange={onSortChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Rarity" }));
    expect(onSortChange).toHaveBeenCalledWith("rarity");
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(onSortChange).toHaveBeenCalledWith("cost");
  });

  it("reflects an active descending sort on the right header, and 'none' elsewhere", () => {
    const sortState: SortState = { column: "value", direction: "desc" };
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        sortState={sortState}
      />
    );
    expect(container.querySelector("th.th-value")).toHaveAttribute("aria-sort", "descending");
    expect(headerCell("#")).toHaveAttribute("aria-sort", "none");
  });

  it("clicking the Playset label's own sort button reports 'playset' without triggering the scope trigger's own click handler", () => {
    const onSortChange = vi.fn();
    const onScopeChange = vi.fn();
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onSortChange={onSortChange}
        onScopeChange={onScopeChange}
      />
    );
    fireEvent.click(container.querySelector(".th-playset-label")!);
    expect(onSortChange).toHaveBeenCalledWith("playset");
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it("clicking the Value label's own sort button reports 'value' without triggering the MKT/LOW or UNIT/COLLECTION switches", () => {
    const onSortChange = vi.fn();
    const onPriceKindChange = vi.fn();
    const onValueDisplayChange = vi.fn();
    const { container } = render(
      <CardsTable
        cards={[mockCard]}
        setNameByCode={SET_NAMES}
        isAuthenticated={true}
        onSelectCard={vi.fn()}
        onSelectInventory={vi.fn()}
        onSortChange={onSortChange}
        onPriceKindChange={onPriceKindChange}
        onValueDisplayChange={onValueDisplayChange}
      />
    );
    fireEvent.click(container.querySelector(".th-value-label")!);
    expect(onSortChange).toHaveBeenCalledWith("value");
    expect(onPriceKindChange).not.toHaveBeenCalled();
    expect(onValueDisplayChange).not.toHaveBeenCalled();
  });
});
