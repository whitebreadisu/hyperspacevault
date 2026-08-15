import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AddCardsModal } from "./AddCardsModal";
import { ImportApiError } from "../../api/inventoryImportExport";
import type { ImportReport } from "../../api/inventoryImportExport";
import type { CardWithQty } from "../../api/inventory";
import type { CapMode } from "../../api/settingsLimits";

// BL-151 S2b/S2c (§4-REV / §4-REV2, owner dev-review 2026-07-24): the
// precon-mode half of AddCardsModal's coverage. Kept in its own sibling
// file, same rationale as the S2 original this replaces.
//
// DISPOSITION LOG (S2 -> S2b, every describe block from the S2 version):
//  - "AddCardsModal mode switch" -- RETIRE in full. The segmented "By Card
//    Number | Precon Deck" control is designed away (§4-REV); there is no
//    `mode` state left to switch. REPLACED (S2b) by "chooser bars", which
//    covered the coexistence model; REPLACED AGAIN below (S2c) by "route
//    locking" now that coexistence itself is gone (§4-REV2).
//  - "AddCardsModal precon deck picker" (boxed SOR three-choice: Deck A /
//    Deck B / Whole Box rows) -- RETIRE. SOR/SHD/TWI revert to individually
//    selectable entries; there is no A/B/Both control anywhere in the DOM
//    any more. REPLACED below by "precon dropdown contents", which asserts
//    the *inverse*: SOR appears as two separate options, and the one
//    surviving special case -- IBH -- is a single always-both option with
//    no per-deck choice.
//  - "AddCardsModal cap choice" -- PORT (same policy: hard-mode-only, after
//    a selection, default trim), re-expressed against the dropdown
//    interaction instead of a picker-row click.
//  - "AddCardsModal precon payload construction" -- PARTIALLY RETIRE /
//    REPLACE: the "single deck" case PORTs (now via the dropdown); the old
//    "Whole Box" case (a user CHOOSING to merge SOR's two decks) RETIREs
//    since that choice no longer exists, REPLACED by IBH's entry, which
//    merges unconditionally with no choice involved.
//  - "AddCardsModal precon dry-run + commit" -- PORT the commit-flow
//    mechanics (dry_run -> preview -> commit, email_not_verified, other
//    ImportApiError), but REPLACE the report-rendering assertions: they now
//    assert the SAME AddCardsVerification structure/classes the manual flow
//    renders, not a bespoke sibling component's own markup.
//  - "AddCardsModal precon close guard" -- PORT, re-expressed against the
//    dropdown interaction.
//
// DISPOSITION LOG (S2b -> S2c, §4-REV2 route locking, 2026-07-24):
//  - "AddCardsModal chooser bars" > "renders the Set and Precon Deck
//    dropdowns together..." -- PORT unchanged (the initial/fully-cleared
//    state IS the side-by-side chooser both before and after S2c; only what
//    happens once a selection is made changed).
//  - "AddCardsModal chooser bars" > "last-used wins: picking a precon deck
//    shows the precon flow even after a set was already chosen" -- RETIRE.
//    §4-REV2 designs away "last-used wins with both bars always visible" --
//    once manual is locked, the precon bar is GONE, so this scenario (pick
//    a set, THEN pick a deck) is no longer reachable through the UI at all.
//  - "AddCardsModal chooser bars" > "switching back to the set bar after a
//    precon pick shows the keypad again with the batch intact" -- RETIRE,
//    same reason -- there is no "switching back" while the other route is
//    locked; the set bar isn't there to click. REPLACED below by "full
//    clear restores the side-by-side chooser, batch intact", which proves
//    the same underlying claim (nothing is lost) through the route the new
//    model actually offers: fully clearing, then re-picking.
//  - "AddCardsModal chooser bars" > "treats a chosen precon deck as a batch
//    in progress for the close guard" -- PORT unchanged (close-guard logic
//    itself wasn't touched by §4-REV2).
//  - NEW "AddCardsModal route locking" describe block (CREATE): picking a
//    set hides the precon bar; picking a deck hides the set bar; "Change
//    Set" with rows still in the batch keeps manual locked (typed rows
//    alone are enough); fully clearing (no set AND no rows) restores the
//    chooser; "Change Deck" alone fully clears precon and restores the
//    chooser immediately.
//  - Every place that clicked/asserted the "Preview Deck" button --
//    REPLACE, button copy is now "Preview adding deck" (§4-REV2 point 3).
//  - NEW "AddCardsModal precon verify-step button copy" describe block
//    (CREATE): "Edit keep-limit rule" for hard-cap users vs. plain "Back"
//    for soft/no-limit users on the precon verify screen's back action.

vi.mock("../../api/sets", () => ({
  getSets: vi.fn().mockResolvedValue([
    {
      id: 1,
      code: "SOR",
      name: "Spark of Rebellion",
      is_base_set: true,
      release_date: "2024-03-08",
    },
    // BL-164 rider (Definition_CosmeticsBatch_2026-07-26.md §4): TS26 is a
    // base set app-wide, matching live prod's `/api/sets` -- this fixture
    // was stale (asserted false pre-declaration).
    { id: 2, code: "TS26", name: "2026 Twin Suns", is_base_set: true, release_date: null },
    { id: 3, code: "IBH", name: "Intro Battle: Hoth", is_base_set: true, release_date: null },
  ]),
}));

// EmailNotVerifiedError is the manual flow's own error class -- AddCardsModal
// still imports it even when these tests never exercise the manual commit
// path, so it needs a real (non-throwing-on-import) mock alongside
// adjustCard (BL-219: renamed from incrementCard -- AddCardsModal's manual
// commit loop now calls the batched adjust endpoint instead), mirroring
// AddCardsModal.test.tsx's own setup.
const { mockAdjustCard, EmailNotVerifiedError } = vi.hoisted(() => {
  class EmailNotVerifiedError extends Error {}
  return { mockAdjustCard: vi.fn(), EmailNotVerifiedError };
});
vi.mock("../../api/inventory", () => ({
  adjustCard: mockAdjustCard,
  EmailNotVerifiedError,
}));

// runImport is mocked; ImportApiError is kept real (importOriginal) so the
// `instanceof` check in AddCardsModal's precon commit/preview catch blocks
// sees the exact same class the test throws -- same idiom
// ImportExportPage.test.tsx already uses for the identical contract.
const { runImport } = vi.hoisted(() => ({ runImport: vi.fn() }));
vi.mock("../../api/inventoryImportExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/inventoryImportExport")>();
  return { ...actual, runImport };
});

// Static fixture data standing in for preconEntries()'s real output --
// mocked so these tests stay valid regardless of what preconDecks.json
// actually contains. Two plain SOR decks (proving they're NOT boxed -- the
// reverted behavior), one TS26 single deck, and one IBH ibhBox entry
// (merging two internal decks with one shared uuid, so the "always both,
// summed" payload assertion has something to prove).
const { FAKE_ENTRIES } = vi.hoisted(() => {
  const SOR_LUKE = {
    code: "SOR-LUKE",
    set_code: "SOR",
    product: "Two-Player Starter",
    name: "Luke Skywalker",
    aspects: "Vigilance / Heroism",
    cards: [
      {
        swuapi_uuid: "uuid-luke-1",
        set_code: "SOR",
        card_number: "1",
        variant_type: "Standard",
        name: "Luke Card",
        quantity: 1,
      },
      {
        swuapi_uuid: "uuid-luke-2",
        set_code: "SOR",
        card_number: "2",
        variant_type: "Standard",
        name: "Luke Card Two",
        quantity: 2,
      },
    ],
  };
  const SOR_VADER = {
    code: "SOR-VADER",
    set_code: "SOR",
    product: "Two-Player Starter",
    name: "Darth Vader",
    aspects: "Aggression / Villainy",
    cards: [
      {
        swuapi_uuid: "uuid-vader-1",
        set_code: "SOR",
        card_number: "3",
        variant_type: "Standard",
        name: "Vader Card",
        quantity: 1,
      },
    ],
  };
  const TS26_DECK = {
    code: "TS26-SOLO",
    set_code: "TS26",
    product: "Twin Suns Deck",
    name: "Solo Twin Suns Deck",
    aspects: null,
    cards: [
      {
        swuapi_uuid: "uuid-ts26",
        set_code: "TS26",
        card_number: "1",
        variant_type: "Standard",
        name: "TS Card",
        quantity: 2,
      },
    ],
  };
  const IBH_LEIA = {
    code: "IBH-LEIA",
    set_code: "IBH",
    product: "Intro Battle",
    name: "Leia Organa",
    aspects: "Command / Heroism",
    cards: [
      {
        swuapi_uuid: "uuid-ibh-shared",
        set_code: "IBH",
        card_number: "1",
        variant_type: "Standard",
        name: "Shared Hoth Card",
        quantity: 1,
      },
      {
        swuapi_uuid: "uuid-ibh-leia-only",
        set_code: "IBH",
        card_number: "2",
        variant_type: "Standard",
        name: "Leia-Only Card",
        quantity: 1,
      },
    ],
  };
  const IBH_VADER = {
    code: "IBH-VADER",
    set_code: "IBH",
    product: "Intro Battle",
    name: "Darth Vader",
    aspects: "Aggression / Villainy",
    cards: [
      {
        swuapi_uuid: "uuid-ibh-shared",
        set_code: "IBH",
        card_number: "1",
        variant_type: "Standard",
        name: "Shared Hoth Card",
        quantity: 2,
      },
      {
        swuapi_uuid: "uuid-ibh-vader-only",
        set_code: "IBH",
        card_number: "3",
        variant_type: "Standard",
        name: "Vader-Only Card",
        quantity: 1,
      },
    ],
  };

  const FAKE_ENTRIES = [
    { kind: "deck" as const, key: "SOR-LUKE", setCode: "SOR", deck: SOR_LUKE },
    { kind: "deck" as const, key: "SOR-VADER", setCode: "SOR", deck: SOR_VADER },
    { kind: "deck" as const, key: "TS26-SOLO", setCode: "TS26", deck: TS26_DECK },
    {
      kind: "ibhBox" as const,
      key: "IBH",
      setCode: "IBH" as const,
      deckA: IBH_LEIA,
      deckB: IBH_VADER,
    },
  ];
  return { FAKE_ENTRIES };
});

vi.mock("../../data/preconDecks", () => ({
  preconEntries: () => FAKE_ENTRIES,
}));

// LimitsContext is a real module -- mocked directly (AddCardsModal only ever
// destructures { limits, capMode } from it) rather than wrapped in a real
// Provider, same approach the S2 version of this file used.
const { useLimitsMock } = vi.hoisted(() => ({
  useLimitsMock: vi.fn((): { limits: null; capMode: CapMode } => ({
    limits: null,
    capMode: "soft",
  })),
}));
vi.mock("../../context/LimitsContext", () => ({
  useLimits: useLimitsMock,
}));

function makeCard(overrides: Partial<CardWithQty> = {}): CardWithQty {
  return {
    id: 1,
    base_card_id: 1,
    set_id: 1,
    set_code: "SOR",
    base_card_number: "1",
    card_number: "1",
    name: "Placeholder",
    subtitle: null,
    rarity: "R",
    type: "Unit",
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    is_token: false,
    source_set_code: "SOR",
    swuapi_id: "uuid-1",
    front_image_url: null,
    back_image_url: null,
    stamp_group: null,
    aspects: [],
    keywords: [],
    traits: [],
    cost: 3,
    power: 4,
    hp: 4,
    arena: "Ground",
    quantity: 0,
    ...overrides,
  };
}

const mockCatalog: CardWithQty[] = [
  makeCard({
    id: 1,
    base_card_id: 1,
    set_id: 1,
    set_code: "SOR",
    base_card_number: "7",
    card_number: "7",
    source_set_code: "SOR",
    name: "Kazuda Xiono",
    quantity: 0,
  }),
];

async function renderModal(onClose = vi.fn(), onCommitted = vi.fn()) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <AddCardsModal catalog={mockCatalog} onClose={onClose} onCommitted={onCommitted} />
    );
  });
  return { result: result!, onClose, onCommitted };
}

// BL-164 (§5, custom Set/Precon Deck dropdowns): both bars' unlocked-state
// native `<select>` elements are gone -- AddCardsSetBar/AddCardsPreconBar
// now render SetDropdown/PreconDropdown, portaled logo-rail listboxes whose
// `role="option"` rows only exist in the DOM while their `role="listbox"`
// panel is open (trigger button `aria-haspopup="listbox"`). Every
// `getByRole("combobox", ...)` + `fireEvent.change` call site below is
// re-expressed through the open-then-pick helpers below; existence/absence
// checks against the old combobox become checks against the new trigger
// BUTTON (same `aria-label="Set"` / `aria-label="Precon Deck"` contract --
// unchanged, per Set_Grouping_Context's "Fixed" list).
function setTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "Set" });
}

function preconTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "Precon Deck" });
}

async function chooseSet(nameMatch: RegExp) {
  await act(async () => {
    fireEvent.click(setTrigger());
  });
  const option = await screen.findByRole("option", { name: nameMatch });
  await act(async () => {
    fireEvent.click(option);
  });
}

/** Looks up the fixture entry's expected row/option accessible name
 * (`${entryProduct} — ${entryName}`, see AddCardsPreconBar.tsx) from its
 * `key` -- keeps every existing `choosePreconDeck("SOR-LUKE")` /
 * `choosePreconDeck("IBH")` call site below unchanged, rather than having
 * to thread a name-match regex through each one. */
function preconOptionNameFor(key: string): RegExp {
  const entry = FAKE_ENTRIES.find((e) => e.key === key);
  if (!entry) throw new Error(`Unknown fixture entry key: ${key}`);
  if (entry.kind === "ibhBox") return /Whole box/i;
  return new RegExp(entry.deck.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

async function choosePreconDeck(key: string) {
  await act(async () => {
    fireEvent.click(preconTrigger());
  });
  const option = await screen.findByRole("option", { name: preconOptionNameFor(key) });
  await act(async () => {
    fireEvent.click(option);
  });
}

/** Opens the Precon Deck dropdown just long enough to prove both the
 * (synchronous) fixture entries list AND the async `getSets()` fetch
 * (needed for the IBH box's set-name lookup) have settled -- "Luke
 * Skywalker" is unique to the SOR-LUKE fixture entry (unlike "Two-Player
 * Starter", which both SOR fixture entries share). Closes the dropdown
 * again afterward so every caller starts from the same closed baseline
 * `choosePreconDeck`/`chooseSet` expect (an already-open dropdown would
 * make the next trigger click CLOSE it instead of opening it). */
async function waitForPreconBarLoaded() {
  await act(async () => {
    fireEvent.click(preconTrigger());
  });
  await screen.findByRole("option", { name: /Luke Skywalker/i });
  await act(async () => {
    fireEvent.click(preconTrigger());
  });
}

function baseImportReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    stage: "dry_run",
    mode: "merge_add",
    cap_handling: "add_above",
    committed: false,
    totals: {
      rows: 1,
      resolved: 1,
      matched_by_fallback: 0,
      unresolved: 0,
      ambiguous: 0,
      trimmed: 0,
      ceiling_clamped: 0,
      duplicate_rows_merged: 0,
      unrecognized_columns: [],
      removed_by_replace_all: 0,
    },
    rows: [
      {
        row_number: 1,
        status: "resolved",
        card: { set_code: "SOR", card_number: "1", variant_type: "Standard", name: "Shared Card" },
        file_quantity: 1,
        current_quantity: 0,
        resulting_quantity: 1,
      },
    ],
    removed: [],
    ...overrides,
  };
}

describe("AddCardsModal chooser bars (BL-151 S2b/S2c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "soft" });
  });

  it("renders the Set and Precon Deck dropdowns together on first paint, with no mode-switch control (PORT)", async () => {
    await renderModal();
    await waitForPreconBarLoaded();
    expect(setTrigger()).toBeInTheDocument();
    expect(preconTrigger()).toBeInTheDocument();
    // The old segmented "By Card Number | Precon Deck" tab control is gone.
    expect(screen.queryByRole("radio", { name: /by card number/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /add cards mode/i })).not.toBeInTheDocument();
  });

  it("treats a chosen precon deck as a batch in progress for the close guard (PORT)", async () => {
    const { onClose } = await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// BL-151 S2c (§4-REV2 point 2, CREATE): route locking. Replaces the S2b
// "last-used-wins, both bars always visible" model outright -- once either
// route has a selection, the OTHER route's bar is gone from the DOM
// entirely (not just hidden/disabled), and only reappears once the active
// route is fully cleared.
describe("AddCardsModal route locking (BL-151 S2c, §4-REV2 point 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "soft" });
  });

  it("picking a set removes the precon dropdown from the DOM entirely", async () => {
    await renderModal();
    await chooseSet(/^SOR —/);

    expect(screen.queryByRole("button", { name: "Precon Deck" })).not.toBeInTheDocument();
    expect(screen.queryByText(/add a premade deck/i)).not.toBeInTheDocument();
  });

  it("picking a precon deck removes the set dropdown from the DOM entirely", async () => {
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");

    expect(screen.queryByRole("button", { name: "Set" })).not.toBeInTheDocument();
    expect(screen.queryByText(/add individual cards/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview adding deck/i })).toBeInTheDocument();
  });

  it("typed rows alone keep the manual route locked -- 'Change Set' with a row still in the batch does not restore the precon bar", async () => {
    await renderModal();
    await chooseSet(/^SOR —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "7" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText("000").closest("form")!);
    });
    expect(screen.getAllByText("Kazuda Xiono").length).toBeGreaterThan(0);

    // "Change Set" clears the active SET (unlocks the set bar back to its
    // own picker sub-state) but NOT the manual route lock -- the row is
    // still in the batch.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change set" }));
    });

    // The set bar is back to its own unlocked picker (SetDropdown's trigger
    // button)...
    expect(screen.getByRole("button", { name: "Set" })).toBeInTheDocument();
    // ...but the precon bar has NOT reappeared -- manual is still locked.
    expect(screen.queryByRole("button", { name: "Precon Deck" })).not.toBeInTheDocument();
  });

  it("fully clearing the manual route (no set, no rows) restores the side-by-side chooser", async () => {
    await renderModal();
    await chooseSet(/^SOR —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "7" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText("000").closest("form")!);
    });

    // The set is still locked to SOR at this point (committing a row never
    // touches activeSetCode) -- remove the one row via the chip's own
    // delete button first...
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });
    // ...then clear the active set too -- now BOTH conditions (no set, no
    // rows) hold.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change set" }));
    });

    expect(screen.getByRole("button", { name: "Set" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Precon Deck" })).toBeInTheDocument();
  });

  it("'Change Deck' fully clears precon immediately and restores the side-by-side chooser (owner: 'that's correct and intended')", async () => {
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    expect(screen.getByRole("button", { name: "Change deck" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change deck" }));
    });

    expect(screen.getByRole("button", { name: "Set" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Precon Deck" })).toBeInTheDocument();
  });
});

describe("AddCardsModal precon dropdown contents (BL-151 S2b, REPLACE — SOR reverted, IBH always-both)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "soft" });
  });

  // BL-164: the dropdown's rail-grouped `role="option"` rows only exist in
  // the DOM while the listbox is open (portaled, unlike the old native
  // `<option>` elements, which always existed regardless of the select's
  // open state) -- both tests below open the Precon Deck trigger first.
  it("lists SOR's two starter decks as two separate options, not one boxed entry", async () => {
    await renderModal();
    await act(async () => {
      fireEvent.click(preconTrigger());
    });
    await screen.findByRole("option", { name: /Luke Skywalker/i });
    expect(screen.getByRole("option", { name: /Darth Vader/i })).toBeInTheDocument();
  });

  it("lists IBH as exactly one option, with no per-deck (A/B) choice anywhere in the DOM", async () => {
    await renderModal();
    await act(async () => {
      fireEvent.click(preconTrigger());
    });
    const ibhOptions = await screen.findAllByRole("option", { name: /Whole box/i });
    expect(ibhOptions).toHaveLength(1);
    expect(ibhOptions[0]).toHaveAccessibleName(/Intro Battle: Hoth/i);

    // No boxed three-choice control (deleted along with the reverted
    // feature) is rendered anywhere in the modal.
    expect(screen.queryByRole("radio", { name: "Deck A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Deck B" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Whole Box" })).not.toBeInTheDocument();
    expect(screen.queryByText("Whole Box")).not.toBeInTheDocument();
  });
});

describe("AddCardsModal cap choice (BL-151 S2b, PORT — §4 P2 unchanged)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the cap choice in soft mode even after a deck is selected", async () => {
    useLimitsMock.mockReturnValue({ limits: null, capMode: "soft" });
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    expect(screen.queryByText(/don't add copies above/i)).not.toBeInTheDocument();
  });

  it("hides the cap choice in hard mode until a deck is selected, then shows it defaulted to trim", async () => {
    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
    await renderModal();
    await waitForPreconBarLoaded();
    expect(screen.queryByText(/don't add copies above/i)).not.toBeInTheDocument();

    await choosePreconDeck("SOR-LUKE");
    const trimOption = screen.getByRole("radio", {
      name: /don't add copies above my keep-limits/i,
    }) as HTMLInputElement;
    expect(trimOption.checked).toBe(true);
  });

  it("lets a hard-mode user switch to 'add the full deck' before previewing", async () => {
    useLimitsMock.mockReturnValue({ limits: null, capMode: "hard" });
    runImport.mockResolvedValue(baseImportReport());
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");

    fireEvent.click(screen.getByRole("radio", { name: /add the full deck/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    expect(runImport).toHaveBeenCalledWith(expect.any(File), "merge_add", "add_above", "dry_run");
  });
});

describe("AddCardsModal precon payload construction (BL-151 S2b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "soft" });
    runImport.mockResolvedValue(baseImportReport());
  });

  it("PORT: builds a File with exactly the chosen single deck's rows", async () => {
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    expect(runImport).toHaveBeenCalledTimes(1);
    const file = runImport.mock.calls[0][0] as File;
    const parsed = JSON.parse(await file.text());
    expect(parsed.format_version).toBe("swu-inv/1");
    expect(parsed.cards.map((c: { swuapi_uuid: string }) => c.swuapi_uuid).sort()).toEqual(
      ["uuid-luke-1", "uuid-luke-2"].sort()
    );
  });

  it("REPLACE (was 'Whole Box' choice, now IBH's unconditional merge): builds a merged-union File for the IBH entry, summing the shared card's quantity", async () => {
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("IBH");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    const file = runImport.mock.calls[0][0] as File;
    const parsed = JSON.parse(await file.text());
    // 3 distinct uuids total (shared + leia-only + vader-only), never 4 --
    // the shared row is folded into one, not duplicated.
    expect(parsed.cards).toHaveLength(3);
    const shared = parsed.cards.find(
      (c: { swuapi_uuid: string }) => c.swuapi_uuid === "uuid-ibh-shared"
    );
    expect(shared.quantity).toBe(3); // 1 (Leia deck) + 2 (Vader deck)
  });
});

describe("AddCardsModal precon dry-run + commit through the shared Verify Cards component (BL-151 S2b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLimitsMock.mockReturnValue({ limits: null, capMode: "soft" });
  });

  async function selectDeckAndPreview(report: ImportReport) {
    runImport.mockResolvedValueOnce(report);
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });
  }

  it("REPLACE: renders through the exact same AddCardsVerification structure/classes the manual flow uses", async () => {
    await selectDeckAndPreview(
      baseImportReport({
        totals: { ...baseImportReport().totals, rows: 2, resolved: 2, trimmed: 1 },
        rows: [
          {
            row_number: 1,
            status: "resolved",
            card: {
              set_code: "SOR",
              card_number: "1",
              variant_type: "Standard",
              name: "Shared Card",
            },
            file_quantity: 1,
            current_quantity: 0,
            resulting_quantity: 1,
          },
          {
            row_number: 2,
            status: "resolved",
            card: {
              set_code: "SOR",
              card_number: "2",
              variant_type: "Standard",
              name: "Capped Card",
            },
            file_quantity: 2,
            current_quantity: 2,
            resulting_quantity: 3,
            copies_not_added: 1,
            trim_reason: "keep_limit",
          },
        ],
      })
    );

    // Same header copy the manual flow's verification phase uses.
    expect(screen.getByRole("heading", { name: /verify cards to add/i })).toBeInTheDocument();
    // Same section titles/idiom -- "at-limit skip" copy, not a bespoke
    // "Trimmed" section (§4-REV's explicit instruction).
    expect(screen.getByText(/will be added to inventory/i)).toBeInTheDocument();
    expect(screen.getByText(/will not be added/i)).toBeInTheDocument();
    expect(screen.queryByText(/^trimmed/i)).not.toBeInTheDocument();
    // Same structural classes AddCardsVerification renders for the manual
    // flow -- proving this is the ONE shared component, not a look-alike.
    expect(document.querySelectorAll(".ac-verify__section").length).toBeGreaterThan(0);
    expect(document.querySelector(".ac-verify__table")).not.toBeNull();
    expect(document.querySelector(".ac-verify__section--add")).not.toBeNull();
    expect(document.querySelector(".ac-verify__section--skip")).not.toBeNull();
  });

  it("renders an unresolved row as a prominent data-integrity section (should never happen with precon data)", async () => {
    await selectDeckAndPreview(
      baseImportReport({
        totals: { ...baseImportReport().totals, rows: 1, resolved: 0, unresolved: 1 },
        rows: [
          {
            row_number: 1,
            status: "unresolved",
            reason: "unknown_uuid_and_triple",
            card: { set_code: "SOR", card_number: "1", variant_type: "Standard" },
            file_quantity: 1,
          },
        ],
      })
    );

    expect(screen.getByText(/unresolved rows/i)).toBeInTheDocument();
    expect(document.querySelector(".ac-precon-verify__integrity")).not.toBeNull();
  });

  it("commits on 'Add Cards to Inventory' -- calls runImport with stage=commit and closes", async () => {
    const onClose = vi.fn();
    const onCommitted = vi.fn();
    runImport.mockResolvedValueOnce(baseImportReport());
    await renderModal(onClose, onCommitted);
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    runImport.mockResolvedValueOnce(baseImportReport({ stage: "commit", committed: true }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add cards to inventory/i }));
    });

    expect(runImport).toHaveBeenNthCalledWith(
      2,
      expect.any(File),
      "merge_add",
      "add_above",
      "commit"
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCommitted).toHaveBeenCalled();
  });

  // DISPOSITION (BL-196, CREATE): net-new coverage -- the precon commit
  // path's busy overlay (handlePreconCommit) stages "Applying N cards…"
  // through the commit-stage runImport call, then "Refreshing your Vault…"
  // through onCommitted, dismissing only once both settle. Same
  // deferred()-promise technique ImportExportPage.test.tsx and
  // AddCardsModal.test.tsx's own BL-196 coverage use.
  it("stages 'Applying 1 card…' then 'Refreshing your Vault…' on precon commit, holding until onCommitted settles", async () => {
    let resolveCommit!: (report: ImportReport) => void;
    const commitPromise = new Promise<ImportReport>((resolve) => {
      resolveCommit = resolve;
    });
    let resolveCommitted!: () => void;
    const committedPromise = new Promise<void>((resolve) => {
      resolveCommitted = resolve;
    });
    const onCommitted = vi.fn(() => committedPromise);
    runImport.mockResolvedValueOnce(baseImportReport());
    await renderModal(vi.fn(), onCommitted);
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    runImport.mockReturnValueOnce(commitPromise);
    fireEvent.click(screen.getByRole("button", { name: /add cards to inventory/i }));

    // baseImportReport()'s one row is the batch size the verify screen's own
    // "N of M cards will be added" hint already shows.
    await waitFor(() => expect(screen.getByText(/applying 1 card…/i)).toBeInTheDocument());

    await act(async () => resolveCommit(baseImportReport({ stage: "commit", committed: true })));

    await waitFor(() => expect(screen.getByText("Refreshing your Vault…")).toBeInTheDocument());
    expect(onCommitted).toHaveBeenCalledTimes(1);
    // Still up -- the verify screen is still what's underneath.
    expect(screen.getByRole("heading", { name: /verify cards to add/i })).toBeInTheDocument();

    await act(async () => resolveCommitted());

    await waitFor(() =>
      expect(screen.queryByText("Refreshing your Vault…")).not.toBeInTheDocument()
    );
  });

  it("surfaces the verify-email copy and stays open on a 403 email_not_verified commit", async () => {
    const onClose = vi.fn();
    const onCommitted = vi.fn();
    runImport.mockResolvedValueOnce(baseImportReport());
    await renderModal(onClose, onCommitted);
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    runImport.mockRejectedValueOnce(new ImportApiError("email_not_verified", 403));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add cards to inventory/i }));
    });

    await waitFor(() =>
      expect(screen.getByText(/verify your email to manage inventory/i)).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onCommitted).toHaveBeenCalled();
  });

  it("shows a modal-foot error and stays open on any other ImportApiError during commit", async () => {
    const onClose = vi.fn();
    runImport.mockResolvedValueOnce(baseImportReport());
    await renderModal(onClose);
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });

    runImport.mockRejectedValueOnce(new ImportApiError("too_many_rows", 422));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add cards to inventory/i }));
    });

    await waitFor(() => expect(screen.getByText(/more than 20,000 rows/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

// BL-151 S2c (§4-REV2 point 3, CREATE): the precon verify screen's back
// action reads "Edit keep-limit rule" for hard-cap users (owner: you don't
// edit a premade deck's own batch, you go back and edit the RULE) and plain
// "Back" for soft/no-limit users (no rule exists on their screen at all --
// labeling a nonexistent rule would be wrong). The soft/no-limit "Back"
// variant specifically is an ORCHESTRATOR call, not spelled out verbatim by
// the owner's note -- recorded here per the brief.
describe("AddCardsModal precon verify-step button copy (BL-151 S2c, §4-REV2 point 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function selectDeckAndPreview(capMode: CapMode) {
    useLimitsMock.mockReturnValue({ limits: null, capMode });
    runImport.mockResolvedValueOnce(baseImportReport());
    await renderModal();
    await waitForPreconBarLoaded();
    await choosePreconDeck("SOR-LUKE");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /preview adding deck/i }));
    });
  }

  it("reads 'Edit keep-limit rule' for a hard-cap user, not plain 'Edit' or 'Back'", async () => {
    await selectDeckAndPreview("hard");

    expect(screen.getByRole("button", { name: "Edit keep-limit rule" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("reads plain 'Back' for a soft-cap user, not 'Edit keep-limit rule' (no rule exists on their screen)", async () => {
    await selectDeckAndPreview("soft");

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit keep-limit rule" })).not.toBeInTheDocument();
  });

  it("clicking the back action (either copy) returns to the select step, showing the deck bar's locked strip and (for hard mode) the cap radio again", async () => {
    await selectDeckAndPreview("hard");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit keep-limit rule" }));
    });

    expect(
      screen.getByRole("radio", { name: /don't add copies above my keep-limits/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview adding deck/i })).toBeInTheDocument();
  });
});
