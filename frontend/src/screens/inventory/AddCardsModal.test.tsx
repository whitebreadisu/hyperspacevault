import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AddCardsModal } from "./AddCardsModal";
import type { CardWithQty } from "../../api/inventory";

// DISPOSITION (§5.4/§8.1 — see addCardsResolver.test.ts for the full log):
// the one OP-specific scenario this file exercised ("needs_variant" for a
// shared card_number) is REPLACED below with its two-axis analog
// ("needs-finish hint when card_number is finish-ambiguous"); every other
// test here (dialog chrome, set selection, willAdd/willSkip wiring) is
// PORTed unchanged since the orchestration/props contract didn't change.
//
// DISPOSITION (BL-61 — cross-set batch persistence, added 2026-07-06): no
// existing test in this file needed a behavior change — Modal's public props
// didn't change, and `state.setCode` becoming the internal `state.activeSetCode`
// is an implementation detail invisible to these tests. New coverage added at
// the bottom of this file: the batch surviving a "Change set" round trip, and
// the chip list + verification table grouping by set once the batch spans
// two sets.
//
// DISPOSITION (BL-111 F7 — console restyle + close guard, 2026-07-13): the
// existing X/Escape/backdrop-click tests below all exercise an EMPTY batch
// (no row has a cardNumber at that point in the test), so they PORT
// unchanged -- requestClose's hasBatch check is false in every one of them,
// and onClose still fires directly with no confirm shown. New coverage added
// in the "close guard (BL-111 F7)" describe block at the bottom of this
// file: a non-empty batch raises the confirm instead of closing, "Return to
// Batch" dismisses it without closing, "Discard & Close" closes, and a
// successful commit's close skips the confirm outright (extending the
// existing BL-16 commit-gate test rather than duplicating its batch setup).
//
// DISPOSITION (BL-151 S2b — §4-REV precon dropdown, 2026-07-24): every
// `screen.getByRole("combobox")` below PORTs unchanged in behavior but is
// re-expressed as `getByRole("combobox", { name: "Set" })` -- disambiguation
// against the precon-deck dropdown (AddCardsPreconBar), which the initial
// "neither route chosen" state renders alongside the set dropdown.
// DISPOSITION (BL-151 S2c — §4-REV2 route locking, 2026-07-24): still holds
// unchanged. Route locking means the precon combobox is actually GONE from
// the DOM the moment any test below picks a set (only the locked route's
// bar renders at all past that point), so the explicit `{ name: "Set" }`
// selector is no longer strictly load-bearing for ambiguity in most of
// these tests -- but it's kept everywhere for consistency/robustness rather
// than reintroducing bare `getByRole("combobox")` calls that would only
// coincidentally still work today.
//
// DISPOSITION (BL-164 — custom Set/Precon Deck dropdowns, 2026-07-26): PORT
// every scenario below unchanged in intent -- the set-picking mechanics
// changed (native `<select>` -> SetDropdown's portaled listbox, see the
// `chooseSet` helper above), but nothing about what each test is actually
// proving (batch persistence, verification wiring, close guard, image
// preview) changed. `getByRole("combobox", { name: "Set" })` calls become
// `chooseSet(...)`; existence/absence checks become
// `getByRole("button"/"option", ...)` against the new trigger/listbox
// contract (`aria-label="Set"` is unchanged, per Set_Grouping_Context's
// "Fixed" list -- that's the point of the contract).
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
      id: 4,
      code: "JTL",
      name: "Jump to Lightspeed",
      is_base_set: true,
      release_date: "2025-03-14",
    },
  ]),
}));
// BL-16: EmailNotVerifiedError is a real class (not a vi.fn()) -- declared
// under vi.hoisted so the same reference is thrown by tests and checked via
// `instanceof` in AddCardsModal's catch block.
const { mockIncrementCard, EmailNotVerifiedError } = vi.hoisted(() => {
  class EmailNotVerifiedError extends Error {}
  return {
    mockIncrementCard: vi.fn().mockResolvedValue({
      variant_id: 1,
      quantity: 1,
      playset_complete: false,
      blocked: false,
      reason: null,
    }),
    EmailNotVerifiedError,
  };
});
vi.mock("../../api/inventory", () => ({
  incrementCard: mockIncrementCard,
  EmailNotVerifiedError,
}));

function makeCard(overrides: Partial<CardWithQty>): CardWithQty {
  return {
    id: 1,
    base_card_id: 1,
    set_id: 1,
    set_code: "SOR",
    base_card_number: "1",
    card_number: "1",
    name: "IG-88",
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
    base_card_number: "12",
    card_number: "12",
    quantity: 0,
    front_image_url: "https://cdn.example/ig88-standard.png",
  }),
  makeCard({
    id: 2,
    base_card_id: 1,
    base_card_number: "12",
    card_number: "12",
    variant_type: "Standard Foil",
    finish: "Standard Foil",
    quantity: 1,
    front_image_url: "https://cdn.example/ig88-foil.png",
  }),
  // A second set's card (BL-61 cross-set batch tests) — a single unambiguous
  // candidate, so it auto-resolves on the card_number alone.
  makeCard({
    id: 3,
    base_card_id: 3,
    set_id: 4,
    set_code: "JTL",
    base_card_number: "7",
    card_number: "7",
    source_set_code: "JTL",
    name: "Kazuda Xiono",
    quantity: 0,
    front_image_url: "https://cdn.example/kazuda.png",
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

// BL-164 (§5, custom Set/Precon Deck dropdowns): the native `<select>` this
// file used to drive via `getByRole("combobox", { name: "Set" })` +
// `fireEvent.change` is gone -- AddCardsSetBar's unlocked state now renders
// SetDropdown, a portaled logo-rail listbox (trigger button `aria-label=
// "Set"`, options `role="option"` inside a `role="listbox"` panel that only
// exists in the DOM while open). Every set-selection call site below is
// re-expressed through this one open-then-pick helper. `findByRole` (not
// `getByRole`) is deliberate -- it also subsumes the old separate
// `await waitFor(() => screen.getByText(/Spark of Rebellion/i))` sets-loaded
// gate those call sites used to need before the select existed: the
// dropdown can open before `getSets()` resolves (rendering whatever groups
// it has, even none), and `findByRole` polls until the option the test
// wants actually appears once the fetch settles. */
async function chooseSet(nameMatch: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
  });
  const option = await screen.findByRole("option", { name: nameMatch });
  await act(async () => {
    fireEvent.click(option);
  });
}

describe("AddCardsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders modal dialog", async () => {
    await renderModal();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /add cards/i })).toBeTruthy();
  });

  it("shows set selector in initial state", async () => {
    await renderModal();
    expect(screen.getByText(/Select a set to begin/i)).toBeTruthy();
  });

  it("calls onClose when × button is clicked", async () => {
    const { onClose } = await renderModal();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", async () => {
    const { onClose } = await renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when backdrop is clicked", async () => {
    const { onClose } = await renderModal();
    const overlay = document.querySelector(".ac-overlay")!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // DISPOSITION (BL-151 S2c — §4-REV2 route locking, REPLACE): the modal's
  // very first paint used to be the manual flow's own empty state (one bar,
  // this exact hint). §4-REV2 makes that moment the side-by-side CHOOSER
  // instead (neither route locked yet -- both bars shown, neutral copy
  // naming both), so "before a set is chosen" no longer shows this
  // manual-specific hint; it shows the new neutral one instead. The old
  // copy didn't disappear from the app -- it still surfaces once the manual
  // route is locked but between sets (e.g. mid-batch after "Change Set",
  // see AddCardsModal.precon.test.tsx's route-locking coverage) -- so this
  // is a genuine UI change, not a dropped behavior.
  it('shows the neutral "Select a set or a precon deck above to begin." hint on first paint (neither route locked yet)', async () => {
    await renderModal();
    expect(screen.getByText("Select a set or a precon deck above to begin.")).toBeTruthy();
  });

  it("shows set options after sets load", async () => {
    await renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set" }));
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Spark of Rebellion/i })).toBeTruthy();
    });
  });

  it("shows keypad and batch list after set is selected", async () => {
    await renderModal();
    await chooseSet(/^SOR —/);

    // "Enter a card number to begin." hint retired (BL-65: removed idle hint copy)
    expect(screen.getByText("Cards in this batch")).toBeTruthy();
  });

  it("stays in editing with needs-finish hint when card_number is finish-ambiguous", async () => {
    await renderModal();
    await chooseSet(/^SOR —/);

    // Enter a card number that resolves to 2 finishes (card 12 in mockCatalog
    // has both Standard and Standard Foil rows at source_set_code SOR) — the
    // two-axis resolver surfaces needs_finish, not an auto-resolve.
    const input = screen.getByPlaceholderText("000");
    await act(async () => {
      fireEvent.change(input, { target: { value: "12" } });
    });

    // Submit button stays inactive until a finish is picked; the modal stays in
    // editing phase. The Finish axis surfaces its placeholder option.
    expect(screen.getByText(/select finish/i)).toBeTruthy();
  });

  it("commits the row to the batch when Enter is pressed on the last dropdown", async () => {
    await renderModal();
    await chooseSet(/^SOR —/);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });

    // Pick the finish, then press Enter *on the finish <select>* — it should
    // commit to the batch rather than reopening the dropdown.
    const finishSelect = screen.getByLabelText("Finish");
    await act(async () => {
      fireEvent.change(finishSelect, { target: { value: "Standard Foil" } });
    });
    await act(async () => {
      fireEvent.keyDown(finishSelect, { key: "Enter" });
    });

    // The committed card now appears in the batch list.
    expect(screen.getByText("Cards in this batch")).toBeTruthy();
    expect(screen.getAllByText("IG-88").length).toBeGreaterThan(0);
  });

  it("splitForVerification: willAdd vs willSkip reflected in verification view", async () => {
    // Use a catalog where one card is at limit
    const limitedCatalog: CardWithQty[] = [
      makeCard({
        id: 10,
        base_card_id: 2,
        set_code: "JTL",
        base_card_number: "12",
        card_number: "12",
        source_set_code: "JTL",
        type: "Unit",
        quantity: 3,
      }),
      makeCard({
        id: 11,
        base_card_id: 3,
        set_code: "JTL",
        base_card_number: "55",
        card_number: "55",
        source_set_code: "JTL",
        type: "Unit",
        quantity: 0,
      }),
    ];
    await act(async () => {
      render(<AddCardsModal catalog={limitedCatalog} onClose={vi.fn()} onCommitted={vi.fn()} />);
    });

    // Select JTL
    await chooseSet(/^JTL —/);

    // Type card 55 (quantity=0, will be added)
    const input = screen.getByPlaceholderText("000");
    await act(async () => {
      fireEvent.change(input, { target: { value: "55" } });
    });

    // Submit via the entry form
    const form = input.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    // Now type card 12 (quantity=3 = at limit, will be skipped)
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });
    const form2 = screen.getByPlaceholderText("000").closest("form")!;
    await act(async () => {
      fireEvent.submit(form2);
    });

    // Click [Add Cards to Inventory] footer button to proceed to verification
    const footerBtns = screen.getAllByRole("button");
    const submitBtn = footerBtns.find((b) => b.textContent?.includes("Add Cards to Inventory"));
    await act(async () => {
      fireEvent.click(submitBtn!);
    });

    // Should be in verification phase
    expect(screen.getByRole("heading", { name: /verify cards/i })).toBeTruthy();
    expect(screen.getByText(/will be added to inventory/i)).toBeTruthy();
    expect(screen.getByText(/will not be added/i)).toBeTruthy();
    expect(screen.getByText("Inventory limit already reached.")).toBeTruthy();
  });

  // ─── BL-61: cross-set batch persistence ──────────────────────────────────

  it("preserves the batch when the set is changed (does not clear rows)", async () => {
    await renderModal();

    // Commit one card under SOR.
    await chooseSet(/^SOR —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });
    const finishSelect = screen.getByLabelText("Finish");
    await act(async () => {
      fireEvent.change(finishSelect, { target: { value: "Standard Foil" } });
    });
    await act(async () => {
      fireEvent.keyDown(finishSelect, { key: "Enter" });
    });
    expect(screen.getAllByText("IG-88").length).toBeGreaterThan(0);

    // Change the set — the old bug cleared `rows` here.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change set" }));
    });
    expect(screen.getByText(/Select a set to begin/i)).toBeTruthy();

    // Pick JTL as the new active set.
    await chooseSet(/^JTL —/);

    // The SOR row committed before the switch is still in the batch.
    expect(screen.getByText("Cards in this batch")).toBeTruthy();
    expect(screen.getAllByText("IG-88").length).toBeGreaterThan(0);
  });

  it("groups the chip list and verification table by set for a multi-set batch", async () => {
    await renderModal();

    // Commit a SOR card.
    await chooseSet(/^SOR —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });
    const finishSelect = screen.getByLabelText("Finish");
    await act(async () => {
      fireEvent.change(finishSelect, { target: { value: "Standard Foil" } });
    });
    await act(async () => {
      fireEvent.keyDown(finishSelect, { key: "Enter" });
    });

    // Switch to JTL and commit its (unambiguous) card.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change set" }));
    });
    await chooseSet(/^JTL —/);
    const jtlInput = screen.getByPlaceholderText("000");
    await act(async () => {
      fireEvent.change(jtlInput, { target: { value: "7" } });
    });
    await act(async () => {
      fireEvent.submit(jtlInput.closest("form")!);
    });

    // The batch list is grouped by set — both set labels show as group headers.
    expect(screen.getAllByText(/Spark of Rebellion/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jump to Lightspeed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("IG-88").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kazuda Xiono").length).toBeGreaterThan(0);

    // Proceed to verification — the same grouping shows there too.
    const footerBtns = screen.getAllByRole("button");
    const submitBtn = footerBtns.find((b) => b.textContent?.includes("Add Cards to Inventory"));
    await act(async () => {
      fireEvent.click(submitBtn!);
    });

    expect(screen.getByRole("heading", { name: /verify cards/i })).toBeTruthy();
    expect(screen.getAllByText(/Spark of Rebellion/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jump to Lightspeed/i).length).toBeGreaterThan(0);
  });
});

// DISPOSITION (BL-16, CREATE): net-new commit-gate mapping -- prior to this
// change, handleCommit's catch block only ever logged to console.error and
// still closed the modal as if the commit had succeeded.
describe("AddCardsModal commit gate (BL-16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIncrementCard.mockResolvedValue({
      variant_id: 1,
      quantity: 1,
      playset_complete: false,
      blocked: false,
      reason: null,
    });
  });

  async function buildOneRowBatchAndReachVerification() {
    const onClose = vi.fn();
    const onCommitted = vi.fn();
    await renderModal(onClose, onCommitted);
    await chooseSet(/^SOR —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });
    const finishSelect = screen.getByLabelText("Finish");
    await act(async () => {
      fireEvent.change(finishSelect, { target: { value: "Standard Foil" } });
    });
    await act(async () => {
      fireEvent.keyDown(finishSelect, { key: "Enter" });
    });

    const footerBtns = screen.getAllByRole("button");
    const submitBtn = footerBtns.find((b) => b.textContent?.includes("Add Cards to Inventory"));
    await act(async () => {
      fireEvent.click(submitBtn!);
    });
    expect(screen.getByRole("heading", { name: /verify cards/i })).toBeTruthy();
    return { onClose, onCommitted };
  }

  // handleCommit is an async click handler that fireEvent.click doesn't
  // await directly (DOM events can't be awaited), so a single
  // act(async () => fireEvent.click(...)) can return before the
  // incrementCard promise chain (and the state updates/onClose that follow
  // it) has actually settled. waitFor retries the assertion as those
  // microtasks flush, rather than asserting immediately after the click.
  function clickCommit() {
    const footerBtns = screen.getAllByRole("button");
    const commitBtn = footerBtns.find((b) => b.textContent?.includes("Add Cards to Inventory"));
    fireEvent.click(commitBtn!);
  }

  it("shows a banner-pointing message and keeps the modal open when the commit is rejected as unverified", async () => {
    mockIncrementCard.mockRejectedValue(new EmailNotVerifiedError());
    const { onClose, onCommitted } = await buildOneRowBatchAndReachVerification();

    await act(async () => {
      clickCommit();
    });

    await waitFor(() =>
      expect(screen.getByText(/verify your email to manage inventory/i)).toBeInTheDocument()
    );
    // The modal itself doesn't self-unmount (that's the parent's job, same
    // as every other onClose-based test in this file) -- what BL-16 changes
    // is that onClose is never called on this path, unlike the success path
    // below, even though the partial-progress refresh (onCommitted) still
    // fires.
    expect(onClose).not.toHaveBeenCalled();
    expect(onCommitted).toHaveBeenCalled();
  });

  it("still closes normally and applies the commit when the caller is verified", async () => {
    const { onClose, onCommitted } = await buildOneRowBatchAndReachVerification();

    await act(async () => {
      clickCommit();
    });

    await waitFor(() => expect(mockIncrementCard).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCommitted).toHaveBeenCalled();
    // BL-111 F7: a close that follows a successful commit skips the close
    // guard entirely -- the confirm never appears on this path.
    expect(screen.queryByText(/discard this batch/i)).toBeNull();
  });
});

// ─── Close guard (BL-111 F7) ─────────────────────────────────────────────
// Cancel/X/Escape/backdrop-click with a non-empty batch raises a
// console-styled confirm instead of closing outright. The X/Escape/backdrop
// tests above all run against an empty batch (no committed row yet), so
// they're untouched by this feature -- this block covers the non-empty-batch
// path specifically.
describe("AddCardsModal close guard (BL-111 F7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function buildOneRowBatch() {
    const onClose = vi.fn();
    const onCommitted = vi.fn();
    await renderModal(onClose, onCommitted);
    await chooseSet(/^SOR —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });
    const finishSelect = screen.getByLabelText("Finish");
    await act(async () => {
      fireEvent.change(finishSelect, { target: { value: "Standard Foil" } });
    });
    await act(async () => {
      fireEvent.keyDown(finishSelect, { key: "Enter" });
    });
    // Sanity: the row actually committed to the batch before the guard tests
    // rely on it being non-empty.
    expect(screen.getAllByText("IG-88").length).toBeGreaterThan(0);
    return { onClose, onCommitted };
  }

  it("shows the confirm instead of closing when X is clicked with a non-empty batch", async () => {
    const { onClose } = await buildOneRowBatch();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the confirm instead of closing when the footer Cancel is clicked", async () => {
    const { onClose } = await buildOneRowBatch();

    const cancelBtn = screen.getAllByRole("button").find((b) => b.textContent === "Cancel");
    fireEvent.click(cancelBtn!);

    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the confirm instead of closing on a backdrop click with a non-empty batch", async () => {
    const { onClose } = await buildOneRowBatch();

    const overlay = document.querySelector(".ac-overlay")!;
    fireEvent.mouseDown(overlay);

    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the confirm instead of closing on Escape with a non-empty batch", async () => {
    const { onClose } = await buildOneRowBatch();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"Return to Batch" dismisses the confirm without closing', async () => {
    const { onClose } = await buildOneRowBatch();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /return to batch/i }));

    expect(screen.queryByText(/discard this batch/i)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // The batch itself is untouched.
    expect(screen.getAllByText("IG-88").length).toBeGreaterThan(0);
  });

  it('"Discard & Close" closes the modal', async () => {
    const { onClose } = await buildOneRowBatch();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /discard.*close/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape while the confirm is open dismisses the confirm, not the modal", async () => {
    const { onClose } = await buildOneRowBatch();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.getByText(/discard this batch/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText(/discard this batch/i)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// BL-62: live card-image preview in the keypad's resolve panel. The image
// follows the resolver's current variant (so a Finish pick swaps the art) and
// sits in a persistent placeholder frame — present but empty whenever no
// concrete variant is resolved. The 180ms debounce means every image
// assertion goes through waitFor.
describe("card image preview (BL-62)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function openKeypad(setCode: string) {
    await renderModal();
    await chooseSet(new RegExp(`^${setCode} —`));
  }

  function frame() {
    return document.querySelector(".ac-pad__resolve-image")!;
  }

  it("renders the empty placeholder frame before any number is entered", async () => {
    await openKeypad("SOR");
    expect(frame()).toBeTruthy();
    expect(frame().querySelector("img")).toBeNull();
  });

  it("shows the resolved variant's front image (alt = card name) after the debounce", async () => {
    await openKeypad("JTL");
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "7" } });
    });
    await waitFor(() => {
      const img = frame().querySelector("img") as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain("kazuda.png");
      expect(img.alt).toBe("Kazuda Xiono");
    });
  });

  it("renders a srcset when the catalog entry carries derived renditions (BL-76 Phase 3)", async () => {
    const catalogWithRenditions: CardWithQty[] = [
      ...mockCatalog,
      makeCard({
        id: 4,
        base_card_id: 4,
        set_id: 4,
        set_code: "JTL",
        base_card_number: "9",
        card_number: "9",
        source_set_code: "JTL",
        name: "Renditioned Card",
        quantity: 0,
        front_image_url: "https://cdn.example/renditioned.png",
        front_images: {
          original: "/images/cards/renditioned.png",
          w640: "/images/cards/renditioned_640.webp",
          w320: "/images/cards/renditioned_320.webp",
        },
      }),
    ];
    await act(async () => {
      render(
        <AddCardsModal catalog={catalogWithRenditions} onClose={vi.fn()} onCommitted={vi.fn()} />
      );
    });
    await chooseSet(/^JTL —/);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "9" } });
    });
    await waitFor(() => {
      const img = frame().querySelector("img") as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain("renditioned_640.webp");
      expect(img.srcset).toContain("renditioned_320.webp");
      expect(img.srcset).toContain("renditioned_640.webp");
    });
  });

  it("stays on the placeholder while an axis pick is pending, then shows the picked variant", async () => {
    await openKeypad("SOR");
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("000"), { target: { value: "12" } });
    });
    // Finish-ambiguous — no concrete variant yet, so no image.
    expect(screen.getByText(/select finish/i)).toBeTruthy();
    expect(frame().querySelector("img")).toBeNull();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Finish"), { target: { value: "Standard Foil" } });
    });
    await waitFor(() => {
      const img = frame().querySelector("img") as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain("ig88-foil.png");
    });

    // Re-picking the other finish swaps the art.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Finish"), { target: { value: "Standard" } });
    });
    await waitFor(() => {
      const img = frame().querySelector("img") as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain("ig88-standard.png");
    });
  });

  it("clears back to the placeholder when the number stops resolving", async () => {
    await openKeypad("JTL");
    const input = screen.getByPlaceholderText("000");
    await act(async () => {
      fireEvent.change(input, { target: { value: "7" } });
    });
    await waitFor(() => expect(frame().querySelector("img")).toBeTruthy());

    await act(async () => {
      fireEvent.change(input, { target: { value: "79" } });
    });
    await waitFor(() => expect(frame().querySelector("img")).toBeNull());
  });
});
