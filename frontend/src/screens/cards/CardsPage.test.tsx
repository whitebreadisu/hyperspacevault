import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CardsPage } from "./CardsPage";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import type { CapMode, LimitCell } from "../../api/settingsLimits";
import type { LimitsMatrix } from "../../utils/limits";
import { toMatrix } from "../../utils/limits";

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

// BL-205: the shared-vault read-only seam -- CardsPage's `shareToken` prop
// swaps the quantities fetch to this instead of getQuantities above. Kept
// as its own mock (not folded into the inventory mock) since it's a
// genuinely different module (api/sharedView.ts).
const mockGetSharedQuantities = vi.fn();
vi.mock("../../api/sharedView", () => ({
  getSharedQuantities: (token: string) => mockGetSharedQuantities(token),
}));

// BL-205: the owner-side ShareManageModal (opened from the new "Share"
// button below) calls listShares() on mount -- stubbed to an empty list by
// default so the modal renders its create-form empty state without an
// unmocked network call. ShareManageModal has its own dedicated test file
// for its actual create/rename/rotate/revoke behavior; this file only
// exercises the button's own routing (aria-disabled/requestSignIn/opens).
const mockListShares = vi.fn();
vi.mock("../../api/shares", () => ({
  listShares: () => mockListShares(),
}));
mockListShares.mockResolvedValue([]);

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

// BL-195: CardsPage now reads useLimits() (context/LimitsContext.tsx) so its
// scoped "incomplete playsets" predicate can call the same limits-aware
// scopedPlaysetComplete helper PlaysetCell's pips use. Mocked directly
// (same approach AddCardsModal.precon.test.tsx already uses for the same
// context) rather than wrapped in a real Provider -- CardsPage only ever
// destructures `limits` from it. Default mirrors the real DEFAULT_VALUE
// (LimitsContext.tsx) -- limits: null -- so every pre-existing test in this
// file (none of which cared about limits before BL-195) renders exactly as
// it did before this mock existed; only the dedicated custom-limit test
// below overrides it.
const { useLimitsMock } = vi.hoisted(() => ({
  useLimitsMock: vi.fn((): { limits: LimitsMatrix | null; capMode: CapMode } => ({
    limits: null,
    capMode: "hard",
  })),
}));
vi.mock("../../context/LimitsContext", () => ({
  useLimits: useLimitsMock,
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

// BL-205: renders CardsPage in read-only shared-vault mode -- isAuthenticated
// defaults false (the common "anonymous viewer" case §19.1 calls out
// explicitly), but is overridable for the "signed-in viewer browsing
// someone else's share" case.
async function renderShared(shareToken = "tok-1", isAuthenticated = false) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<CardsPage isAuthenticated={isAuthenticated} shareToken={shareToken} />);
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
      // DISPOSITION (REPLACE, owner request 2026-07-31, dialed): the Value
      // header is two rows -- the UNIT/TOTAL switch above, then a static
      // "Value" label with the MKT/LOW switch to its right.
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
    // BL-179 round 10 (owner): Filters -> Catalog Filters; owner dev-review
    // 2026-08-05: back to Filters.
    expect(screen.getByText("Filters")).toBeTruthy();
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

// CREATE (BL-91): originally proved reset touched ONLY FilterState, leaving
// the ownedOnly toggle untouched.
// DISPOSITION (REPLACE, BL-179 round 11, owner): that contract is designed
// away -- the Collection checkboxes are real applied filters now (they feed
// the rail badge and Reset's active state via externalActiveCount), and
// "Reset All Filters" clears EVERYTHING: FilterState, the checkboxes, and
// the base-set selection (onResetAll -> CardsPage's resetExternalFilters).
describe("CardsPage reset all filters (BL-91, replaced by BL-179 round 11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  function resetBtn(): HTMLElement {
    return screen.getByRole("button", { name: /reset all filters/i });
  }

  it("clears the Set facet AND the ownedOnly toggle back to the unfiltered view", async () => {
    const { container } = await renderPage();

    // Baseline (nothing filtered) for the final comparison.
    const baseline = summaryValues(container);
    const baselineSub = summarySub(container);

    // ownedOnly on: matches the standalone "Show only cards I own" test's
    // expected summary (50%/100%/4, 2 unique) below.
    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));
    expect(summaryValues(container)).toEqual(["50%", "100%", "4", "$0.00"]);

    // Narrow further with a FilterPanel facet (Set = SOR only) -- combined
    // with ownedOnly this drops to just base card 1.
    const setButton = screen.getByRole("button", { name: "Set — All sets" });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: "SOR — Spark of Rebellion" }));
    expect(summarySub(container)).toBe("(1 unique)");

    // SWUButton flags inert state via aria-disabled (BL-111 F6 disposition).
    expect(resetBtn().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(resetBtn());

    // EVERYTHING cleared: Set facet back to All sets, the toggle unpressed,
    // and the summary back at its unfiltered baseline.
    expect(screen.getByRole("button", { name: "Set — All sets" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /show only cards i own/i }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(summaryValues(container)).toEqual(baseline);
    expect(summarySub(container)).toBe(baselineSub);
  });

  it("the ownedOnly toggle alone activates Reset (external filters count)", async () => {
    await renderPage();
    expect(resetBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));
    expect(resetBtn().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(resetBtn());
    expect(resetBtn().getAttribute("aria-disabled")).toBe("true");
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

// CREATE (BL-217, Issue #126): "over my keep limit" -- the Vault filter
// surfacing cards where ANY variant's owned quantity exceeds its effective
// keep limit (utils/limits.ts's cardOverCap, unit-tested on its own in
// limits.test.ts). This describe block covers the CardsPage-level wiring:
// the toggle narrows the list the same way its siblings do, an explicit
// override AND a lowered-limit-stranding-existing-quantity both trigger it,
// a "No limit" bucket never qualifies, and its mutual exclusion with
// noInventoryOnly holds in both directions (over-cap implies owned).
describe("CardsPage over-cap filter (BL-217, CREATE)", () => {
  const overCapFixture: BaseCardDetail[] = [
    makeBaseCardDetail({
      id: 1,
      set_code: "SOR",
      base_card_number: "1",
      name: "Over Cap Card",
      type: "Unit",
      variants: [
        makeVariant({
          variant_id: 1,
          finish: "Standard",
          channel: "Retail",
          source_set_code: "SOR",
          card_number: "1",
          quantity: 3,
        }),
      ],
    }),
    makeBaseCardDetail({
      id: 2,
      set_code: "SOR",
      base_card_number: "2",
      name: "Within Cap Card",
      type: "Unit",
      variants: [
        makeVariant({
          variant_id: 2,
          finish: "Standard",
          channel: "Retail",
          source_set_code: "SOR",
          card_number: "2",
          quantity: 2,
        }),
      ],
    }),
    makeBaseCardDetail({
      id: 3,
      set_code: "SHD",
      set_name: "Shadows of the Galaxy",
      base_card_number: "1",
      name: "No Inventory Card",
      type: "Unit",
      variants: [
        makeVariant({
          variant_id: 3,
          finish: "Standard",
          channel: "Retail",
          source_set_code: "SHD",
          card_number: "1",
          quantity: 0,
        }),
      ],
    }),
  ];

  function overCapBtn(): HTMLElement {
    return screen.getByRole("button", { name: /over keep limit/i });
  }
  function noInvBtn(): HTMLElement {
    return screen.getByRole("button", { name: /only cards with no inventory/i });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
    mockGetBaseCardsList.mockResolvedValue(overCapFixture);
  });
  afterEach(() => {
    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
  });

  it("via an explicit override limit: narrows to only the card whose quantity exceeds the override", async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 2,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();

    fireEvent.click(overCapBtn());

    // Owned 3 > override limit 2 -- qualifies.
    expect(screen.getByText("Over Cap Card")).toBeInTheDocument();
    // Owned 2, at (not over) the override limit -- does not qualify.
    expect(screen.queryByText("Within Cap Card")).not.toBeInTheDocument();
    // Owned 0 -- does not qualify.
    expect(screen.queryByText("No Inventory Card")).not.toBeInTheDocument();
  });

  it("via a LOWERED limit stranding an existing quantity: a card fine under the code default becomes over-cap once the tenant dials the bucket down", async () => {
    // Baseline: code default (standard = 3) -- 3 owned copies are exactly at
    // the default, not over it, so the toggle finds nothing.
    const baseline = await renderPage();
    fireEvent.click(overCapBtn());
    expect(screen.queryByText("Over Cap Card")).not.toBeInTheDocument();
    // Unmount before re-rendering with a new limits matrix -- CardsPage
    // itself never re-fetches limits mid-session, so a fresh render is this
    // suite's stand-in for "the settings grid re-fetches after a save"
    // (LimitsProvider's own refresh mechanics are covered elsewhere).
    baseline.unmount();

    // The tenant lowers the Standard bucket to 1 -- the SAME 3 (and 2) owned
    // copies (nothing about the inventory changed) are now stranded over the
    // new limit.
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 1,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /over keep limit/i }));
    expect(screen.getByText("Over Cap Card")).toBeInTheDocument();
    // Within Cap Card (qty 2) is now also over the lowered limit of 1.
    expect(screen.getByText("Within Cap Card")).toBeInTheDocument();
  });

  it('a bucket set to "No limit" never qualifies, however large the owned quantity', async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: null,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();

    fireEvent.click(overCapBtn());

    expect(screen.queryByText("Over Cap Card")).not.toBeInTheDocument();
    expect(screen.queryByText("Within Cap Card")).not.toBeInTheDocument();
    expect(screen.queryByText("No Inventory Card")).not.toBeInTheDocument();
  });

  it("checking 'over keep limit' clears an active 'no inventory'", async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 2,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();

    fireEvent.click(noInvBtn());
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(overCapBtn());
    expect(overCapBtn().getAttribute("aria-pressed")).toBe("true");
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("false");
  });

  it("checking 'no inventory' clears an active 'over keep limit' (reverse direction)", async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 2,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();

    fireEvent.click(overCapBtn());
    expect(overCapBtn().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(noInvBtn());
    expect(noInvBtn().getAttribute("aria-pressed")).toBe("true");
    expect(overCapBtn().getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves 'show only cards I own' and 'show only incomplete playsets' untouched -- independent, not contradictory", async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 2,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();
    const ownedBtn = screen.getByRole("button", { name: /show only cards i own/i });
    const incompleteBtn = screen.getByRole("button", { name: /show only incomplete playsets/i });

    fireEvent.click(ownedBtn);
    fireEvent.click(incompleteBtn);
    fireEvent.click(overCapBtn());

    expect(ownedBtn.getAttribute("aria-pressed")).toBe("true");
    expect(incompleteBtn.getAttribute("aria-pressed")).toBe("true");
    expect(overCapBtn().getAttribute("aria-pressed")).toBe("true");
  });

  it("'over keep limit' alone activates Reset (external filters count), and Reset clears it", async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard",
          max_quantity: 2,
          is_default: false,
        } satisfies LimitCell,
      ]),
      capMode: "hard",
    });
    await renderPage();
    const resetBtn = () => screen.getByRole("button", { name: /reset all filters/i });

    expect(resetBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(overCapBtn());
    expect(resetBtn().getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(resetBtn());
    expect(resetBtn().getAttribute("aria-disabled")).toBe("true");
    expect(overCapBtn().getAttribute("aria-pressed")).toBe("false");
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

  // CREATE (BL-217, Issue #126): the over-cap toggle mirrors ownedOnly/
  // noInventoryOnly above -- same inert-teaser treatment for anonymous
  // users (spec point 4).
  it("renders the over-cap toggle aria-disabled and greyed for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(false);

    const toggle = screen.getByRole("button", { name: /over keep limit/i });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.className).toContain("pl-toggle--disabled");
  });

  it("clicking the over-cap toggle calls onRequestSignIn instead of toggling, for anonymous", async () => {
    mockGetBaseCardsList.mockResolvedValue([
      makeBaseCardDetail({
        id: 1,
        name: "Anon Card",
        variants: [makeVariant({ variant_id: 1, quantity: 0 })],
      }),
    ]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /over keep limit/i }));

    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
    // Still renders the (unfiltered) card -- confirms the toggle did not flip.
    expect(screen.getByText("Anon Card")).toBeInTheDocument();
  });

  it("authenticated: the over-cap toggle still toggles filtering directly (regression guard)", async () => {
    useLimitsMock.mockReturnValue({
      limits: toMatrix([
        { type_category: "standard", limit_bucket: "Standard", max_quantity: 2, is_default: false },
      ]),
      capMode: "hard",
    });
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    const onRequestSignIn = vi.fn();
    await renderPage(true, onRequestSignIn);

    fireEvent.click(screen.getByRole("button", { name: /over keep limit/i }));

    expect(onRequestSignIn).not.toHaveBeenCalled();
    // Only base card 1 (qty 3, Standard limit dialed to 2) qualifies --
    // 100% complete/owned across its 1 unique card, 3 copies total.
    expect(screen.getByText("SOR Card One")).toBeInTheDocument();
    expect(screen.queryByText("SHD Card One")).not.toBeInTheDocument();

    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
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

// CREATE (BL-205): the "Share" button -- same inert-teaser routing as Add
// Cards (anonymous -> requestSignIn, authenticated -> opens
// ShareManageModal), rendered for every auth state (unlike Import/Export,
// not gated on verified email -- see the button's own doc comment in
// CardsPage.tsx).
describe("CardsPage Share button (BL-205, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListShares.mockResolvedValue([]);
  });

  it("renders aria-disabled for anonymous and routes its click to onRequestSignIn", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    const onRequestSignIn = vi.fn();
    await renderPage(false, onRequestSignIn);

    const btn = screen.getByRole("button", { name: "Share" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(btn);
    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: /share your vault/i })).not.toBeInTheDocument();
  });

  it("is active for an authenticated user and opens the ShareManageModal", async () => {
    mockGetBaseCardsList.mockResolvedValue([]);
    await renderPage(true);

    const btn = screen.getByRole("button", { name: "Share" });
    expect(btn.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(await screen.findByRole("dialog", { name: /share your vault/i })).toBeInTheDocument();
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

  // CREATE (BL-187): engaging a
  // scope re-orders the table (and the # column) by the SCOPED variant's own
  // card_number -- mirrors the real early-set fact (base_card_number order
  // is the opposite of the Hyperspace printing's own numbering, see
  // analysis/Spike_CardNumber_Resolution_2026-07-16.md).
  const numberSortFixtureCards: BaseCardDetail[] = [
    makeBaseCardDetail({
      id: 60,
      set_code: "SOR",
      base_card_number: "1",
      name: "Card High HS Number",
      variants: [
        makeVariant({
          variant_id: 601,
          variant_type: "Standard",
          finish: "Standard",
          source_set_code: "SOR",
          card_number: "1",
          quantity: 0,
        }),
        makeVariant({
          variant_id: 602,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          source_set_code: "SOR",
          card_number: "508",
          quantity: 0,
        }),
      ],
    }),
    makeBaseCardDetail({
      id: 61,
      set_code: "SOR",
      base_card_number: "2",
      name: "Card Low HS Number",
      variants: [
        makeVariant({
          variant_id: 611,
          variant_type: "Standard",
          finish: "Standard",
          source_set_code: "SOR",
          card_number: "2",
          quantity: 0,
        }),
        makeVariant({
          variant_id: 612,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          source_set_code: "SOR",
          card_number: "019",
          quantity: 0,
        }),
      ],
    }),
  ];

  function nameOrder(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll(".card-name-link")).map((el) => el.textContent);
  }

  function pickHyperspaceNonFoil(): void {
    fireEvent.click(scopeTriggerBtn());
    const pairRows = document.querySelectorAll(".vs-scope-menu__row--chips");
    const hyperspaceRow = Array.from(pairRows).find(
      (r) => r.querySelector(".vs-scope-menu__row-label")?.textContent === "Hyperspace"
    )!;
    fireEvent.click(within(hyperspaceRow as HTMLElement).getByText("Non-foil"));
  }

  it("engaging a scope re-orders rows (and the # column) by the scoped variant's card_number; disengaging restores base order", async () => {
    mockGetBaseCardsList.mockResolvedValue(numberSortFixtureCards);
    const { container } = await renderPage();

    // Unscoped: base_card_number order (1, 2).
    expect(nameOrder(container)).toEqual(["Card High HS Number", "Card Low HS Number"]);

    pickHyperspaceNonFoil();

    // Scoped to Hyperspace: variant card_number order (019, 508) -- flips.
    expect(nameOrder(container)).toEqual(["Card Low HS Number", "Card High HS Number"]);
    const numberCells = Array.from(container.querySelectorAll("td.td-cardnum")).map(
      (el) => el.textContent
    );
    expect(numberCells).toEqual(["019", "508"]);

    // Disengage -- back to base_card_number order.
    fireEvent.click(scopeTriggerBtn());
    fireEvent.click(screen.getByText("All finishes"));
    expect(nameOrder(container)).toEqual(["Card High HS Number", "Card Low HS Number"]);
  });

  it("popup prev/next navigation follows the scoped order while a scope is active", async () => {
    mockGetBaseCardsList.mockResolvedValue(numberSortFixtureCards);
    mockGetBaseCardDetail.mockImplementation(async (id: number) => {
      const found = numberSortFixtureCards.find((c) => c.id === id);
      if (!found) throw new Error(`no fixture for base card ${id}`);
      return found;
    });
    await renderPage();

    pickHyperspaceNonFoil();

    function navNextBtn(): HTMLButtonElement {
      return screen.getByRole("button", { name: /next card/i }) as HTMLButtonElement;
    }
    function navPrevBtn(): HTMLButtonElement {
      return screen.getByRole("button", { name: /previous card/i }) as HTMLButtonElement;
    }
    function dialogTitle(): string {
      return document.querySelector(".cp-title")?.textContent ?? "";
    }

    // First in the SCOPED order is "Card Low HS Number" (019 before 508).
    fireEvent.click(screen.getByRole("button", { name: "Card Low HS Number" }));
    await act(async () => {});
    expect(dialogTitle()).toBe("Card Low HS Number");
    expect(navPrevBtn().disabled).toBe(true);

    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(60);
    expect(dialogTitle()).toBe("Card High HS Number");
    expect(navNextBtn().disabled).toBe(true);
  });

  // CREATE (BL-193): the popup's initial selection follows the active
  // scope, same fixture/helper as the reorder + nav tests above -- companion
  // to BL-187's scoped number/sort and BL-192's rail cycling.
  function activeRailTitle(): string | null {
    return document.querySelector(".cp-rail__item--active")?.getAttribute("title") ?? null;
  }

  it("BL-193: opening a card popup while scoped preselects the scoped variant; disengaged, it opens the Standard representative", async () => {
    mockGetBaseCardsList.mockResolvedValue(numberSortFixtureCards);
    mockGetBaseCardDetail.mockImplementation(async (id: number) => {
      const found = numberSortFixtureCards.find((c) => c.id === id);
      if (!found) throw new Error(`no fixture for base card ${id}`);
      return found;
    });
    await renderPage();

    // Unscoped: opens on the Standard representative, as always.
    fireEvent.click(screen.getByRole("button", { name: "Card High HS Number" }));
    await act(async () => {});
    expect(activeRailTitle()).toBe("Standard – #1 – SOR");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {});

    pickHyperspaceNonFoil();

    // Scoped: opens on the Hyperspace variant instead.
    fireEvent.click(screen.getByRole("button", { name: "Card Low HS Number" }));
    await act(async () => {});
    expect(activeRailTitle()).toBe("Hyperspace – #019 – SOR");
  });

  it("BL-193: with a scope active, arrowing to the next card lands on ITS scoped variant too", async () => {
    mockGetBaseCardsList.mockResolvedValue(numberSortFixtureCards);
    mockGetBaseCardDetail.mockImplementation(async (id: number) => {
      const found = numberSortFixtureCards.find((c) => c.id === id);
      if (!found) throw new Error(`no fixture for base card ${id}`);
      return found;
    });
    await renderPage();

    pickHyperspaceNonFoil();

    function navNextBtn(): HTMLButtonElement {
      return screen.getByRole("button", { name: /next card/i }) as HTMLButtonElement;
    }

    // Scoped order: "Card Low HS Number" (019) first, "Card High HS Number"
    // (508) next -- see the reorder test above.
    fireEvent.click(screen.getByRole("button", { name: "Card Low HS Number" }));
    await act(async () => {});
    expect(activeRailTitle()).toBe("Hyperspace – #019 – SOR");

    fireEvent.click(navNextBtn());
    await act(async () => {});
    expect(mockGetBaseCardDetail).toHaveBeenCalledWith(60);
    expect(activeRailTitle()).toBe("Hyperspace – #508 – SOR");
  });
});

// CREATE (BL-195, Issue #60): while a scope is active, the three collection
// filters (incompleteOnly/ownedOnly/noInventoryOnly) evaluate against the
// SCOPED finish instead of the card's total inventory -- CardsPage.tsx's
// toggleNarrowed. The owner's worked example: own 3 Standard copies, 0
// Hyperspace -- scoped to Hyperspace, "cards I don't own" INCLUDES the card
// (it owns none of THAT finish) even though it's far from empty-handed
// overall, and "cards I own" HIDES it for the same reason.
describe("CardsPage scoped collection filters (BL-195, CREATE)", () => {
  const vaderFixtureCards: BaseCardDetail[] = [
    makeBaseCardDetail({
      id: 80,
      set_code: "SOR",
      base_card_number: "80",
      name: "Vader Test Card",
      type: "Unit",
      variants: [
        makeVariant({
          variant_id: 801,
          variant_type: "Standard",
          finish: "Standard",
          source_set_code: "SOR",
          card_number: "80",
          quantity: 3,
        }),
        makeVariant({
          variant_id: 802,
          variant_type: "Hyperspace",
          finish: "Hyperspace",
          source_set_code: "SOR",
          card_number: "580",
          quantity: 0,
        }),
      ],
    }),
  ];

  function scopeTriggerBtn(): HTMLElement {
    return screen.getByTitle("Scope pips + Value to a single variant");
  }

  function pickHyperspaceNonFoil(): void {
    fireEvent.click(scopeTriggerBtn());
    const pairRows = document.querySelectorAll(".vs-scope-menu__row--chips");
    const hyperspaceRow = Array.from(pairRows).find(
      (r) => r.querySelector(".vs-scope-menu__row-label")?.textContent === "Hyperspace"
    )!;
    fireEvent.click(within(hyperspaceRow as HTMLElement).getByText("Non-foil"));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
    mockGetBaseCardsList.mockResolvedValue(vaderFixtureCards);
  });

  it("unscoped baseline: owned-only shows the card (3 Standard copies owned)", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));
    expect(screen.getByText("Vader Test Card")).toBeInTheDocument();
  });

  it("unscoped baseline: don't-own hides the card (3 Standard copies owned)", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /only cards with no inventory/i }));
    expect(screen.queryByText("Vader Test Card")).toBeNull();
  });

  it("scoped to Hyperspace: owned-only HIDES the card despite 3 owned Standard copies", async () => {
    await renderPage();
    pickHyperspaceNonFoil();

    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));
    expect(screen.queryByText("Vader Test Card")).toBeNull();
  });

  it("scoped to Hyperspace: don't-own INCLUDES the card despite 3 owned Standard copies (owner's worked example)", async () => {
    await renderPage();
    pickHyperspaceNonFoil();

    fireEvent.click(screen.getByRole("button", { name: /only cards with no inventory/i }));
    expect(screen.getByText("Vader Test Card")).toBeInTheDocument();
  });

  // BL-195 point 2: the three pl-toggle controls pick up the same amber
  // treatment as the scope control (BL-194's # th token family) while a
  // scope is active, regardless of their own on/off state.
  it("the three toggle buttons carry pl-toggle--scoped only while a scope is active", async () => {
    await renderPage();
    const incompleteBtn = screen.getByRole("button", { name: /show only incomplete playsets/i });
    const ownedBtn = screen.getByRole("button", { name: /show only cards i own/i });
    const noInvBtn = screen.getByRole("button", { name: /only cards with no inventory/i });
    expect(incompleteBtn.className).not.toContain("pl-toggle--scoped");
    expect(ownedBtn.className).not.toContain("pl-toggle--scoped");
    expect(noInvBtn.className).not.toContain("pl-toggle--scoped");

    pickHyperspaceNonFoil();

    expect(incompleteBtn.className).toContain("pl-toggle--scoped");
    expect(ownedBtn.className).toContain("pl-toggle--scoped");
    expect(noInvBtn.className).toContain("pl-toggle--scoped");
  });
});

// RETIRED (owner decision 2026-08-03, same session — never merged): an
// earlier build of BL-195 made scoped completeness keep-limit-aware and
// tested it here; the owner ruled "the playset complete flag only cares
// about playset — keep-limits should not come into play at all in the
// collection filters." The playset-size semantics are covered by the
// scopedPlaysetComplete unit describe (variantScope.test.ts) and the
// scoped-filter integration cases above; a keep-limit override changing
// NOTHING is the absence-of-behavior those cases already pin (the
// useLimitsMock default stays null throughout this file).
describe("CardsPage scoped incomplete-playsets filter ignores keep-limits (BL-195, CREATE)", () => {
  const scopedIncompleteFixture: BaseCardDetail[] = [
    makeBaseCardDetail({
      id: 90,
      set_code: "SOR",
      base_card_number: "90",
      name: "Scoped Incomplete Card",
      type: "Unit",
      variants: [
        makeVariant({
          variant_id: 901,
          variant_type: "Standard",
          finish: "Standard",
          source_set_code: "SOR",
          card_number: "90",
          quantity: 0,
        }),
        makeVariant({
          variant_id: 902,
          variant_type: "Hyperspace Foil",
          finish: "Hyperspace Foil",
          source_set_code: "SOR",
          card_number: "590",
          quantity: 2,
        }),
      ],
    }),
  ];

  function scopeTriggerBtn(): HTMLElement {
    return screen.getByTitle("Scope pips + Value to a single variant");
  }

  function pickHyperspaceFoil(): void {
    fireEvent.click(scopeTriggerBtn());
    const pairRows = document.querySelectorAll(".vs-scope-menu__row--chips");
    const hyperspaceRow = Array.from(pairRows).find(
      (r) => r.querySelector(".vs-scope-menu__row-label")?.textContent === "Hyperspace"
    )!;
    fireEvent.click(within(hyperspaceRow as HTMLElement).getByText("Foil"));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(scopedIncompleteFixture);
  });

  it("2/3 of the scoped finish reads incomplete while scoped (playset size, not any cap)", async () => {
    await renderPage();
    pickHyperspaceFoil();

    fireEvent.click(screen.getByRole("button", { name: /show only incomplete playsets/i }));
    expect(screen.getByText("Scoped Incomplete Card")).toBeInTheDocument();
  });

  it("a configured keep-limit of 2 changes nothing: 2/3 scoped copies still read incomplete", async () => {
    const limits = toMatrix([
      {
        type_category: "standard",
        limit_bucket: "Hyperspace Foil",
        max_quantity: 2,
        is_default: false,
      } satisfies LimitCell,
    ]);
    useLimitsMock.mockReturnValue({ limits, capMode: "hard" });
    await renderPage();
    pickHyperspaceFoil();

    fireEvent.click(screen.getByRole("button", { name: /show only incomplete playsets/i }));
    expect(screen.getByText("Scoped Incomplete Card")).toBeInTheDocument();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
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

  // DISPOSITION (REPLACE, owner-dialed 2026-07-31): the MKT/LOW pill became
  // a single-label switch -- assertions move from per-button aria-pressed
  // to the switch's visible label + aria-checked.
  it("defaults to Market and persists a switch to Low across a remount", async () => {
    // Two Market/Low switches render on the page (completion panel + table
    // header, owner-dialed 2026-07-31); this test targets the TABLE header's
    // (the one CardsPage's priceKind state drives) via its thead scope.
    const kindSwitch = () =>
      within(document.querySelector(".data-table--cards thead") as HTMLElement).getByRole(
        "switch",
        { name: /market price|low price/i }
      );
    const { unmount } = await renderPage();
    expect(kindSwitch().textContent).toBe("MARKET");

    fireEvent.click(kindSwitch());
    expect(window.localStorage.getItem("swu.cardsValue.kind")).toBe("low");
    unmount();

    await renderPage();
    expect(kindSwitch().textContent).toBe("LOW");
    expect(kindSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("degrades to Market for a corrupt stored value", async () => {
    window.localStorage.setItem("swu.cardsValue.kind", "bogus");
    await renderPage();
    expect(
      within(document.querySelector(".data-table--cards thead") as HTMLElement).getByRole(
        "switch",
        { name: /market price/i }
      ).textContent
    ).toBe("MARKET");
  });
});

// CREATE (BL-179 round 11, owner follow-up): the rail badge's external
// count through the REAL CardsPage wiring -- checkboxes one each, the
// whole base-set selection one unit -- not just FilterPanel's injected
// number.
describe("CardsPage external filters feed the rail badge (BL-179 r11, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
  });

  it("counts checkboxes individually and the base-set selection as one unit", async () => {
    const { container } = await renderPage();

    // Two compatible checkboxes (ownedOnly excludes noInventoryOnly, so use
    // incompleteOnly + ownedOnly).
    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));
    fireEvent.click(screen.getByRole("button", { name: /incomplete playsets/i }));

    // One base set selected via a completion popover row.
    fireEvent.click(
      container.querySelector('[data-testid="inv-summary-block-cards"]') as HTMLElement
    );
    fireEvent.click(
      container.querySelector(".inv-summary__popover-row--selectable") as HTMLElement
    );

    // Collapse the panel: badge = 2 checkboxes + 1 base-set unit.
    fireEvent.click(screen.getByTitle("Collapse filters"));
    expect(document.querySelector(".ifp-sidebar-tab__badge")?.textContent).toBe("3");

    // Clearing the base-set selection from the amber row drops it to 2.
    fireEvent.click(screen.getByTitle("Expand filters"));
    fireEvent.click(container.querySelector(".inv-summary__basesets-clear") as HTMLElement);
    fireEvent.click(screen.getByTitle("Collapse filters"));
    expect(document.querySelector(".ifp-sidebar-tab__badge")?.textContent).toBe("2");
  });
});

// CREATE (BL-205): the read-only shared-vault seam -- CardsPage's
// `shareToken` prop. Covers the data-source swap (getSharedQuantities
// instead of getQuantities), the `hasData` widening (real numbers + working
// filters for an anonymous viewer, since the OWNER's data is real), and the
// `readOnly` mutation-affordance removal (Add Cards/Import Export never
// render; the popup's quantity stepper loses its -/+ buttons but keeps
// showing the real quantity) -- independent of the viewer's OWN auth state.
describe("CardsPage read-only shared vault (BL-205, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBaseCardsList.mockResolvedValue(mockBaseCards);
    mockGetBaseCardDetail.mockResolvedValue(makeBaseCardDetail());
    mockGetSharedQuantities.mockResolvedValue([
      { variant_id: 1, quantity: 3 },
      { variant_id: 3, quantity: 1 },
    ]);
  });

  it("fetches quantities via getSharedQuantities(token), never getQuantities, for an anonymous viewer", async () => {
    await renderShared("tok-1", false);

    expect(mockGetSharedQuantities).toHaveBeenCalledWith("tok-1");
    expect(mockGetQuantities).not.toHaveBeenCalled();
  });

  it("fetches via getSharedQuantities even when the viewer is themselves signed in -- shareToken wins", async () => {
    await renderShared("tok-1", true);

    expect(mockGetSharedQuantities).toHaveBeenCalledWith("tok-1");
    expect(mockGetQuantities).not.toHaveBeenCalled();
  });

  it("renders the owner's real completion numbers for an anonymous viewer, not the anonymous zero-state", async () => {
    const { container } = await renderShared("tok-1", false);
    // Real percentages/counts, not the em-dash anonymous zero-state
    // InventorySummary otherwise renders for isAuthenticated=false.
    expect(summaryValues(container)).not.toContain("—");
  });

  it("does not render Add Cards, Import / Export, or Share at all (removed, not disabled)", async () => {
    await renderShared("tok-1", false);
    expect(screen.queryByRole("button", { name: "Add Cards" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import / Export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("still does not render Add Cards / Import Export / Share even when the viewer is signed in", async () => {
    await renderShared("tok-1", true);
    expect(screen.queryByRole("button", { name: "Add Cards" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import / Export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("enables the collection filter toggles for an anonymous viewer (real data exists to filter on)", async () => {
    await renderShared("tok-1", false);

    const toggle = screen.getByRole("button", { name: /show only cards i own/i });
    // Raw aria-disabled attribute (not SWUButton's ariaDisabled prop) --
    // React renders it as a literal "false" string rather than omitting it.
    expect(toggle.getAttribute("aria-disabled")).toBe("false");
    expect(toggle.className).not.toContain("pl-toggle--disabled");
  });

  it("clicking a filter toggle actually filters for an anonymous shared-vault viewer, not a sign-in nudge", async () => {
    const onRequestSignIn = vi.fn();
    await act(async () => {
      render(
        <CardsPage isAuthenticated={false} shareToken="tok-1" onRequestSignIn={onRequestSignIn} />
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /show only cards i own/i }));

    expect(onRequestSignIn).not.toHaveBeenCalled();
    // Narrows from 4 cards to the 2 owned (variant_id 1 and 3 above).
    expect(screen.getByText("SOR Card One")).toBeInTheDocument();
    expect(screen.queryByText("SOR Card Two")).not.toBeInTheDocument();
  });

  it("suppresses the anonymous 'Log in to track your collection' nudge for a shared-vault viewer", async () => {
    await renderShared("tok-1", false);
    expect(screen.queryByText(/log in to track your collection/i)).not.toBeInTheDocument();
  });

  it("opens the card popup with the real quantity but no Increment/Decrement stepper buttons", async () => {
    mockGetBaseCardDetail.mockResolvedValue(
      makeBaseCardDetail({ variants: [makeVariant({ variant_id: 1, quantity: 3 })] })
    );
    await renderShared("tok-1", false);

    fireEvent.click(screen.getByRole("button", { name: "SOR Card One" }));
    await act(async () => {});

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /increment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decrement/i })).not.toBeInTheDocument();
    // The real quantity is still shown, not a "sign in to manage inventory"
    // nudge -- hasData is true for a shared-vault viewer. Scoped to the
    // popup's own plate (the table's playset chip also reads "3").
    expect(screen.queryByText(/sign in to manage inventory/i)).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("3")).toBeInTheDocument();
  });
});
