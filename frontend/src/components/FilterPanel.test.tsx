import { useState } from "react";
import { render, act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { FilterPanel } from "./FilterPanel";
import { DEFAULT_FILTERS, COST_MAX } from "../utils/filters";
import {
  CHROME_OFFSET,
  H_FULL,
  H_COMPACT,
  H_TWO,
  DOCKED_MIN_WIDTH,
} from "../utils/filterPanelTiers";
import type { BaseCard, Variant } from "../utils/catalog";
import type { CardSet } from "../api/sets";

// ── Helpers ───────────────────────────────────────────────────────────────

const { getSets } = vi.hoisted(() => ({ getSets: vi.fn() }));
vi.mock("../api/sets", () => ({ getSets }));

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "001",
    front_image_url: null,
    back_image_url: null,
    ...overrides,
  };
}

function makeCard(overrides: Partial<BaseCard> = {}): BaseCard {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "001",
    name: "Test Unit",
    subtitle: null,
    // swuapi rarity is a full word (Common/Uncommon/Rare/Legendary/Special),
    // matching what the API returns — not a single-letter code.
    rarity: "Common",
    type: "Unit",
    aspects: [],
    keywords: [],
    traits: [],
    cost: null,
    power: null,
    hp: null,
    arena: null,
    is_token: false,
    variants: [makeVariant()],
    ...overrides,
  };
}

// DISPOSITION (PORT, RR-22): the "applyFilters tests" block that lived here
// moved verbatim to utils/filters.test.ts alongside the extracted logic --
// assertion content unchanged, only imports/factories relocated. Component
// tests (set toggle, faceting) stay here with the components.

// ── FilterPanel set toggle (§5.1) ──────────────────────────────────────────

const BASE_SET: CardSet = {
  id: 1,
  code: "SOR",
  name: "Spark of Rebellion",
  is_base_set: true,
  release_date: "2024-03-08",
};
const LONG_TAIL_SET: CardSet = {
  id: 2,
  code: "PRM",
  name: "Promotional",
  is_base_set: false,
  release_date: null,
};

describe("FilterPanel set toggle", () => {
  function setup() {
    getSets.mockResolvedValue([BASE_SET, LONG_TAIL_SET]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={[]} />;
    };
    return Wrapper;
  }

  it("shows only base sets by default in the Set dropdown", async () => {
    const Wrapper = setup();
    await act(async () => {
      render(<Wrapper />);
    });
    // BL-111 F6: the sidebar starts open, so no expand click is needed
    // before interacting with its facet controls.
    await waitFor(() => expect(getSets).toHaveBeenCalled());
    // BL-111 dev-review wave 1 fix 3: the field label is no longer a
    // standalone row -- it's folded into the trigger button's own
    // accessible name ("Set — All sets"), so the button is found by role/name
    // directly rather than via a sibling label element.
    const setButton = await screen.findByRole("button", { name: /^Set —/ });
    fireEvent.click(setButton);

    expect(screen.getByText(/SOR/)).toBeTruthy();
    expect(screen.queryByText(/PRM/)).toBeNull();
  });

  it("reveals long-tail sets after clicking the toggle, and hides them again on re-toggle", async () => {
    const Wrapper = setup();
    await act(async () => {
      render(<Wrapper />);
    });
    // BL-111 F6: the sidebar starts open, so no expand click is needed
    // before interacting with its facet controls.
    await waitFor(() => expect(getSets).toHaveBeenCalled());
    const setButton = await screen.findByRole("button", { name: /^Set —/ });
    fireEvent.click(setButton);

    const toggleBtn = screen.getByText("Show all sets");
    fireEvent.click(toggleBtn);

    expect(screen.getByText(/SOR/)).toBeTruthy();
    expect(screen.getByText(/PRM/)).toBeTruthy();

    fireEvent.click(screen.getByText("Base sets only"));
    expect(screen.queryByText(/PRM/)).toBeNull();
  });
});

// DISPOSITION (REPLACE, BL-56): the "CatalogPage integration test" block that
// lived here imported the now-retired components/CatalogPage. Its three
// assertions (no old set-logo toggle, no old aspect toggle, FilterPanel
// header renders) are ported to screens/cards/CardsPage.test.tsx against the
// unified CardsPage, which is the FilterPanel host now.

// ── FilterPanel faceting (BL-70, CREATE) ────────────────────────────────────
//
// These cover the faceting rules from SWU_Backlog.md BL-70 at the
// FilterPanel level (client-side only, no toggles involved -- the
// ownedOnly-toggle facet case is covered separately in CardsPage.test.tsx,
// since ownedOnly lives there). `cards` passed to FilterPanel here plays the
// role CardsPage's toggle-narrowed list plays in production.

const FACET_SOR: CardSet = {
  id: 1,
  code: "SOR",
  name: "Spark of Rebellion",
  is_base_set: true,
  release_date: "2024-03-08",
};
const FACET_JTL: CardSet = {
  id: 2,
  code: "JTL",
  name: "Jump to Lightspeed",
  is_base_set: true,
  release_date: "2025-01-01",
};

describe("FilterPanel faceting (BL-70)", () => {
  // BL-111 dev-review wave 1 fix 3: field label rows are gone -- each field
  // is found by its trigger button's accessible name, which now reads
  // "<Label> — <selection>" (e.g. "Set — All sets").
  function fieldEl(label: string): HTMLElement {
    return screen.getByRole("button", { name: new RegExp(`^${label} —`) }).closest(".ifp-field")!;
  }

  function openField(label: string) {
    const button = fieldEl(label).querySelector(".ifp-multi__button") as HTMLElement;
    fireEvent.click(button);
  }

  async function renderFaceted(cards: BaseCard[]) {
    getSets.mockResolvedValue([FACET_SOR, FACET_JTL]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={cards} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    // BL-111 F6: the sidebar starts open, so no expand click is needed
    // before interacting with its facet controls.
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  // One SOR card (Standard finish) and one JTL card (Foil finish) -- shared
  // by most of the tests below so Set and Finish co-vary predictably.
  function sorJtlCards(): BaseCard[] {
    return [
      makeCard({
        base_card_number: "1",
        set_code: "SOR",
        variants: [makeVariant({ variant_id: 1, source_set_code: "SOR", finish: "Standard" })],
      }),
      makeCard({
        base_card_number: "2",
        set_code: "JTL",
        variants: [makeVariant({ variant_id: 2, source_set_code: "JTL", finish: "Foil" })],
      }),
    ];
  }

  it("still lists a filter's alternatives once picked (dead-end-prevention)", async () => {
    await renderFaceted(sorJtlCards());

    openField("Set");
    fireEvent.click(screen.getByRole("option", { name: /JTL/ }));

    // Facet calc for Set ignores Set's own selection, so both remain listed
    // -- selecting JTL never collapses the dropdown down to just JTL.
    expect(screen.getByRole("option", { name: /SOR/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /JTL/ })).toBeTruthy();
  });

  it("narrows another filter's options to values that co-occur with the selection", async () => {
    await renderFaceted(sorJtlCards());

    openField("Set");
    fireEvent.click(screen.getByRole("option", { name: /JTL/ }));

    openField("Finish");
    expect(screen.getByRole("option", { name: "Foil" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Standard" })).toBeNull();
  });

  it("lists rarity options matching the data's full-word values (regression: RARITY_OPTIONS used codes, so faceting hid every rarity)", async () => {
    await renderFaceted([
      makeCard({ base_card_number: "1", rarity: "Common" }),
      makeCard({ base_card_number: "2", rarity: "Rare" }),
    ]);

    openField("Rarity");
    // With the pre-fix code-valued RARITY_OPTIONS ("C"/"R"/…), neither of these
    // is in the facet-valid set (which holds "Common"/"Rare"), so both would be
    // hidden and the dropdown would render empty.
    expect(screen.getByRole("option", { name: "Common" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Rare" })).toBeTruthy();
  });

  it("reveals facet-invalid values (greyed, disabled, '(0)') when show-all is on", async () => {
    await renderFaceted(sorJtlCards());

    openField("Set");
    fireEvent.click(screen.getByRole("option", { name: /JTL/ }));
    openField("Finish");
    expect(screen.queryByRole("option", { name: "Standard" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show all values/i }));

    const standardOpt = screen.getByRole("option", { name: /Standard/ });
    expect(standardOpt.textContent).toContain("(0)");
    expect(standardOpt.className).toContain("ifp-multi__item--inert");
    expect(standardOpt).toBeDisabled();
  });

  // DISPOSITION (RETIRE, BL-133/issue #318): the 3 "Finish dropdown divider"
  // tests that lived here (R6b, flat pinned-list era) assumed "Standard"
  // pins and "Foil Prestige" falls into the alphabetized remainder below the
  // divider. BL-133's locked design moves Prestige INTO the pinned section
  // (slot 4 of 5) as an expandable group, so that exact scenario no longer
  // produces a below-divider remainder at all -- the premise is gone, not
  // portable. The pinned/below-divider boundary itself is still covered,
  // just relocated: buildFinishTree's ordering rules are pure-tested in
  // utils/filters.test.ts ("buildFinishTree (BL-133)"), and the rendered
  // divider DOM (.ifp-multi__pin-divider, unchanged class/element) is
  // covered against real below-divider content in
  // components/FinishFilter.test.tsx.

  it("keeps a stale multi-select value visible/inert, reactivates when cleared", async () => {
    const cards = [
      makeCard({
        base_card_number: "1",
        set_code: "SOR",
        keywords: ["Ambush"],
        variants: [makeVariant({ variant_id: 1, source_set_code: "SOR" })],
      }),
      makeCard({
        base_card_number: "2",
        set_code: "JTL",
        keywords: ["Restore"],
        variants: [makeVariant({ variant_id: 2, source_set_code: "JTL" })],
      }),
    ];
    await renderFaceted(cards);

    // Select both keywords (OR -- both currently match one card each).
    openField("Keywords");
    fireEvent.click(screen.getByRole("option", { name: "Ambush" }));
    fireEvent.click(screen.getByRole("option", { name: "Restore" }));

    // Narrow to Set=SOR -- Restore's only card (JTL) is now excluded, but
    // it must stay visible/checked/removable, just flagged inert, not
    // silently dropped from filters.keyword.
    openField("Set");
    fireEvent.click(screen.getByRole("option", { name: /SOR/ }));

    const restoreOpt = screen.getByRole("option", { name: /Restore/ });
    expect(restoreOpt.getAttribute("aria-selected")).toBe("true");
    expect(restoreOpt.className).toContain("ifp-multi__item--inert");
    expect(restoreOpt.textContent).toContain("(0)");
    expect(restoreOpt).not.toBeDisabled();

    // Clear the Set filter -- the conflict clears, Restore reactivates
    // automatically (facet validity is derived live, not stored state).
    // BL-147 fix 6: the dropdown menu now portals to document.body (escapes
    // the sidebar ring's clip-path), so it's no longer a DOM descendant of
    // fieldEl("Set") -- both the Keywords and Set menus can be open at once
    // here (no mutual exclusivity between fields), so scope via the
    // portal's own data-ifp-field="Set" attribute instead of DOM
    // containment.
    fireEvent.click(
      within(document.querySelector('[data-ifp-field="Set"]') as HTMLElement).getByRole("button", {
        name: "Clear",
      })
    );

    const restoreAfter = screen.getByRole("option", { name: "Restore" });
    expect(restoreAfter.className).not.toContain("ifp-multi__item--inert");
    expect(restoreAfter.getAttribute("aria-selected")).toBe("true");
  });
});

// ── AspectPicker (BL-90) ────────────────────────────────────────────────
//
// AspectIcon renders `title={aspect}` on its own <img>, so a plain
// getByTitle/getByRole("button", {name}) query is ambiguous (button and
// its child img can share the accessible/title text). Scope queries to
// the button itself via its .ifp-aspect class + title attribute instead.

function aspectBtn(title: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`.ifp-aspect[title="${title}"]`);
}

describe("AspectPicker (BL-90)", () => {
  function aspectCards(): BaseCard[] {
    return [
      makeCard({ base_card_number: "1", aspects: ["Command"] }),
      makeCard({ base_card_number: "2", aspects: ["Aggression"] }),
      makeCard({ base_card_number: "3", aspects: [] }), // aspectless
    ];
  }

  async function renderPanel(cards: BaseCard[]) {
    getSets.mockResolvedValue([FACET_SOR, FACET_JTL]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={cards} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    // BL-111 F6: the sidebar starts open, so no expand click is needed
    // before interacting with its facet controls.
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  it("defaults unfiltered (every option reads active) and deselecting the only active aspect is a stable state -- no snap-back", async () => {
    await renderPanel(aspectCards());

    // Default: aspects is empty (BL-90), which reads as "everything active."
    expect(aspectBtn("Command")!.className).not.toContain("ifp-aspect--off");
    expect(aspectBtn("Aggression")!.className).not.toContain("ifp-aspect--off");

    fireEvent.click(aspectBtn("Command")!);
    expect(aspectBtn("Command")!.getAttribute("aria-pressed")).toBe("true");
    expect(aspectBtn("Aggression")!.className).toContain("ifp-aspect--off");

    // BL-90: deselecting the only active aspect must land on the stable
    // empty/unfiltered state, not snap back to all-selected via a special
    // case -- both buttons reading active again here is a *consequence* of
    // an empty Set being unfiltered, not a re-fill.
    fireEvent.click(aspectBtn("Command")!);
    expect(aspectBtn("Command")!.className).not.toContain("ifp-aspect--off");
    expect(aspectBtn("Aggression")!.className).not.toContain("ifp-aspect--off");
    expect(aspectBtn("Command")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("No Aspect option isolates aspectless cards' visual state, and composes with a real aspect (any-of union)", async () => {
    await renderPanel(aspectCards());

    fireEvent.click(aspectBtn("No Aspect")!);
    expect(aspectBtn("No Aspect")!.getAttribute("aria-pressed")).toBe("true");
    expect(aspectBtn("Command")!.className).toContain("ifp-aspect--off");

    fireEvent.click(aspectBtn("Command")!);
    expect(aspectBtn("Command")!.getAttribute("aria-pressed")).toBe("true");
    expect(aspectBtn("No Aspect")!.getAttribute("aria-pressed")).toBe("true");
    expect(aspectBtn("Aggression")!.className).toContain("ifp-aspect--off");
  });

  it("No Aspect's faceted count reflects aspectless cards in the current result set (BL-70 parity: hidden when zero, greyed+'(0)'+disabled via show-all)", async () => {
    const cards = [
      makeCard({
        base_card_number: "1",
        set_code: "SOR",
        aspects: ["Command"],
        variants: [makeVariant({ variant_id: 1, source_set_code: "SOR" })],
      }),
      makeCard({
        base_card_number: "2",
        set_code: "JTL",
        aspects: [],
        variants: [makeVariant({ variant_id: 2, source_set_code: "JTL" })],
      }),
    ];
    await renderPanel(cards);

    // Narrow to Set=SOR -- the only aspectless card is JTL, so under the
    // dead-end-prevention rule No Aspect has zero facet-valid cards and
    // disappears from the picker by default (same as any other 0-count
    // value would).
    const setButton = await screen.findByRole("button", { name: /^Set —/ });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: /SOR/ }));

    expect(aspectBtn("No Aspect")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show all values/i }));
    const noAspectBtn = aspectBtn("No Aspect (0)");
    expect(noAspectBtn).toBeTruthy();
    expect(noAspectBtn!.className).toContain("ifp-aspect--inert");
    expect(noAspectBtn).toBeDisabled();
  });
});

// ── AspectModeControl (BL-130, issue #306, CREATE) ──────────────────────────
//
// Matching-predicate coverage (modes x selection sizes x aspectless cards)
// lives in utils/filters.test.ts alongside applyFilters/facetValidValues
// (RR-22 split: logic tests with the logic). This file covers the control
// itself -- default-mode rendering, toggle interaction, and its effect on
// the BL-91 Reset button (aspectMode is a genuine FilterState field now, so
// changing it alone counts as leaving DEFAULT_FILTERS).

describe("AspectModeControl (BL-130)", () => {
  async function renderPanel(cards: BaseCard[] = []) {
    getSets.mockResolvedValue([]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={cards} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  it("defaults to Exact active, matching DEFAULT_FILTERS.aspectMode (BL-130 owner-locked default)", async () => {
    await renderPanel();

    const exactSeg = screen.getByRole("radio", { name: "Exact" });
    expect(exactSeg.getAttribute("aria-checked")).toBe("true");
    expect(exactSeg.className).toContain("ifp-aspect-mode__btn--active");
    expect(screen.getByRole("radio", { name: "Any" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "Within" }).getAttribute("aria-checked")).toBe(
      "false"
    );
  });

  it("clicking a segment switches the active mode", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: "Within" }));
    expect(screen.getByRole("radio", { name: "Within" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Exact" }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("radio", { name: "Any" }));
    expect(screen.getByRole("radio", { name: "Any" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Within" }).getAttribute("aria-checked")).toBe(
      "false"
    );
  });

  it("changing the mode alone (no aspect selection) enables Reset, which restores Exact", async () => {
    await renderPanel();

    // SWUButton renders `aria-disabled` only when disabled (omitted -- not
    // "false" -- when active, per its own `ariaDisabled || undefined`), so
    // "not disabled" is `!== "true"`, matching the BL-91 reset tests'
    // existing `resetIsDisabled()` pattern rather than a literal "false".
    const resetButton = screen.getByRole("button", { name: /reset all filters/i });
    expect(resetButton.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Any" }));
    expect(resetButton.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(resetButton);
    expect(screen.getByRole("radio", { name: "Exact" }).getAttribute("aria-checked")).toBe("true");
    expect(resetButton.getAttribute("aria-disabled")).toBe("true");
  });
});

// ── Reset all filters (BL-91, CREATE) ───────────────────────────────────────
//
// FilterPanel owns the control; ownedOnly (BL-60) lives one level up in
// CardsPage and isn't reachable here, so the "owned-only untouched" proof
// lives in CardsPage.test.tsx instead (per BL-91's build brief: assert at
// the reset call site if reachable, otherwise assert reset only sets
// FilterState -- this file's tests below only ever touch FilterState).

describe("FilterPanel reset all filters (BL-91)", () => {
  function resetCards(): BaseCard[] {
    return [
      makeCard({
        base_card_number: "1",
        name: "Luke Skywalker",
        set_code: "SOR",
        aspects: ["Command"],
        cost: 3,
        variants: [makeVariant({ variant_id: 1, source_set_code: "SOR" })],
      }),
      makeCard({
        base_card_number: "2",
        name: "Darth Vader",
        set_code: "JTL",
        aspects: ["Aggression"],
        cost: 5,
        variants: [makeVariant({ variant_id: 2, source_set_code: "JTL" })],
      }),
    ];
  }

  async function renderReset(cards: BaseCard[]) {
    getSets.mockResolvedValue([FACET_SOR, FACET_JTL]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={cards} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    // BL-111 F6: the sidebar starts open, so no expand click is needed
    // before interacting with its facet controls.
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  function resetBtn(): HTMLElement {
    return screen.getByRole("button", { name: /reset all filters/i });
  }

  // DISPOSITION (REPLACE, BL-111 F6): the reset control used to be a plain
  // `<button disabled>` (native `disabled` attribute, hence `toBeDisabled()`
  // below). The sidebar redesign swaps it for the real `SWUButton` (README
  // §6: "standard SWU button for 'Reset all filters'"), which uses the
  // app's established anonymous-inert-teaser idiom -- `aria-disabled`, not
  // the native attribute, so the control stays clickable for assistive-tech
  // testability elsewhere in the app. `toBeDisabled()` only inspects the
  // native attribute and would false-fail against aria-disabled, so the
  // assertions below read `aria-disabled` directly instead; the underlying
  // behavior (inert until any filter is active) is unchanged.
  function resetIsDisabled(): boolean {
    return resetBtn().getAttribute("aria-disabled") === "true";
  }

  it("is disabled at the default state and enables once any filter is applied", async () => {
    await renderReset(resetCards());
    expect(resetIsDisabled()).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Search cards…"), {
      target: { value: "luke" },
    });
    expect(resetIsDisabled()).toBe(false);
  });

  it("resets a multi-facet narrowed state (search + aspect + set facet + cost range) back to DEFAULT_FILTERS, including the BL-90 empty aspect default", async () => {
    await renderReset(resetCards());

    // Search -- "a" matches both fixture cards' names, so it narrows the
    // result set without also collapsing the aspect facet's own dead-end-
    // prevention computation (which folds the current search into "other
    // filters" for every other field); a term matching only one card would
    // hide the non-matching card's aspect option entirely, which is correct
    // faceting behavior but not what this test is exercising.
    fireEvent.change(screen.getByPlaceholderText("Search cards…"), {
      target: { value: "a" },
    });

    // Aspect (BL-90: clicking one narrows to just that value).
    fireEvent.click(aspectBtn("Command")!);
    expect(aspectBtn("Aggression")!.className).toContain("ifp-aspect--off");

    // Set facet.
    const setButton = await screen.findByRole("button", { name: /^Set —/ });
    fireEvent.click(setButton);
    fireEvent.click(screen.getByRole("option", { name: /SOR/ }));

    // Cost range.
    fireEvent.change(screen.getByLabelText("Cost minimum"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Cost maximum"), { target: { value: "8" } });

    // Sanity: the narrowed state must have flipped the control on before we
    // rely on it going back off after reset.
    expect(resetIsDisabled()).toBe(false);

    fireEvent.click(resetBtn());

    expect((screen.getByPlaceholderText("Search cards…") as HTMLInputElement).value).toBe("");
    // Aspects back to the BL-90 empty default (unfiltered): both buttons
    // read active again, as a consequence of size === 0, not a re-fill.
    expect(aspectBtn("Command")!.className).not.toContain("ifp-aspect--off");
    expect(aspectBtn("Aggression")!.className).not.toContain("ifp-aspect--off");
    expect(screen.getByRole("button", { name: "Set — All sets" })).toBeTruthy();
    expect(screen.getByLabelText("Cost minimum")).toHaveValue("0");
    expect(screen.getByLabelText("Cost maximum")).toHaveValue(String(COST_MAX));
    expect(resetIsDisabled()).toBe(true);
  });
});

// DISPOSITION (RETIRE, BL-111 F6): the "FilterPanel view mode toggle
// (BL-73 Stage 1)" describe block that lived here is deleted, not ported.
// The behavior it covered -- a Table/Gallery toggle rendered BY FilterPanel,
// driven by viewMode/onViewModeChange props -- no longer exists: the
// sidebar redesign (design handoff §6, prototypes/cards-screen/
// FilterPanelRestyled.jsx) explicitly drops FilterPanel's own copy ("view
// toggle NOT rendered here -- it moves to InventorySummaryRestyled"), and
// FilterPanelProps no longer accepts those two props at all. This isn't a
// coverage loss: InventorySummary grew its own toggle in F3 (BL-111,
// design handoff §3) wired to the same CardsPage-owned state, and it is
// fully covered by screens/inventory/InventorySummary.test.tsx's own
// "renders Table/Gallery buttons" / "marks the active button" /
// "clicking ... calls onViewModeChange" tests -- verbatim equivalents of
// the ones deleted here, just against the component that actually renders
// the control now.

// ── Collapsible sidebar (BL-111 F6, CREATE) ─────────────────────────────────
//
// The old top panel's collapsed-by-default header toggle is gone -- the
// sidebar starts OPEN (matching the prototype's own `useState(true)`, no
// persistence specified anywhere in the design handoff). These tests cover
// the new collapse/expand mechanics: the rail replaces the panel when
// collapsed, filter state survives the round trip (collapsing never resets
// FilterState -- it's a pure visibility toggle, filters stay applied
// underneath), and the collapsed rail surfaces an active-filter count.
//
// DISPOSITION (PORT, BL-144/issue #356): "starts open" is no longer
// unconditional -- it's now gated on the viewport being at/above the
// docked side-by-side breakpoint (DOCKED_MIN_WIDTH, see the new
// "docked-breakpoint default" describe block below). This block's own
// coverage is unchanged and still valid AS WRITTEN, because
// src/test/setup.ts now defaults window.innerWidth to a value comfortably
// at/above that breakpoint specifically so every pre-existing test here
// keeps exercising the unchanged "at/above breakpoint" branch without
// modification -- the assertions below still describe real, current
// behavior at that width, just no longer the *only* behavior.
describe("FilterPanel collapsible sidebar (BL-111 F6)", () => {
  async function renderSidebar() {
    getSets.mockResolvedValue([]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={[]} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  it("renders open by default -- the facet body (search, groups, reset) is visible with no expand click", async () => {
    await renderSidebar();
    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
    expect(screen.getByText("Aspects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset all filters/i })).toBeInTheDocument();
    // The collapsed rail's "Expand filters" control must not exist yet.
    expect(screen.queryByTitle("Expand filters")).not.toBeInTheDocument();
  });

  it("collapsing hides the facet body and shows the collapsed rail instead", async () => {
    await renderSidebar();
    fireEvent.click(screen.getByTitle("Collapse filters"));

    expect(screen.queryByPlaceholderText("Search cards…")).not.toBeInTheDocument();
    expect(screen.queryByText("Aspects")).not.toBeInTheDocument();
    expect(screen.getByTitle("Expand filters")).toBeInTheDocument();
  });

  it("expanding from the collapsed rail restores the full facet body", async () => {
    await renderSidebar();
    fireEvent.click(screen.getByTitle("Collapse filters"));
    fireEvent.click(screen.getByTitle("Expand filters"));

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
    expect(screen.queryByTitle("Expand filters")).not.toBeInTheDocument();
  });

  it("filters still applied while collapsed -- a search term set before collapsing survives the collapse/expand round trip", async () => {
    await renderSidebar();

    fireEvent.change(screen.getByPlaceholderText("Search cards…"), {
      target: { value: "vader" },
    });

    fireEvent.click(screen.getByTitle("Collapse filters"));
    // Collapsed: the active-filter count (search counts as one) shows on
    // the rail, proving the underlying FilterState wasn't cleared by
    // collapsing -- only the panel's visibility changed.
    expect(screen.getByTitle("Expand filters").textContent).toContain("1");

    fireEvent.click(screen.getByTitle("Expand filters"));
    expect((screen.getByPlaceholderText("Search cards…") as HTMLInputElement).value).toBe("vader");
  });
});

// ── Docked-breakpoint default (BL-144, issue #356, CREATE) ───────────────
//
// Owner-decided scope: below the CSS docking breakpoint (FilterPanel.css's
// `@media (min-width: 2266px)`, mirrored as DOCKED_MIN_WIDTH in
// utils/filterPanelTiers.ts), the sidebar now defaults to COLLAPSED instead
// of BL-111 F6's unconditional open -- at/above it, unchanged (covered by
// the "collapsible sidebar" block above, which relies on setup.ts's default
// window.innerWidth sitting at/above the breakpoint). window.innerWidth is
// read once, at mount, via a lazy useState initializer -- there is no
// resize listener wired to `open`, so these tests set the width BEFORE
// rendering (a resize event after mount doesn't re-run the initializer).
describe("FilterPanel docked-breakpoint default (BL-144)", () => {
  function setInnerWidth(width: number) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
  }

  // window.innerWidth is a JSDOM global, not part of RTL's per-test render
  // tree -- reset it back to setup.ts's default (comfortably at/above the
  // breakpoint) after every test in this block so later files/tests aren't
  // affected by whichever width a given test left it at.
  afterEach(() => setInnerWidth(2400));

  async function renderAtWidth(width: number) {
    setInnerWidth(width);
    getSets.mockResolvedValue([]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={[]} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  it("renders COLLAPSED by default below DOCKED_MIN_WIDTH -- the rail shows, the facet body does not", async () => {
    await renderAtWidth(DOCKED_MIN_WIDTH - 1);

    expect(screen.getByTitle("Expand filters")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search cards…")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Collapse filters")).not.toBeInTheDocument();
  });

  it("renders OPEN by default exactly at DOCKED_MIN_WIDTH -- unchanged from BL-111 F6", async () => {
    await renderAtWidth(DOCKED_MIN_WIDTH);

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
    expect(screen.getByTitle("Collapse filters")).toBeInTheDocument();
    expect(screen.queryByTitle("Expand filters")).not.toBeInTheDocument();
  });

  it("renders OPEN by default comfortably above DOCKED_MIN_WIDTH -- unchanged from BL-111 F6", async () => {
    await renderAtWidth(2560);

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
    expect(screen.queryByTitle("Expand filters")).not.toBeInTheDocument();
  });

  it("below the breakpoint, expanding manually opens the facet body on demand (the existing toggle affordance)", async () => {
    await renderAtWidth(DOCKED_MIN_WIDTH - 1);

    fireEvent.click(screen.getByTitle("Expand filters"));

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
    expect(screen.queryByTitle("Expand filters")).not.toBeInTheDocument();
  });

  it("respects the user's explicit toggle for the rest of the session -- opening below the breakpoint then resizing narrower still doesn't re-collapse it", async () => {
    await renderAtWidth(DOCKED_MIN_WIDTH - 1);

    fireEvent.click(screen.getByTitle("Expand filters"));
    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();

    // Resize further away from the breakpoint (still below it) after the
    // user's deliberate open -- since `open` is only ever set by the two
    // toggle buttons (no resize listener touches it), the panel must stay
    // open regardless of what the viewport does next.
    setInnerWidth(900);
    fireEvent(window, new Event("resize"));

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
    expect(screen.queryByTitle("Expand filters")).not.toBeInTheDocument();
  });

  it("respects the user's explicit toggle for the rest of the session -- collapsing at/above the breakpoint then resizing wider still doesn't reopen it", async () => {
    await renderAtWidth(2560);

    fireEvent.click(screen.getByTitle("Collapse filters"));
    expect(screen.getByTitle("Expand filters")).toBeInTheDocument();

    setInnerWidth(3200);
    fireEvent(window, new Event("resize"));

    expect(screen.getByTitle("Expand filters")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search cards…")).not.toBeInTheDocument();
  });
});

// ── Click-outside collapse (BL-147 dev-review fix 5, CREATE) ────────────
//
// Owner-decided scope: below the docked breakpoint only (the expanded panel
// floats over content there, .ifp-sidebar position:absolute) -- docked
// side-by-side mode (.ifp-sidebar position:static) is unaffected. Clicks
// inside the panel itself, its own collapse toggle, and any portaled filter
// dropdown (fix 6's FilterMenuPortal) must not collapse it.
describe("FilterPanel click-outside collapse (BL-147 fix 5)", () => {
  function setWidth(width: number) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
  }

  afterEach(() => setWidth(2400));

  async function renderAndExpand(width: number) {
    setWidth(width);
    getSets.mockResolvedValue([]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={[]} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    await waitFor(() => expect(getSets).toHaveBeenCalled());
    // Below the docked breakpoint the panel starts collapsed (BL-144) --
    // expand it so every test here starts from the same "open" baseline.
    if (screen.queryByTitle("Expand filters")) {
      fireEvent.click(screen.getByTitle("Expand filters"));
    }
  }

  it("below the breakpoint, clicking outside the panel collapses it", async () => {
    await renderAndExpand(DOCKED_MIN_WIDTH - 1);
    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByPlaceholderText("Search cards…")).not.toBeInTheDocument();
    expect(screen.getByTitle("Expand filters")).toBeInTheDocument();
  });

  it("below the breakpoint, clicking inside the panel (e.g. the search field) does not collapse it", async () => {
    await renderAndExpand(DOCKED_MIN_WIDTH - 1);

    fireEvent.mouseDown(screen.getByPlaceholderText("Search cards…"));

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
  });

  it("below the breakpoint, the collapse toggle closes exactly once -- no close-then-reopen flicker", async () => {
    await renderAndExpand(DOCKED_MIN_WIDTH - 1);

    // A real click fires mousedown before click -- exercise both, in that
    // order, so this actually proves the outside-click listener treats the
    // toggle button itself as "inside" (silent) rather than relying on
    // testing-library's fireEvent.click alone, which doesn't synthesize a
    // preceding mousedown and so wouldn't catch a double-fire regression.
    const collapseBtn = screen.getByTitle("Collapse filters");
    fireEvent.mouseDown(collapseBtn);
    fireEvent.click(collapseBtn);

    expect(screen.getByTitle("Expand filters")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search cards…")).not.toBeInTheDocument();
  });

  it("below the breakpoint, clicking inside an open dropdown's portaled menu does not collapse the panel", async () => {
    await renderAndExpand(DOCKED_MIN_WIDTH - 1);

    fireEvent.click(screen.getByRole("button", { name: /^Set —/ }));
    // The dropdown menu portals to document.body (fix 6) -- click one of
    // its own menubar buttons (still "inside" the filter's own UI, just no
    // longer a DOM descendant of the panel). BL-173 round 4: the Set menu's
    // "All" button is retired (showAllButton={false}), so the always-present
    // "Show all sets" menubarExtra is the in-menu target now.
    fireEvent.mouseDown(screen.getByRole("button", { name: "Show all sets" }));

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
  });

  it("at/above the breakpoint (docked), clicking outside does not collapse the panel", async () => {
    await renderAndExpand(DOCKED_MIN_WIDTH);
    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.getByPlaceholderText("Search cards…")).toBeInTheDocument();
  });
});

// ── Vertical tiers (BL-121, CREATE) ──────────────────────────────────────
//
// FilterPanel reads window.innerHeight (default 1400 -- see src/test/
// setup.ts -- comfortably FULL for every pre-existing test above) and
// derives a data-vtier attribute via tierForViewportHeight
// (utils/filterPanelTiers.ts, unit-tested on its own in
// filterPanelTiers.test.ts). These tests cover the component-level wiring:
// the attribute actually renders and updates live on resize, the regrouped
// field order (§1) holds in the DOM, the two-column tier's grid/footer row
// exist, the fallback tier's internal scroll-region wrapper exists, and the
// collapsed rail's ring-wrapper outline fix (§6).

/** Sets window.innerHeight and fires a resize event -- fireEvent already
 * act()-wraps the dispatch, matching every other fireEvent call in this
 * file. Heights are picked solidly inside each tier's range (well past that
 * tier's own margin), not right at a boundary -- the boundary math itself
 * is filterPanelTiers.test.ts's job. */
function setInnerHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
  fireEvent(window, new Event("resize"));
}

const FULL_HEIGHT = CHROME_OFFSET + H_FULL + 200;
const COMPACT_HEIGHT = CHROME_OFFSET + H_COMPACT + 60;
const TWO_COL_HEIGHT = CHROME_OFFSET + H_TWO + 60;
const FALLBACK_HEIGHT = CHROME_OFFSET + 100; // well under H_TWO + 22

describe("FilterPanel vertical tiers (BL-121)", () => {
  // window.innerHeight is a JSDOM global, not part of RTL's per-test render
  // tree -- unmounting between tests doesn't reset it. Several tests here
  // deliberately leave it mid-resize (to assert a specific tier), so an
  // explicit reset back to setup.ts's default keeps every test's initial
  // mount starting from the same FULL-tier baseline regardless of run order.
  afterEach(() => setInnerHeight(1400));

  async function renderTiered() {
    getSets.mockResolvedValue([]);
    const Wrapper = () => {
      const [filters, setFilters] = useState(DEFAULT_FILTERS);
      return <FilterPanel filters={filters} setFilters={setFilters} cards={[]} />;
    };
    await act(async () => {
      render(<Wrapper />);
    });
    await waitFor(() => expect(getSets).toHaveBeenCalled());
  }

  function sidebarEl(): HTMLElement {
    return document.querySelector(".ifp-sidebar") as HTMLElement;
  }

  it('renders data-vtier="full" by default (setup.ts\'s tall default innerHeight)', async () => {
    await renderTiered();
    expect(sidebarEl().getAttribute("data-vtier")).toBe("full");
  });

  it("a live resize updates data-vtier through every tier without remounting", async () => {
    await renderTiered();
    expect(sidebarEl().getAttribute("data-vtier")).toBe("full");

    setInnerHeight(COMPACT_HEIGHT);
    expect(sidebarEl().getAttribute("data-vtier")).toBe("compact");

    setInnerHeight(TWO_COL_HEIGHT);
    expect(sidebarEl().getAttribute("data-vtier")).toBe("two-col");

    setInnerHeight(FALLBACK_HEIGHT);
    expect(sidebarEl().getAttribute("data-vtier")).toBe("fallback");

    setInnerHeight(FULL_HEIGHT);
    expect(sidebarEl().getAttribute("data-vtier")).toBe("full");
  });

  it("regrouped fields (§1) render in Card, Gameplay, Collection order; the Aspects label drops in two-col", async () => {
    await renderTiered();
    const labels = () =>
      Array.from(document.querySelectorAll(".ifp-sidebar__group-label")).map(
        (el) => el.textContent
      );

    // FULL (single-column): Aspects keeps its own labeled group above Card/
    // Gameplay/Collection.
    expect(labels()).toEqual(["Aspects", "Card", "Gameplay", "Collection"]);

    // TWO-COL (§4): the Aspects label is dropped (chits sit in the top span
    // instead). DOM/source order follows the grid's two columns (left:
    // Card then Collection; right: Gameplay) -- NOT the visual reading
    // order -- since both columns are siblings in one CSS grid.
    setInnerHeight(TWO_COL_HEIGHT);
    expect(labels()).toEqual(["Card", "Collection", "Gameplay"]);
  });

  it("Card group holds Set/Rarity/Finish and Gameplay holds Type/Arenas/Keywords/Traits then Cost/Power/HP (§1)", async () => {
    await renderTiered();
    const cardGroup = screen.getByText("Card").closest(".ifp-sidebar__group") as HTMLElement;
    const cardFieldLabels = within(cardGroup)
      .getAllByRole("button", { name: /—/ })
      .map((b) => b.textContent?.split(" — ")[0]);
    expect(cardFieldLabels).toEqual(["Set", "Rarity", "Finish"]);

    const gameplayGroup = screen
      .getByText("Gameplay")
      .closest(".ifp-sidebar__group") as HTMLElement;
    const gameplayMultiLabels = within(gameplayGroup)
      .getAllByRole("button", { name: /—/ })
      .map((b) => b.textContent?.split(" — ")[0]);
    expect(gameplayMultiLabels).toEqual(["Type", "Arenas", "Keywords", "Traits"]);
    const sliderLabels = within(gameplayGroup)
      .getAllByText(/^(Cost|Power|HP)$/)
      .map((el) => el.textContent);
    expect(sliderLabels).toEqual(["Cost", "Power", "HP"]);
  });

  it("Collection group holds only the host children, no Finish field (§1)", async () => {
    await renderTiered();
    const collectionGroup = screen
      .getByText("Collection")
      .closest(".ifp-sidebar__group") as HTMLElement;
    expect(within(collectionGroup).queryAllByRole("button", { name: /—/ })).toHaveLength(0);
  });

  it("two-col tier renders a footer row with the cascade toggle and Reset button, absent at full", async () => {
    await renderTiered();
    expect(document.querySelector(".ifp-sidebar__footrow")).not.toBeInTheDocument();

    setInnerHeight(TWO_COL_HEIGHT);
    const footrow = document.querySelector(".ifp-sidebar__footrow");
    expect(footrow).toBeInTheDocument();
    expect(within(footrow as HTMLElement).getByText(/show all values/i)).toBeInTheDocument();
    expect(
      within(footrow as HTMLElement).getByRole("button", { name: /reset all filters/i })
    ).toBeInTheDocument();
  });

  it("two-col tier renders the Card+Collection / Gameplay grid columns (§4)", async () => {
    await renderTiered();
    setInnerHeight(TWO_COL_HEIGHT);
    const grid = document.querySelector(".ifp-sidebar__grid");
    expect(grid).toBeInTheDocument();
    const cols = grid!.querySelectorAll(".ifp-sidebar__col");
    expect(cols).toHaveLength(2);
    const leftLabels = Array.from(cols[0].querySelectorAll(".ifp-sidebar__group-label")).map(
      (el) => el.textContent
    );
    expect(leftLabels).toEqual(["Card", "Collection"]);
    const rightLabels = Array.from(cols[1].querySelectorAll(".ifp-sidebar__group-label")).map(
      (el) => el.textContent
    );
    expect(rightLabels).toEqual(["Gameplay"]);
  });

  it("fallback tier wraps the grid+footer in an internal scroll region; normal tiers have none (§5)", async () => {
    await renderTiered();
    expect(document.querySelector(".ifp-sidebar__scroll-region")).not.toBeInTheDocument();

    setInnerHeight(TWO_COL_HEIGHT);
    expect(document.querySelector(".ifp-sidebar__scroll-region")).not.toBeInTheDocument();

    setInnerHeight(FALLBACK_HEIGHT);
    const scrollRegion = document.querySelector(".ifp-sidebar__scroll-region");
    expect(scrollRegion).toBeInTheDocument();
    // The grid and footer row live inside the scroll region at fallback --
    // only the head + top span stay pinned outside it.
    expect(scrollRegion!.querySelector(".ifp-sidebar__grid")).toBeInTheDocument();
    expect(scrollRegion!.querySelector(".ifp-sidebar__footrow")).toBeInTheDocument();
  });

  it("collapsed rail wraps the tab in the steel-ring outline-fix wrapper (§6)", async () => {
    await renderTiered();
    fireEvent.click(screen.getByTitle("Collapse filters"));

    const ring = document.querySelector(".ifp-sidebar-tab-ring");
    expect(ring).toBeInTheDocument();
    const tab = ring!.querySelector(".ifp-sidebar-tab");
    expect(tab).toBeInTheDocument();
    expect(screen.getByTitle("Expand filters")).toBe(tab);
  });
});
