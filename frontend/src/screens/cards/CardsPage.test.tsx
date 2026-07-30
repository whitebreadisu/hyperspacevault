import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CardsPage } from "./CardsPage";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";

// DISPOSITION (BL-56 Slice 3): this suite REPLACEd the three-file test
// structure (components/CatalogPage.test.tsx, screens/inventory/InventoryPage.test.tsx,
// screens/inventory/InventoryTable.test.tsx -- InventoryTable's own coverage
// moved to CardsTable.test.tsx) with one suite against the unified CardsPage.
//
// DISPOSITION (PORT, BL-44 Slice C -- table virtualization): CardsTable's
// body now renders through @tanstack/react-virtual (windowed rows) instead
// of a plain .map(). Every fixture in this file is a handful of cards, well
// under a windowful, so react-virtual renders all of them and every
// existing assertion here (column order, filtering/summary math, popup
// wiring, anonymous inert-teaser behavior) exercises identical DOM output
// before and after virtualization -- ported unchanged. The
// filtering-narrows-the-list behavior this file already covers (the Set
// filter / incomplete-playsets tests below) is the "filtering still works"
// proof at the page level; a direct proof that a *large* list only mounts a
// windowful (not one row per card) lives in CardsTable.test.tsx, since that
// is where the virtualizer itself is wired in. See src/test/setup.ts for
// the jsdom offsetWidth/offsetHeight mock this relies on.
//
// DISPOSITION (BL-44 Slice B, this change): CardsPage's data path collapses
// from two fetches (getInventory for signed-in users, getCards +
// client-side grouping for anonymous ones) to one -- GET /api/base-cards
// (getBaseCardsList) for both auth states, per ADR-0005's payload-shrink.
// Every test that used to mock getInventory/getCards and assert on which one
// fired is REPLACEd below to mock getBaseCardsList instead and assert on
// the *data* each auth state receives (real quantities vs. zeros) rather
// than on which endpoint was called, since there is only one now. Tests
// about rendering, filtering, popups, and the inert-teaser controls are
// unaffected by the data-path change and are PORTed verbatim.

vi.mock("../../api/sets", () => ({
  getSets: vi.fn().mockResolvedValue([
    {
      id: 1,
      code: "SOR",
      name: "Spark of Rebellion",
      is_base_set: true,
      release_date: "2024-03-08",
    },
    {
      id: 2,
      code: "SHD",
      name: "Shadows of the Galaxy",
      is_base_set: true,
      release_date: "2024-08-02",
    },
  ]),
}));

const mockIncrementCard = vi.fn();
const mockDecrementCard = vi.fn();
const mockGetQuantities = vi.fn();
vi.mock("../../api/inventory", () => ({
  incrementCard: (variantId: number) => mockIncrementCard(variantId),
  decrementCard: (variantId: number) => mockDecrementCard(variantId),
  getQuantities: () => mockGetQuantities(),
}));

const mockGetBaseCardsList = vi.fn();
const mockGetBaseCardDetail = vi.fn();
// BL-140 design-conformance pass: CardPopup's compact history panel is now
// always mounted (embedded under the printings rail) once a printing is
// selected -- every test here that opens the popup now triggers this fetch
// too, not just BL-140's own pricing tests (which live in CardPopup.test.tsx
// and PriceHistoryPanel.test.tsx, not this page-level file). Defaults to an
// empty series; this file has no assertions about price history itself.
const mockGetPriceHistory = vi.fn();
mockGetPriceHistory.mockResolvedValue({ variant_id: 0, range: "90d", series: [] });
vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: () => mockGetBaseCardsList(),
  getBaseCardDetail: (id: number) => mockGetBaseCardDetail(id),
  getPriceHistory: (baseCardId: number, variantId: number, range: string) =>
    mockGetPriceHistory(baseCardId, variantId, range),
}));

// BL-101 catalog/quantity split: CardsPage now merges getBaseCardsList
// (catalog) with getQuantities (sparse per-tenant rows). The fixtures below
// still bake `quantity` into each variant (typed as the merged/detail
// shape), so rather than hand-maintaining a parallel quantities fixture per
// describe block, getQuantities defaults to deriving its rows from whatever
// getBaseCardsList last resolved -- exactly what the real backend pair
// returns for that catalog. Reads mock.results (not a fresh call) so tests
// asserting getBaseCardsList call counts are unaffected. Signed-out renders
// never call this (CardsPage skips the fetch), matching the real contract.
mockGetQuantities.mockImplementation(async () => {
  const results = mockGetBaseCardsList.mock.results;
  const lastList = results[results.length - 1];
  const cards: BaseCardDetail[] = lastList ? await lastList.value : [];
  return cards.flatMap((c) =>
    c.variants
      .filter((v) => v.quantity > 0)
      .map((v) => ({ variant_id: v.variant_id, quantity: v.quantity }))
  );
});

function makeVariant(overrides: Partial<VariantDetail> = {}): VariantDetail {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    source_set_code: "SOR",
    source_set_name: "Spark of Rebellion",
    card_number: "1",
    front_image_url: null,
    back_image_url: null,
    stamp_group: null,
    quantity: 0,
    ...overrides,
  };
}

function makeBaseCardDetail(overrides: Partial<BaseCardDetail> = {}): BaseCardDetail {
  return {
    id: 1,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    base_card_number: "1",
    name: "SOR Card One",
    subtitle: null,
    type: "Unit",
    type2: null,
    double_sided: false,
    rarity: "C",
    cost: 1,
    power: 1,
    hp: 1,
    arena: "Ground",
    is_unique: false,
    front_text: null,
    back_text: null,
    epic_action: null,
    artist: null,
    is_token: false,
    aspects: [],
    keywords: [],
    traits: [],
    variants: [makeVariant({ variant_id: 1, quantity: 3 })],
    ...overrides,
  };
}

// 4 unique base cards (one variant each): 2 in SOR (one playset-complete),
// 2 in SHD (one partially owned). This is the nested-list equivalent of the
// old flat 4-row mockInventory -- one base card per array entry instead of
// one variant row per entry, since the base-cards list endpoint is already
// grouped.
const mockBaseCards: BaseCardDetail[] = [
  makeBaseCardDetail({
    id: 1,
    set_code: "SOR",
    base_card_number: "1",
    name: "SOR Card One",
    variants: [
      makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "1", quantity: 3 }),
    ],
  }),
  makeBaseCardDetail({
    id: 2,
    set_code: "SOR",
    base_card_number: "2",
    name: "SOR Card Two",
    variants: [
      makeVariant({ variant_id: 2, source_set_code: "SOR", card_number: "2", quantity: 0 }),
    ],
  }),
  makeBaseCardDetail({
    id: 3,
    set_code: "SHD",
    set_name: "Shadows of the Galaxy",
    base_card_number: "1",
    name: "SHD Card One",
    variants: [
      makeVariant({ variant_id: 3, source_set_code: "SHD", card_number: "1", quantity: 1 }),
    ],
  }),
  makeBaseCardDetail({
    id: 4,
    set_code: "SHD",
    set_name: "Shadows of the Galaxy",
    base_card_number: "2",
    name: "SHD Card Two",
    variants: [
      makeVariant({ variant_id: 4, source_set_code: "SHD", card_number: "2", quantity: 0 }),
    ],
  }),
];

// BL-54 S3: `extra` carries the two new props (isEmailVerified/
// onOpenImportExport) as an options bag rather than positional params, so
// every pre-existing call site above (renderPage(), renderPage(false),
// renderPage(false, onRequestSignIn), renderPage(true, onRequestSignIn))
// keeps rendering CardsPage in its prior default state unchanged --
// isEmailVerified defaults through to CardsPage's own default (true).
async function renderPage(
  isAuthenticated = true,
  onRequestSignIn?: () => void,
  extra: { isEmailVerified?: boolean; onOpenImportExport?: () => void } = {}
) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <CardsPage
        isAuthenticated={isAuthenticated}
        onRequestSignIn={onRequestSignIn}
        isEmailVerified={extra.isEmailVerified}
        onOpenImportExport={extra.onOpenImportExport}
      />
    );
  });
  return utils;
}

function summaryValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".inv-summary__value")).map(
    (el) => el.textContent ?? ""
  );
}

function summarySub(container: HTMLElement): string {
  return container.querySelector(".inv-summary__sub")?.textContent ?? "";
}

// DISPOSITION (RETIRE, BL-111 F6): `expandFilters()` used to click the old
// top panel's collapsed-by-default header ("Filters" button) before every
// test that reached into its facet controls. The sidebar redesign (design
// handoff §6) starts OPEN by default (no persisted collapse state, matching
// the prototype), so there's nothing to expand -- every call site below had
// its `expandFilters()` call removed rather than ported; the facet
// interactions themselves are unchanged. (A literal port of this helper
// would also have become a landmine: with the sidebar open by default, its
// old `getByRole("button", { name: /filters/i })` query would resolve to
// "Reset All Filters" instead -- the header is a plain `<span>`, not a
// button, once the panel is already open.)

describe("CardsPage column order (BL-56 §5.5, CREATE)", () => {
  // DISPOSITION (REPLACE, BL-162): "Inventory" dropped -- the standalone
  // column is retired into the merged Playset cell (15 -> 14 columns).
  // DISPOSITION (REPLACE, BL-173): a new Value column lands between Playset
  // and Rarity (14 -> 15 columns). Header text-content includes the Playset
  // header's "ALL FINISHES" scope trigger and the Value header's "MKT"/"LOW"
  // toggle -- both render their unscoped/Market defaults on a fresh load
  // (CardsPage's own scope/priceKind state starts null/"market").
  it("renders the exact spec column order for the authenticated view", async () => {
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    await renderPage();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "#",
      "Name",
      "Variants",
      // BL-173 review round 2: controls stack ABOVE their labels (DOM order
      // flips in textContent) and Value is renamed "Unit Value". Round 4:
      // "ALL VARIANTS" language normalized to "ALL FINISHES".
      "ALL FINISHESPlayset",
      "MKTLOWUnit Value",
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

// DISPOSITION (PORT, from components/CatalogPage.test.tsx / FilterPanel.test.tsx's
// "CatalogPage integration test" block): behavior unchanged -- CardsPage is
// the FilterPanel host now instead of the retired CatalogPage.
describe("CardsPage FilterPanel integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue([]);
  });

  it("does not render old set-logo toggle buttons", async () => {
    const { container } = await renderPage();
    expect(container.querySelector(".set-filter-btn")).toBeNull();
  });

  it("does not render old aspect toggle buttons", async () => {
    const { container } = await renderPage();
    expect(container.querySelector(".aspect-filter-btn")).toBeNull();
  });

  it("renders the FilterPanel header", async () => {
    await renderPage();
    // BL-179 round 10 (owner): label renamed Filters -> Catalog Filters.
    expect(screen.getByText("Catalog Filters")).toBeTruthy();
  });
});

// DISPOSITION (PORT, from components/CatalogPage.test.tsx): the Variants
// tooltip behavior (sorted by own set then card number) is unchanged --
// only the data path (inventory vs. catalog, now unified) and column
// position moved. Fixture reshaped: the old test used 3 flat variant rows
// sharing one base_card_id; that's now naturally one base card entry with 3
// nested variants (the list endpoint groups this way already).
// DISPOSITION (BL-129 R2, PORT): the hover-target's visible text is now the
// variant COUNT rather than the literal word "Variants" -- queried by its
// aria-label (VariantsTooltip.tsx) instead; this fixture has 3 variants.
describe("CardsPage Variants tooltip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists each variant as finish – number – setName, sorted by own set then card number", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({
        id: 100,
        set_code: "SOR",
        variants: [
          makeVariant({
            variant_id: 1,
            finish: "Foil",
            card_number: "289",
            source_set_code: "SOR",
          }),
          makeVariant({
            variant_id: 2,
            finish: "Hyperspace",
            card_number: "475",
            source_set_code: "SOR",
          }),
          makeVariant({
            variant_id: 3,
            variant_type: "Weekly Play",
            finish: null,
            card_number: "2",
            source_set_code: "SHD",
          }),
        ],
      }),
    ]);

    await renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "3 variants" })).toBeTruthy());

    const variantsBtn = screen.getByRole("button", { name: "3 variants" });
    fireEvent.mouseEnter(variantsBtn.parentElement!);

    const rows = document.querySelectorAll(".vt-popover__row");
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toBe("Foil – 289 – Spark of Rebellion");
    expect(rows[1].textContent).toBe("Hyperspace – 475 – Spark of Rebellion");
    expect(rows[2].textContent).toBe("Weekly Play – 2 – Shadows of the Galaxy");
  });
});

// DISPOSITION (PORT, from screens/inventory/InventoryPage.test.tsx): summary
// math, filtering, and the incomplete-playsets toggle are unchanged.
describe("CardsPage summary stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  it("reflects combined totals across all sets before filtering", async () => {
    const { container } = await renderPage();
    expect(summaryValues(container)).toEqual(["25%", "50%", "4", "$0.00"]);
    expect(summarySub(container)).toBe("(2 unique)");
  });

  it("updates stats when the Set filter narrows to one set", async () => {
    const { container } = await renderPage();

    // BL-111 dev-review wave 1 fix 3: the Set field's label row is gone --
    // the trigger button's own accessible name now reads "Set — All sets".
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));

    expect(summaryValues(container)).toEqual(["50%", "50%", "3", "$0.00"]);
    expect(summarySub(container)).toBe("(1 unique)");
  });

  it('updates stats when "Show only incomplete playsets" is toggled on', async () => {
    const { container } = await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /show only incomplete playsets/i }));

    expect(summaryValues(container)).toEqual(["0%", "33%", "1", "$0.00"]);
    expect(summarySub(container)).toBe("(1 unique)");
  });

  // CREATE (BL-60): "Show only cards I own" narrows the 4-card fixture down
  // to the 2 base cards with any owned copies (id 1: qty 3, id 3: qty 1);
  // the other two (id 2, id 4) are owned-qty 0 and dropped. Of the 2
  // remaining, only id 1 (qty 3) is playset-complete -> 50%; both are
  // "owned" by definition of the filter -> 100% set-complete; 4 total cards
  // (3 + 1) across 2 unique base cards.
  it('updates stats when "Show only cards I own" is toggled on', async () => {
    const { container } = await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));

    expect(summaryValues(container)).toEqual(["50%", "100%", "4", "$0.00"]);
    expect(summarySub(container)).toBe("(2 unique)");
  });

  // CREATE (BL-115): "Only cards with no inventory" narrows the 4-card
  // fixture down to the 2 base cards with a zero owned total (id 2, id 4).
  // Neither is complete or owned by definition of the filter, so both
  // percentages read 0% (distinct from every other toggle's stats) and the
  // card count is 0.
  it('updates stats when "Only cards with no inventory" is toggled on', async () => {
    const { container } = await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /only cards with no inventory/i }));

    expect(summaryValues(container)).toEqual(["0%", "0%", "0", "$0.00"]);
    expect(summarySub(container)).toBe("(0 unique)");
  });
});

// CREATE (BL-91): the reset button lives inside FilterPanel and only ever
// touches FilterState (props: filters/setFilters); ownedOnly is CardsPage's
// own useState, entirely separate from FilterState (see FilterState in
// utils/filters.ts -- no owned/view-mode field on it). This suite proves
// that at the one place it's actually reachable: narrow both the FilterPanel
// (Set facet) and the ownedOnly toggle, reset, and confirm the Set facet
// clears while ownedOnly's effect on the summary survives untouched.
describe("CardsPage reset all filters (BL-91)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  function resetBtn(): HTMLElement {
    return screen.getByRole("button", { name: /reset all filters/i });
  }

  it("clears the Set facet but leaves the ownedOnly toggle (and its effect on the summary) untouched", async () => {
    const { container } = await renderPage();

    // ownedOnly on: matches the standalone "Show only cards I own" test's
    // expected summary (50%/100%/4, 2 unique) below.
    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));
    expect(summaryValues(container)).toEqual(["50%", "100%", "4", "$0.00"]);

    // Narrow further with a FilterPanel facet (Set = SOR only) -- combined
    // with ownedOnly this drops to just base card 1.
    // BL-111 dev-review wave 1 fix 3: the Set field's label row is gone --
    // the trigger button's own accessible name now reads "Set — All sets".
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));
    expect(summarySub(container)).toBe("(1 unique)");

    // DISPOSITION (REPLACE, BL-111 F6): the reset control is now the real
    // SWUButton (README §6), which flags inert state via `aria-disabled`
    // rather than the native `disabled` attribute -- see FilterPanel.test.tsx's
    // matching disposition comment for the full rationale.
    expect(resetBtn().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(resetBtn());

    // Set facet cleared -- the ownedOnly-only view reappears...
    expect(screen.getByRole("button", { name: "Set — All sets" })).toBeTruthy();
    expect(summaryValues(container)).toEqual(["50%", "100%", "4", "$0.00"]);
    expect(summarySub(container)).toBe("(2 unique)");
    // ...and the toggle itself is still pressed -- reset never touched it.
    expect(
      screen.getByRole("button", { name: /show only cards i own/i }).getAttribute("aria-pressed")
    ).toBe("true");
  });
});

// CREATE (BL-115): "Only cards with no inventory" -- the ownedOnly-toggle
// mutual exclusion is the design's one non-obvious rule (owner-approved,
// see the backlog entry and the CardsPage handlers' comments): checking one
// clears the other, since "owned total > 0" and "owned total === 0" can't
// both be true. incompleteOnly is deliberately left out of the exclusion --
// it's narrower than, not contradictory with, noInventoryOnly.
describe("CardsPage no-inventory filter mutual exclusion (BL-115, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  function ownedBtn(): HTMLElement {
    return screen.getByRole("button", { name: /show only cards i own/i });
  }
  function noInvBtn(): HTMLElement {
    return screen.getByRole("button", { name: /only cards with no inventory/i });
  }

  it("checking 'no inventory' clears an active 'show only cards I own'", async () => {
    await renderPage();

    fireEvent.click(ownedBtn());
    expect(ownedBtn().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(noInvBtn());
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("true");
    expect(ownedBtn().getAttribute("aria-pressed")).toBe("false");
  });

  it("checking 'show only cards I own' clears an active 'no inventory' (reverse direction)", async () => {
    await renderPage();

    fireEvent.click(noInvBtn());
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(ownedBtn());
    expect(ownedBtn().getAttribute("aria-pressed")).toBe("true");
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves 'show only incomplete playsets' untouched -- independent, not contradictory", async () => {
    await renderPage();
    const incompleteBtn = screen.getByRole("button", { name: /show only incomplete playsets/i });

    fireEvent.click(incompleteBtn);
    fireEvent.click(noInvBtn());

    expect(incompleteBtn.getAttribute("aria-pressed")).toBe("true");
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("true");
  });
});

// CREATE (BL-111 F6): the sidebar floats over the table rather than
// squeezing its layout width (design handoff §6 -- the wrapper is
// `position:relative; height:0`, so CardsTable/GalleryGrid are always full
// width in the DOM regardless of open/collapsed; see FilterPanel.css's
// `.ifp-sidebar-wrap` comment). This integration test is the CardsPage-level
// half of "filters still applied while collapsed": collapsing FilterPanel
// must not reset or bypass the FilterState it owns -- the table stays
// narrowed by whatever was set before collapsing.
describe("CardsPage FilterPanel collapsible sidebar (BL-111 F6, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  it("keeps an active Set filter narrowing the table after the sidebar is collapsed", async () => {
    const { container } = await renderPage();

    // BL-111 dev-review wave 1 fix 3: the Set field's label row is gone --
    // the trigger button's own accessible name now reads "Set — All sets".
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));
    expect(summarySub(container)).toBe("(1 unique)");

    fireEvent.click(screen.getByTitle("Collapse filters"));

    // The table's own DOM is unaffected by collapsing -- still rendered,
    // still narrowed to the same Set=SOR result.
    expect(container.querySelector("table")).toBeTruthy();
    expect(summarySub(container)).toBe("(1 unique)");

    fireEvent.click(screen.getByTitle("Expand filters"));
    // The Set field itself unmounts/remounts across collapse (the sidebar's
    // content is conditionally rendered, not just hidden), so its dropdown
    // reopens closed -- assert against the closed button's trigger text
    // rather than an open dropdown's option list. BL-111 dev-review wave 1
    // fix 3: the trigger now shows the raw selected value(s) ("Set — SOR"),
    // not the dropdown option's full "code — name" label.
    expect(screen.getByRole("button", { name: "Set — SOR" })).toBeTruthy();
    expect(summarySub(container)).toBe("(1 unique)");
  });
});

// DISPOSITION (PORT, from screens/inventory/InventoryPage.test.tsx; REPLACE
// per BL-111 F5): card-detail-on-name-click and inventory-on-cell-click both
// now open the SAME unified CardPopup (previously two distinct components,
// CardDetailPopup and CardInventoryPopup) -- popup wiring/re-fetch-on-change
// behavior itself is unchanged, just the target component. The re-fetch
// targets getBaseCardsList (unchanged from the BL-101 port note below).
describe("CardsPage popup wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    mockGetBaseCardDetail.mockResolvedValue(makeBaseCardDetail());
  });

  it("clicking a card name opens the unified card popup for that base card", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "SOR Card One" }));

    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  // DISPOSITION (PORT, BL-162): the standalone Inventory cell is retired --
  // its click-to-edit affordance moves to the merged Playset cell
  // (`.td-playset`, still authenticated-only). Behavior for a signed-in
  // click is unchanged.
  it("clicking the playset cell opens the same unified card popup for that base card", async () => {
    await renderPage();

    const row = screen.getByText("SOR Card Two").closest("tr")!;
    fireEvent.click(row.querySelector(".td-playset")!);

    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(2);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("re-fetches quantities (not the catalog) when the inventory popup reports a change and closes", async () => {
    // PORTED for BL-101: pre-split this asserted a full getBaseCardsList
    // re-fetch on popup change. The split's whole point is that inventory
    // mutations only invalidate the tiny per-tenant quantities -- the
    // catalog is immutable within a session -- so the assertion flips:
    // quantities re-fetch, catalog fetch count stays at 1.
    mockGetBaseCardDetail.mockResolvedValue(
      makeBaseCardDetail({
        variants: [makeVariant({ variant_id: 1, quantity: 0 })],
      })
    );
    mockIncrementCard.mockResolvedValue({
      variant_id: 1,
      quantity: 1,
      playset_complete: false,
      blocked: false,
      reason: null,
    });

    await renderPage();
    expect(mockGetBaseCardsList).toHaveBeenCalledTimes(1);
    expect(mockGetQuantities).toHaveBeenCalledTimes(1);

    const row = screen.getByText("SOR Card Two").closest("tr")!;
    fireEvent.click(row.querySelector(".td-playset")!);
    await act(async () => {});

    // Simulate the popup incrementing a variant (changed=true), then closing.
    const incButton = screen.getByRole("button", { name: /increment/i });
    fireEvent.click(incButton);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {});

    expect(mockGetQuantities).toHaveBeenCalledTimes(2);
    expect(mockGetBaseCardsList).toHaveBeenCalledTimes(1);
  });
});

// CREATE (BL-148): prev/next navigation through CardsPage's current
// filtered+sorted result list. mockBaseCards' sort order (SOR release date
// before SHD, ascending card_number within each set -- see catalog.ts's
// sortBaseCards) already matches the fixture's array order 1,2,3,4 ("SOR
// Card One", "SOR Card Two", "SHD Card One", "SHD Card Two"), so
// mockGetBaseCardDetail is stubbed to look each id up directly out of that
// same fixture rather than maintaining a parallel one.
describe("CardsPage popup navigation (BL-148, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    mockGetBaseCardDetail.mockImplementation(async (id: number) => {
      const found = mockBaseCards.find((c) => c.id === id);
      if (!found) throw new Error(`no fixture for base card ${id}`);
      return found;
    });
  });

  function navPrevBtn(): HTMLButtonElement {
    return screen.getByRole("button", { name: /previous card/i }) as HTMLButtonElement;
  }
  function navNextBtn(): HTMLButtonElement {
    return screen.getByRole("button", { name: /next card/i }) as HTMLButtonElement;
  }
  function dialogTitle(): string {
    return document.querySelector(".cp-title")?.textContent ?? "";
  }

  it("walks forward through the exact table order (1 -> 2 -> 3 -> 4), disabling prev at the start and next at the end", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "SOR Card One" }));
    await act(async () => {});
    expect(dialogTitle()).toBe("SOR Card One");
    expect(navPrevBtn().disabled).toBe(true);
    expect(navNextBtn().disabled).toBe(false);

    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(2);
    expect(dialogTitle()).toBe("SOR Card Two");
    expect(navPrevBtn().disabled).toBe(false);
    expect(navNextBtn().disabled).toBe(false);

    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(dialogTitle()).toBe("SHD Card One");

    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(4);
    expect(dialogTitle()).toBe("SHD Card Two");
    expect(navNextBtn().disabled).toBe(true);
    expect(navPrevBtn().disabled).toBe(false);
  });

  it("walks backward with the prev chevron, retracing the same order", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "SHD Card Two" }));
    await act(async () => {});
    expect(dialogTitle()).toBe("SHD Card Two");

    fireEvent.click(navPrevBtn());
    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(3);
    expect(dialogTitle()).toBe("SHD Card One");

    fireEvent.click(navPrevBtn());
    await act(async () => {});
    expect(dialogTitle()).toBe("SOR Card Two");
  });

  it("opening from the gallery grid gets the same navigation, in the same order", async () => {
    await renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Gallery" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "SOR Card One" }));
    await act(async () => {});
    expect(dialogTitle()).toBe("SOR Card One");
    expect(navPrevBtn().disabled).toBe(true);

    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(dialogTitle()).toBe("SOR Card Two");
  });

  it("the popup session's list is a snapshot taken at open time -- narrowing the filter afterward doesn't clip navigation to the new (smaller) filtered result", async () => {
    await renderPage();

    // Open on card 2 (SOR Card Two) -- captures the full 4-card order.
    fireEvent.click(screen.getByRole("button", { name: "SOR Card Two" }));
    await act(async () => {});
    expect(dialogTitle()).toBe("SOR Card Two");

    // Narrow to Set = SOR *while the popup is open* -- `filtered` now only
    // has 2 entries (cards 1 and 2), but the popup's own nav should still
    // be able to reach cards 3 and 4 from the snapshot taken before this
    // filter change, per the owner's explicit state model.
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));

    expect(navNextBtn().disabled).toBe(false);
    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(3);
    expect(dialogTitle()).toBe("SHD Card One");
  });

  it("renders no nav controls for a caller path that (hypothetically) never opened a popup -- baseline sanity, no dialog present", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: /previous card/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next card/i })).toBeNull();
  });

  it("closing and reopening the popup on a different card starts a fresh session (prev disabled again at that card's own start-of-list position)", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "SOR Card Two" }));
    await act(async () => {});
    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(dialogTitle()).toBe("SHD Card One");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {});

    // Reopen directly on the first card in the list -- a fresh session,
    // prev disabled again (not carrying over any state from the closed one).
    fireEvent.click(screen.getByRole("button", { name: "SOR Card One" }));
    await act(async () => {});
    expect(dialogTitle()).toBe("SOR Card One");
    expect(navPrevBtn().disabled).toBe(true);
  });
});

// DISPOSITION (BL-44 Slice B, REPLACE): this block used to guard "anonymous
// loads via getCards, never calls the auth-required getInventory" -- there
// is only one fetch now (getBaseCardsList), callable regardless of auth
// state, so that distinction no longer exists to test. What replaces it:
// both auth states call the *same* function, and the data each one receives
// differs only in the quantities the (mocked, here-simulated) backend
// returns -- real numbers when signed in, zeros when anonymous (the real
// optional-auth split lives server-side in get_optional_db, exercised by the
// backend test suite; this suite only proves CardsPage renders whatever
// getBaseCardsList resolves to, correctly, for either auth state).
describe("CardsPage anonymous data path (BL-56 §5.5 / BL-44 Slice B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads via the unified getBaseCardsList fetch when signed out", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({ id: 1, base_card_number: "1", name: "Anon Card One" }),
      makeBaseCardDetail({ id: 2, base_card_number: "2", name: "Anon Card Two" }),
    ]);

    await renderPage(false);

    expect(mockGetBaseCardsList).toHaveBeenCalledTimes(1);
    // BL-101: anonymous users have no quantities to fetch -- the split's
    // second call must be skipped entirely, not made-and-ignored.
    expect(mockGetQuantities).not.toHaveBeenCalled();
    expect(screen.getByText("Anon Card One")).toBeInTheDocument();
    expect(screen.getByText("Anon Card Two")).toBeInTheDocument();
  });

  it("both auth states fetch through the same getBaseCardsList call (no auth-conditional branching)", async () => {
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    await renderPage(true);
    expect(mockGetBaseCardsList).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);
    expect(mockGetBaseCardsList).toHaveBeenCalledTimes(1);
  });

  // DISPOSITION (BL-56 Slice 4, REPLACE): Slice 4 changes the anonymous
  // summary bar from computed zeroes ("0%"/"0") to em-dash placeholders
  // (§5.5 -- a real zero would misleadingly read as "you own nothing"
  // rather than "there is no inventory to summarize"). A quantity of 0 on
  // every variant is what the real optional-auth endpoint returns for an
  // anonymous caller; simulated here via the mock the same way.
  // DISPOSITION (REPLACE, BL-162): the standalone Inventory cell's em-dash
  // check moves to the merged Playset cell's chip (em-dash per Definition
  // §2's signed-out contract); pips render fully unfilled alongside it.
  it("renders the Playset cell's chip as an em-dash (unfilled pips) and an em-dash summary for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({
        id: 1,
        name: "Anon Card",
        variants: [makeVariant({ variant_id: 1, quantity: 0 })],
      }),
    ]);

    const { container } = await renderPage(false);

    const row = screen.getByText("Anon Card").closest("tr")!;
    const cell = row.querySelector(".td-playset")!;
    expect(cell.querySelector(".playset-chip")!.textContent).toBe("—");
    expect(cell.querySelectorAll(".playset__pip--filled")).toHaveLength(0);
    expect(summaryValues(container)).toEqual(["—", "—", "—", "—"]);
    expect(summarySub(container)).toBe("(— unique)");
  });

  it("does not error when anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  // DISPOSITION (BL-56 Slice 4, PORT): Add Cards routes straight to
  // onRequestSignIn for anonymous users (Slice 2/3 used to leave it a pure
  // no-op; Slice 4 wired the sign-in prompt). Unaffected by BL-162 -- see the
  // Playset-cell-specific tests around this one for that column's own
  // (now-disabled) anonymous behavior.
  it("routes Add Cards to onRequestSignIn for anonymous, without opening the real modal (Add Cards PORT)", async () => {
    mockGetBaseCardsList.mockResolvedValue([makeBaseCardDetail({ id: 1, name: "Anon Card" })]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: "Add Cards" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
  });

  // DISPOSITION (RETIRE, BL-162): the standalone Inventory cell's anonymous
  // "click opens the popup as its own sign-in nudge" behavior is designed
  // away -- Definition_CosmeticsBatch_2026-07-26.md §2 disables the merged
  // Playset cell's click-to-edit affordance entirely when signed out (no
  // redundant nudge path; editing requires auth). Replaced by the two tests
  // below: the Playset cell click is now a no-op for anonymous users, and
  // the Name cell (unaffected by BL-162) still reaches the same popup/nudge.
  it("does nothing when an anonymous user clicks the playset cell -- click-to-edit is disabled signed-out (BL-162 RETIRE+REPLACE)", async () => {
    mockGetBaseCardsList.mockResolvedValue([makeBaseCardDetail({ id: 1, name: "Anon Card" })]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    const row = screen.getByText("Anon Card").closest("tr")!;
    fireEvent.click(row.querySelector(".td-playset")!);
    await act(async () => {});

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRequestSignIn).not.toHaveBeenCalled();
  });

  it("the Name cell still opens the unified popup (with its sign-in nudge) for anonymous users -- unaffected by BL-162", async () => {
    mockGetBaseCardsList.mockResolvedValue([makeBaseCardDetail({ id: 1, name: "Anon Card" })]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: "Anon Card" }));
    await act(async () => {});

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(1);
    expect(onRequestSignIn).not.toHaveBeenCalled();
    // The popup's own plate is the nudge -- verified in CardPopup.test.tsx's
    // "CardPopup signed-out" suite; here we only assert the routing.
    expect(screen.getByText("Sign in to manage inventory")).toBeInTheDocument();
  });
});

// DISPOSITION (BL-56 Slice 4, CREATE): the inert-teaser polish itself --
// Add Cards and the toggle render visibly disabled for anonymous, and the
// "show only incomplete playsets" toggle also routes to the sign-in prompt
// (Add Cards and the inventory cell are covered above). Authenticated
// behavior is asserted unchanged as a regression guard.
describe("CardsPage anonymous inert-teaser controls (BL-56 §5.5, Slice 4, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Add Cards aria-disabled for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);
    expect(screen.getByRole("button", { name: "Add Cards" }).getAttribute("aria-disabled")).toBe(
      "true"
    );
  });

  it("does not mark Add Cards aria-disabled for authenticated (regression guard)", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(true);
    expect(
      screen.getByRole("button", { name: "Add Cards" }).getAttribute("aria-disabled")
    ).toBeNull();
  });

  it("renders the incomplete-playsets toggle aria-disabled and greyed for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);

    const toggle = screen.getByRole("button", { name: /show only incomplete playsets/i });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.className).toContain("pl-toggle--disabled");
  });

  it("clicking the incomplete-playsets toggle calls onRequestSignIn instead of toggling, for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({
        id: 1,
        name: "Anon Card",
        variants: [makeVariant({ variant_id: 1, quantity: 0 })],
      }),
    ]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /show only incomplete playsets/i }));

    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
    // Still renders the (unfiltered) card -- confirms the toggle did not flip.
    expect(screen.getByText("Anon Card")).toBeInTheDocument();
  });

  it("authenticated: the incomplete-playsets toggle still toggles filtering directly (regression guard)", async () => {
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    const onRequestSignIn = vi.fn();
    const { container } = await renderPage(true, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /show only incomplete playsets/i }));

    expect(onRequestSignIn).not.toHaveBeenCalled();
    expect(summaryValues(container)).toEqual(["0%", "33%", "1", "$0.00"]);
  });

  it("authenticated: Add Cards still opens the real AddCardsModal (regression guard)", async () => {
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    const onRequestSignIn = vi.fn();
    await renderPage(true, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: "Add Cards" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onRequestSignIn).not.toHaveBeenCalled();
  });

  // CREATE (BL-60): the "show only cards I own" toggle mirrors the
  // incomplete-playsets toggle above -- same aria-disabled/greyed treatment
  // and requestSignIn routing for anonymous users, same direct-toggle
  // behavior for authenticated users.
  it("renders the owned-only toggle aria-disabled and greyed for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);

    const toggle = screen.getByRole("button", { name: /show only cards i own/i });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.className).toContain("pl-toggle--disabled");
  });

  it("clicking the owned-only toggle calls onRequestSignIn instead of toggling, for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({
        id: 1,
        name: "Anon Card",
        variants: [makeVariant({ variant_id: 1, quantity: 0 })],
      }),
    ]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));

    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
    // Still renders the (unfiltered) card -- confirms the toggle did not flip.
    expect(screen.getByText("Anon Card")).toBeInTheDocument();
  });

  it("authenticated: the owned-only toggle still toggles filtering directly (regression guard)", async () => {
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    const onRequestSignIn = vi.fn();
    const { container } = await renderPage(true, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));

    expect(onRequestSignIn).not.toHaveBeenCalled();
    expect(summaryValues(container)).toEqual(["50%", "100%", "4", "$0.00"]);
  });

  // CREATE (BL-115): the no-inventory toggle mirrors ownedOnly/incompleteOnly
  // above -- same aria-disabled/greyed treatment and requestSignIn routing
  // for anonymous users (anonymous inventory is all-zero, so the filter
  // would be meaningless noise), same direct-toggle behavior for
  // authenticated users.
  it("renders the no-inventory toggle aria-disabled and greyed for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);

    const toggle = screen.getByRole("button", { name: /only cards with no inventory/i });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.className).toContain("pl-toggle--disabled");
  });

  it("clicking the no-inventory toggle calls onRequestSignIn instead of toggling, for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({
        id: 1,
        name: "Anon Card",
        variants: [makeVariant({ variant_id: 1, quantity: 0 })],
      }),
    ]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /only cards with no inventory/i }));

    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
    // Still renders the (unfiltered) card -- confirms the toggle did not flip.
    expect(screen.getByText("Anon Card")).toBeInTheDocument();
  });

  it("authenticated: the no-inventory toggle still toggles filtering directly (regression guard)", async () => {
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    const onRequestSignIn = vi.fn();
    const { container } = await renderPage(true, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /only cards with no inventory/i }));

    expect(onRequestSignIn).not.toHaveBeenCalled();
    expect(summaryValues(container)).toEqual(["0%", "0%", "0", "$0.00"]);
  });

  // CREATE (BL-60): the passive half of the layered nudge treatment -- a
  // quiet inline line near the toggles for anonymous users only.
  it("renders the log-in nudge line for anonymous users", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);

    expect(screen.getByText("Log in to track your collection")).toBeInTheDocument();
  });

  it("does not render the log-in nudge line for authenticated users (regression guard)", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(true);

    expect(screen.queryByText("Log in to track your collection")).not.toBeInTheDocument();
  });
});

// DISPOSITION (BL-54 S3, CREATE): the Import / Export entry button (§8.1
// P10) -- rendered for every auth state immediately right of Add Cards,
// with a three-way click routing the anonymous inert-teaser tests above
// only needed two states for (isAuthenticated true/false). The third state
// (signed in, unverified) has no existing mechanism to reuse -- it gets its
// own local nudge (a quiet inline message, same "click reveals feedback"
// shape as the anonymous route but pointing at the site-wide
// VerifyEmailBanner instead of opening AuthModal).
describe("CardsPage Import / Export button (BL-54 S3, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders immediately right of Add Cards", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    const { container } = await renderPage(true, undefined, { isEmailVerified: true });

    const actions = container.querySelector(".inv-summary__actions")!;
    const buttonLabels = Array.from(actions.querySelectorAll("button")).map((b) =>
      b.textContent?.trim()
    );
    const addIdx = buttonLabels.indexOf("Add Cards");
    const ieIdx = buttonLabels.indexOf("Import / Export");
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(ieIdx).toBe(addIdx + 1);
  });

  it("renders aria-disabled for anonymous and routes its click to onRequestSignIn (same mechanism as Add Cards)", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    const onRequestSignIn = vi.fn();
    const onOpenImportExport = vi.fn();
    await renderPage(false, onRequestSignIn, { onOpenImportExport });

    const btn = screen.getByRole("button", { name: "Import / Export" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(btn);
    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
    expect(onOpenImportExport).not.toHaveBeenCalled();
  });

  it("renders aria-disabled for a signed-in but unverified user and reveals a verify-email nudge on click, without opening AuthModal or the pane", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    const onRequestSignIn = vi.fn();
    const onOpenImportExport = vi.fn();
    await renderPage(true, onRequestSignIn, { isEmailVerified: false, onOpenImportExport });

    const btn = screen.getByRole("button", { name: "Import / Export" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();

    fireEvent.click(btn);

    expect(screen.getByText(/verify your email to import or export/i)).toBeInTheDocument();
    expect(onRequestSignIn).not.toHaveBeenCalled();
    expect(onOpenImportExport).not.toHaveBeenCalled();
  });

  it("is active (not aria-disabled) for a verified user and opens the pane via onOpenImportExport", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    const onRequestSignIn = vi.fn();
    const onOpenImportExport = vi.fn();
    await renderPage(true, onRequestSignIn, { isEmailVerified: true, onOpenImportExport });

    const btn = screen.getByRole("button", { name: "Import / Export" });
    expect(btn.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(btn);
    expect(onOpenImportExport).toHaveBeenCalledTimes(1);
    expect(onRequestSignIn).not.toHaveBeenCalled();
    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();
  });
});

// CREATE (BL-70): the critical dependency called out in the backlog entry --
// FilterPanel's facets must be computed over the toggle-narrowed base set
// (ownedOnly/incompleteOnly folded in), not the raw card list, or "show only
// cards I own" would narrow the table but leave stale dropdown options
// behind. This is the one facet rule that can't be exercised at the
// FilterPanel level alone, since ownedOnly lives here in CardsPage.
describe("CardsPage FilterPanel faceting (BL-70, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // One owned SOR card, one unowned SHD card -- toggling "Show only cards I
  // own" drops the SHD card entirely (not just its quantity), so the Set
  // dropdown's options should narrow from {SOR, SHD} to {SOR} only.
  const ownershipCards: BaseCardDetail[] = [
    makeBaseCardDetail({
      id: 10,
      set_code: "SOR",
      base_card_number: "10",
      name: "Owned SOR Card",
      variants: [makeVariant({ variant_id: 10, source_set_code: "SOR", quantity: 2 })],
    }),
    makeBaseCardDetail({
      id: 11,
      set_code: "SHD",
      set_name: "Shadows of the Galaxy",
      base_card_number: "11",
      name: "Unowned SHD Card",
      variants: [makeVariant({ variant_id: 11, source_set_code: "SHD", quantity: 0 })],
    }),
  ];

  it("narrows the Set filter's options when 'Show only cards I own' toggles on", async () => {
    mockGetBaseCardsList.mockResolvedValue(ownershipCards);
    await renderPage();

    // BL-111 dev-review wave 1 fix 3: the Set field's label row is gone --
    // the trigger button's own accessible name now reads "Set — All sets".
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);

    // Before the toggle: both sets have a card, so both are offered.
    expect(screen.getByRole("option", { name: "SOR — Spark of Rebellion" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "SHD — Shadows of the Galaxy" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));

    // After: the unowned SHD card is toggle-narrowed out before faceting
    // runs at all, so SHD is no longer an addable Set value.
    expect(screen.getByRole("option", { name: "SOR — Spark of Rebellion" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "SHD — Shadows of the Galaxy" })).toBeNull();
  });

  // CREATE (BL-115): mirror of the ownedOnly faceting test above, for its
  // inverse. Toggling "no inventory" on drops the owned SOR card (id 10)
  // before faceting runs, so the Set dropdown narrows from {SOR, SHD} down
  // to {SHD} only -- proving noInventoryOnly folds into toggleNarrowed the
  // same way ownedOnly/incompleteOnly already do.
  it("narrows the Set filter's options when 'Only cards with no inventory' toggles on", async () => {
    mockGetBaseCardsList.mockResolvedValue(ownershipCards);
    await renderPage();

    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);

    expect(screen.getByRole("option", { name: "SOR — Spark of Rebellion" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "SHD — Shadows of the Galaxy" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /only cards with no inventory/i }));

    expect(screen.queryByRole("option", { name: "SOR — Spark of Rebellion" })).toBeNull();
    expect(screen.getByRole("option", { name: "SHD — Shadows of the Galaxy" })).toBeTruthy();
  });
});

// CREATE (BL-73 Stage 1): the toggle itself is unit-tested in
// InventorySummary.test.tsx (button rendering, aria-pressed,
// onViewModeChange wiring); GalleryGrid.test.tsx separately proves
// gallery-internal behavior (ordering, placeholders, virtualization). This
// block is the integration proof that flipping viewMode in CardsPage
// actually swaps which component renders `filtered` -- same array, same
// filter/sort narrowing, same unified card popup open mechanism (BL-111 F5)
// as the table's name-click.
//
// DISPOSITION (PORT w/ query fix, BL-111 F3; UPDATE, BL-111 F6): from BL-111
// F3 through F5, CardsPage rendered *two* Table/Gallery toggles at once --
// FilterPanel's original (BL-73 Stage 1) plus InventorySummary's new one
// (design handoff §3), hence the `getAllByRole(...)[0]` helpers below. F6's
// sidebar redesign drops FilterPanel's copy entirely (design handoff §6:
// "view toggle NOT rendered here -- it moves to InventorySummaryRestyled"),
// so there is only one toggle again -- InventorySummary's. `[0]` still
// resolves correctly against a single match, so the helpers are left as-is
// rather than churned back to a plain `getByRole` for a diff that changes
// no behavior.
describe("CardsPage view mode (BL-73 Stage 1, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    mockGetBaseCardDetail.mockResolvedValue(makeBaseCardDetail());
  });

  function toggleToGallery() {
    fireEvent.click(screen.getAllByRole("button", { name: "Gallery" })[0]);
  }

  it("defaults to the table view", async () => {
    const { container } = await renderPage();
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector(".gallery-grid-wrapper")).toBeNull();
  });

  it("switches to the gallery grid (same filtered list, no table) when Gallery is clicked, and back to the table when Table is clicked", async () => {
    const { container } = await renderPage();

    toggleToGallery();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".gallery-grid-wrapper")).toBeTruthy();
    // Same 4-card fixture the table would have rendered -- gallery gets one
    // cell per card.
    expect(container.querySelectorAll(".gallery-cell")).toHaveLength(4);

    fireEvent.click(screen.getAllByRole("button", { name: "Table" })[0]);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector(".gallery-grid-wrapper")).toBeNull();
  });

  it("narrowing the Set filter narrows the gallery the same way it narrows the table", async () => {
    const { container } = await renderPage();
    toggleToGallery();
    expect(container.querySelectorAll(".gallery-cell")).toHaveLength(4);

    // BL-111 dev-review wave 1 fix 3: the Set field's label row is gone --
    // the trigger button's own accessible name now reads "Set — All sets".
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));

    // mockBaseCards has 2 SOR cards, 2 SHD cards -- narrowing to SOR halves
    // the gallery, exactly as it does the table's summary stats above.
    expect(container.querySelectorAll(".gallery-cell")).toHaveLength(2);
  });

  it("clicking a gallery cell opens the same unified card popup the table's name-click opens", async () => {
    await renderPage();
    toggleToGallery();

    const cell = screen.getByRole("button", { name: "SOR Card One" });
    fireEvent.click(cell);

    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("works for anonymous users (catalog data, no auth required)", async () => {
    const { container } = await renderPage(false);
    toggleToGallery();
    expect(container.querySelectorAll(".gallery-cell")).toHaveLength(4);
  });
});

// CREATE (BL-129 R2, docked filter sidebar): structural proof only -- the
// docked-vs-overlay choice itself is a pure CSS media query (FilterPanel.css)
// keyed on viewport width, which jsdom doesn't lay out, so there is no
// "mode" class/state to assert here (Jeremy verifies the visual behavior on
// dev). What IS asserted: the new `.cards-layout` wrapper actually contains
// both FilterPanel's sidebar wrapper and the `.cards-content` column (the
// summary + table), and the summary/table nesting inside `.cards-content`
// survived the CardsPage.tsx restructure unchanged, so the CSS in
// cards.css/FilterPanel.css has the DOM shape it depends on to center or
// dock the pair.
describe("CardsPage docked filter sidebar layout (BL-129 R2, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  it("wraps FilterPanel and the summary+table column together in .cards-layout", async () => {
    const { container } = await renderPage();

    const layout = container.querySelector(".cards-layout");
    expect(layout).toBeTruthy();

    const sidebarWrap = layout!.querySelector(".ifp-sidebar-wrap");
    const content = layout!.querySelector(".cards-content");
    expect(sidebarWrap).toBeTruthy();
    expect(content).toBeTruthy();
    // Sidebar wrap before content, matching the dock-to-the-left arrangement
    // cards.css's flex row assumes (see its .cards-layout comment).
    expect(
      sidebarWrap!.compareDocumentPosition(content!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps the summary bar and table nested inside .cards-content", async () => {
    const { container } = await renderPage();

    const content = container.querySelector(".cards-content");
    expect(content).toBeTruthy();
    expect(content!.querySelector(".inv-summary")).toBeTruthy();
    expect(content!.querySelector(".data-table-wrapper")).toBeTruthy();
  });
});

// CREATE (BL-173, Definition_VariantScope_2026-07-26.md §1): the page-level
// wiring between the header scope control and FilterState.finish -- pick
// replaces `finish`, clear empties it, and a direct FinishFilter-panel edit
// disengages an active scope ("scope drives filter, never vice versa").
// Component-level coverage of the control's own rendering/menu contents
// lives in CardsTable.test.tsx; this file only proves the CardsPage-owned
// state machine that connects it to the rest of the filtering pipeline.
describe("CardsPage variant scope (BL-173, CREATE)", () => {
  // PORT (round 4 owner revisions): Showcase left the picker's option set,
  // so these state-machine tests pick a Prestige chip instead --
  // "Serialized" is the one chip face that's unique across the whole menu,
  // keeping every pick a single unambiguous getByText.
  const scopeFixtureCards: BaseCardDetail[] = [
    makeBaseCardDetail({
      id: 50,
      set_code: "SOR",
      base_card_number: "50",
      name: "Has Serialized",
      variants: [
        makeVariant({
          variant_id: 501,
          variant_type: "Standard",
          finish: "Standard",
          source_set_code: "SOR",
          card_number: "50",
          quantity: 1,
        }),
        makeVariant({
          variant_id: 502,
          variant_type: "Serialized Prestige",
          finish: "Serialized Prestige",
          source_set_code: "SOR",
          card_number: "50p",
          quantity: 0,
        }),
      ],
    }),
    makeBaseCardDetail({
      id: 51,
      set_code: "SOR",
      base_card_number: "51",
      name: "Standard Only",
      variants: [
        makeVariant({
          variant_id: 511,
          variant_type: "Standard",
          finish: "Standard",
          source_set_code: "SOR",
          card_number: "51",
          quantity: 0,
        }),
      ],
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function scopeTriggerBtn(): HTMLElement {
    return screen.getByTitle("Scope pips + Value to a single variant");
  }

  it("picking a scope narrows the table exactly like the existing Finish filter would", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    await renderPage();
    expect(screen.getByText("Has Serialized")).toBeInTheDocument();
    expect(screen.getByText("Standard Only")).toBeInTheDocument();

    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));

    expect(screen.getByText("Has Serialized")).toBeInTheDocument();
    expect(screen.queryByText("Standard Only")).toBeNull();
    // Reflected on the Finish filter's own trigger too -- same FilterState.
    expect(screen.getByRole("button", { name: "Finish — Serialized Prestige" })).toBeTruthy();
    expect(scopeTriggerBtn().textContent).toContain("PIPS · Ser. Prestige");
  });

  it("clearing the scope via 'All finishes' clears the Finish filter back to unfiltered", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    await renderPage();
    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));
    expect(screen.queryByText("Standard Only")).toBeNull();

    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("All finishes"));

    expect(screen.getByText("Standard Only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish — All finishes" })).toBeTruthy();
    expect(scopeTriggerBtn().textContent).toContain("ALL FINISHES");
  });

  it("editing the Finish filter panel while scoped disengages the scope -- trigger reverts, the new (empty) selection stands", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    await renderPage();
    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));
    expect(scopeTriggerBtn().textContent).toContain("PIPS · Ser. Prestige");

    // Open the sidebar's own Finish dropdown (now showing the scope's
    // selection) and clear it directly, as if the user had never used the
    // scope control at all.
    fireEvent.click(screen.getByRole("button", { name: "Finish — Serialized Prestige" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(scopeTriggerBtn().textContent).toContain("ALL FINISHES");
    expect(screen.getByText("Standard Only")).toBeInTheDocument();
  });

  it("Reset All Filters also disengages an active scope", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    await renderPage();
    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));

    fireEvent.click(screen.getByRole("button", { name: /reset all filters/i }));

    expect(scopeTriggerBtn().textContent).toContain("ALL FINISHES");
  });

  it("changing an unrelated filter (Set) while scoped does NOT disengage the scope", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    await renderPage();
    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));

    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));

    expect(scopeTriggerBtn().textContent).toContain("PIPS · Ser. Prestige");
  });

  it("scope is transient -- a fresh mount always starts unscoped, even right after a previous mount had one active", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    const { unmount } = await renderPage();
    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));
    expect(scopeTriggerBtn().textContent).toContain("PIPS · Ser. Prestige");
    unmount();

    await renderPage();
    expect(scopeTriggerBtn().textContent).toContain("ALL FINISHES");
  });

  it("anonymous: scope still narrows the list (public catalog) and the Value column still renders", async () => {
    mockGetBaseCardsList.mockResolvedValue(scopeFixtureCards);
    await renderPage(false);

    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("Serialized"));

    expect(screen.getByText("Has Serialized")).toBeInTheDocument();
    expect(screen.queryByText("Standard Only")).toBeNull();
  });
});

// CREATE (BL-173): Market/Low price-kind persistence (localStorage,
// headerStarfield's pattern) -- Market default, a switch survives a remount.
describe("CardsPage Value price-kind persistence (BL-173, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to Market and persists a switch to Low across a remount", async () => {
    const { unmount } = await renderPage();
    expect(screen.getByTitle("Market price")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTitle("Low price"));
    expect(window.localStorage.getItem("swu.cardsValue.kind")).toBe("low");
    unmount();

    await renderPage();
    expect(screen.getByTitle("Low price")).toHaveAttribute("aria-pressed", "true");
  });

  it("degrades to Market for a corrupt stored value", async () => {
    window.localStorage.setItem("swu.cardsValue.kind", "bogus");
    await renderPage();
    expect(screen.getByTitle("Market price")).toHaveAttribute("aria-pressed", "true");
  });
});
