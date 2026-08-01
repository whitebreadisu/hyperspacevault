import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { LimitsProvider } from "../../context/LimitsContext";
import { ALL_TYPE_CATEGORIES, CANONICAL_BUCKETS, DEFAULT_LIMITS } from "../../utils/limits";
import type {
  CapMode,
  LimitCell,
  LimitsResponseBody,
  TypeCategory,
} from "../../api/settingsLimits";

// DISPOSITION LOG (ADR-0013 -- product owner trimmed the settings UI to a
// single three-way "Keep-limit enforcement" control; the backend's full
// per-bucket contract is unchanged, so this file's mock shapes (fullMatrix /
// fullBody) are untouched).
//
// RETIRE (designed away by ADR-0013 -- the 15x2 grid no longer exists):
//   - "renders all 15 canonical buckets x 2 category columns..."
//   - "shows code defaults quietly (badge) and overrides distinctly..."
//   - "editing a cell and saving PUTs ONLY the non-default cells..."
//   - "a cell edited back to its code default is NOT sent as an override"
//   - "clamps numeric input to the 999 ceiling and strips non-digits"
//   - "No-limit round trip: the infinity toggle saves max_quantity null..."
//   - "reset-to-default on an override cell stages its removal..."
//   - "Remove all limits requires a confirm, then PUTs every cell..."
//   - "Reset all to defaults requires a confirm, then PUTs an empty..."
//   - "cancelling a confirm makes no PUT and returns to the action row"
// All ten asserted per-cell editing, per-cell reset, the No-limit
// checkbox/round-trip, and the two bulk-action confirm flows -- none of
// that UI exists anymore. The behaviors they protected (full-matrix reset,
// all-null "no limits") are re-expressed below as whole-page selections
// (KEEP/PORT "save payload for No limits" test) instead of per-cell staging.
//
// KEEP/PORT (behavior survives, re-expressed against the three-way control):
//   - error banners (401 / generic) -- now "SettingsPage error handling"
//   - save disabled until dirty -- now "dirty gating" describe block
//   - discard changes reverts the draft -- now "discard restores..." test
//   - BL-35's hard/soft radio-selection + cap_mode PUT tests are superseded
//     by the three-way control's own render/derive/save tests below (the
//     radio mechanics are the same shape, just three options instead of two,
//     with "No limits" newly mapped to the all-null-cells payload).
//
// BL-182 DISPOSITION (adds user-defined numeric caps -- Leaders & Bases /
// all other cards -- alongside the existing three-way selection):
//
// PORT (unchanged behavior, still exercised byte-for-byte):
//   - "renders exactly three options with Hard cap selected by default"
//     -- EXTENDED (not just ported) to also assert the default stepper
//     values (1 / 3), since that's now part of "default render state".
//   - "renders Soft cap selected when the fetched tenant is already soft"
//   - "derives 'No limits' selected when every fetched cell is
//     max_quantity null..." -- EXTENDED to assert both steppers show the
//     category defaults and are disabled while inert.
//   - "picking Hard/Soft cap ... saves overrides [] / cap_mode X" (x2) --
//     unchanged: both caps stay at their defaults in these tests, so the
//     BL-182 save path (buildCapOverrides) still emits [] exactly like the
//     pre-BL-182 unconditional overrides:[] did. This is also the "defaults
//     save []" coverage the BL-182 spec calls for explicitly.
//   - "picking No limits saves all 30 cells as max_quantity null with
//     cap_mode hard" -- unchanged; the all-null payload is untouched by
//     BL-182.
//   - dirty gating (undirty on re-selecting fetched state, discard reverts
//     without a PUT), error handling (401 / generic banner), and the danger
//     zone block are all unaffected by BL-182 and ported verbatim.
//
// NEW (BL-182 coverage the old three-way-only suite couldn't have had):
//   - "SettingsPage cap steppers" describe block: default display,
//     uniform-raised-matrix derivation, partial/mixed-matrix and
//     null-mixed-in fallback to default, floor/ceiling button disabling,
//     inert-under-"No limits", cap-change dirties the page, discard
//     restores caps.
//   - "SettingsPage cap save payloads" describe block: raising only the
//     singleton cap saves 15 uniform rows + cap_mode; raising both caps
//     saves 30 rows; defaults still save [].
//
// No test from the pre-BL-182 suite was deleted without a disposition above.

// LimitsApiError is a real class (the same vi.hoisted pattern
// CardPopup.test.tsx uses for EmailNotVerifiedError) so the
// instanceof check in SettingsPage's describeError sees the same reference
// the tests throw.
const { getLimits, putLimits, LimitsApiError } = vi.hoisted(() => {
  class LimitsApiError extends Error {
    status: number;
    constructor(action: string, status: number) {
      super(`${action} failed: ${status}`);
      this.status = status;
    }
  }
  return { getLimits: vi.fn(), putLimits: vi.fn(), LimitsApiError };
});
vi.mock("../../api/settingsLimits", () => ({ getLimits, putLimits, LimitsApiError }));

interface OverrideSpec {
  type_category: TypeCategory;
  limit_bucket: string;
  max_quantity: number | null;
}

/** The full 30-cell effective matrix the backend returns: every canonical
 * bucket x both categories at the code default, with any given overrides
 * swapped in as is_default: false cells. Still the backend's full contract
 * (ADR-0013 only trimmed the frontend), so this fixture is unchanged. */
function fullMatrix(overrides: OverrideSpec[] = []): LimitCell[] {
  const cells: LimitCell[] = [];
  for (const category of ["singleton", "standard"] as const) {
    for (const bucket of CANONICAL_BUCKETS) {
      const ov = overrides.find((o) => o.type_category === category && o.limit_bucket === bucket);
      cells.push(
        ov
          ? {
              type_category: category,
              limit_bucket: bucket,
              max_quantity: ov.max_quantity,
              is_default: false,
            }
          : {
              type_category: category,
              limit_bucket: bucket,
              max_quantity: DEFAULT_LIMITS[category],
              is_default: true,
            }
      );
    }
  }
  return cells;
}

/** Every one of the 30 cells overridden to "No limit" -- what a tenant who
 * has picked "No limits" round-trips as (and what the "No limits" save
 * payload sends). */
function allUnlimitedMatrix(): LimitCell[] {
  const cells: LimitCell[] = [];
  for (const category of ALL_TYPE_CATEGORIES) {
    for (const bucket of CANONICAL_BUCKETS) {
      cells.push({
        type_category: category,
        limit_bucket: bucket,
        max_quantity: null,
        is_default: false,
      });
    }
  }
  return cells;
}

/** BL-182: all 15 buckets of a single category overridden to the same
 * value -- the only shape that derives into a raised stepper value. */
function categoryOverrides(category: TypeCategory, value: number | null): OverrideSpec[] {
  return CANONICAL_BUCKETS.map((bucket) => ({
    type_category: category,
    limit_bucket: bucket,
    max_quantity: value,
  }));
}

/** The full GET/PUT response body (limits + cap_mode). */
function fullBody(overrides: OverrideSpec[] = [], capMode: CapMode = "hard"): LimitsResponseBody {
  return { limits: fullMatrix(overrides), cap_mode: capMode };
}

// BL-129 R5: SettingsPage now requires onDeleteAccount (threaded from App to
// the pane's own danger zone -- see the "SettingsPage danger zone" describe
// block below). Every existing call site in this file goes through
// renderPage, so a single default no-op keeps every pre-existing test's
// render call unchanged; tests that care about the callback pass their own.
async function renderPage(
  body: LimitsResponseBody = fullBody(),
  onDeleteAccount: () => void = () => {}
) {
  getLimits.mockResolvedValue(body);
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <LimitsProvider isAuthenticated={true}>
        <SettingsPage onDeleteAccount={onDeleteAccount} />
      </LimitsProvider>
    );
  });
  await waitFor(() => screen.getByText("Keep-limit enforcement"));
  return utils;
}

const saveBtn = () => screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
const hardRadio = () => screen.getByRole("radio", { name: /hard cap/i }) as HTMLInputElement;
const softRadio = () => screen.getByRole("radio", { name: /soft cap/i }) as HTMLInputElement;
const noneRadio = () => screen.getByRole("radio", { name: /no limits/i }) as HTMLInputElement;

// BL-182: stepper accessors. Buttons are found by their aria-labels; the
// numeric readout has no accessible role of its own, so it's read off the
// DOM from the stepper container the matching label text lives in.
const singletonDec = () =>
  screen.getByRole("button", { name: /decrease leaders & bases cap/i }) as HTMLButtonElement;
const singletonInc = () =>
  screen.getByRole("button", { name: /increase leaders & bases cap/i }) as HTMLButtonElement;
const standardDec = () =>
  screen.getByRole("button", { name: /decrease all other cards cap/i }) as HTMLButtonElement;
const standardInc = () =>
  screen.getByRole("button", { name: /increase all other cards cap/i }) as HTMLButtonElement;

function stepperValue(labelText: string): string {
  const title = screen.getByText(labelText);
  const stepper = title.closest(".sl-capstepper") as HTMLElement;
  return stepper.querySelector(".sl-capstepper__value")?.textContent ?? "";
}

describe("SettingsPage keep-limit enforcement control (ADR-0013)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders exactly three options with Hard cap selected by default, caps at 1 / 3 (BL-182)", async () => {
    await renderPage();

    expect(hardRadio().checked).toBe(true);
    expect(softRadio().checked).toBe(false);
    expect(noneRadio().checked).toBe(false);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(saveBtn().disabled).toBe(true);
    expect(stepperValue("LEADERS & BASES")).toBe("1");
    expect(stepperValue("ALL OTHER CARDS")).toBe("3");
  });

  it("renders Soft cap selected when the fetched tenant is already soft", async () => {
    await renderPage(fullBody([], "soft"));

    expect(softRadio().checked).toBe(true);
  });

  it('derives "No limits" selected when every fetched cell is max_quantity null, regardless of cap_mode', async () => {
    await renderPage({ limits: allUnlimitedMatrix(), cap_mode: "hard" });

    expect(noneRadio().checked).toBe(true);
    expect(hardRadio().checked).toBe(false);
    expect(saveBtn().disabled).toBe(true);
    // BL-182: steppers still display the category defaults while inert.
    expect(stepperValue("LEADERS & BASES")).toBe("1");
    expect(stepperValue("ALL OTHER CARDS")).toBe("3");
    expect(singletonDec().disabled).toBe(true);
    expect(singletonInc().disabled).toBe(true);
  });

  it("picking Hard cap after a non-hard fetch dirties the page and saves overrides [] / cap_mode hard", async () => {
    await renderPage(fullBody([], "soft"));
    putLimits.mockResolvedValue(fullBody([], "hard"));

    fireEvent.click(hardRadio());
    expect(saveBtn().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(putLimits).toHaveBeenCalledTimes(1);
    expect(putLimits).toHaveBeenCalledWith([], "hard");
  });

  it("picking Soft cap saves overrides [] / cap_mode soft", async () => {
    await renderPage();
    putLimits.mockResolvedValue(fullBody([], "soft"));

    fireEvent.click(softRadio());
    expect(saveBtn().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(putLimits).toHaveBeenCalledWith([], "soft");
    expect(softRadio().checked).toBe(true);
    expect(saveBtn().disabled).toBe(true);
  });

  it("picking No limits saves all 30 cells as max_quantity null with cap_mode hard", async () => {
    await renderPage();
    putLimits.mockResolvedValue({ limits: allUnlimitedMatrix(), cap_mode: "hard" });

    fireEvent.click(noneRadio());
    expect(saveBtn().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(putLimits).toHaveBeenCalledTimes(1);
    const [sentOverrides, sentCapMode] = putLimits.mock.calls[0] as [OverrideSpec[], CapMode];
    expect(sentCapMode).toBe("hard");
    expect(sentOverrides).toHaveLength(30);
    expect(sentOverrides.every((cell) => cell.max_quantity === null)).toBe(true);
    for (const category of ALL_TYPE_CATEGORIES) {
      for (const bucket of CANONICAL_BUCKETS) {
        expect(
          sentOverrides.some((c) => c.type_category === category && c.limit_bucket === bucket)
        ).toBe(true);
      }
    }
    // Re-rendered from the response: still shows as "No limits".
    expect(noneRadio().checked).toBe(true);
    expect(saveBtn().disabled).toBe(true);
  });
});

describe("SettingsPage cap steppers (BL-182)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives a uniform raised override across all 15 buckets of a category into its stepper value", async () => {
    await renderPage(fullBody(categoryOverrides("singleton", 5)));

    expect(stepperValue("LEADERS & BASES")).toBe("5");
    expect(stepperValue("ALL OTHER CARDS")).toBe("3");
  });

  it("a partial override set for a category displays the category default, not a raised value", async () => {
    const partial: OverrideSpec[] = CANONICAL_BUCKETS.slice(0, 3).map((bucket) => ({
      type_category: "singleton",
      limit_bucket: bucket,
      max_quantity: 5,
    }));
    await renderPage(fullBody(partial));

    expect(stepperValue("LEADERS & BASES")).toBe("1");
  });

  it("mixed non-uniform override values for a category display the category default", async () => {
    const mixed: OverrideSpec[] = CANONICAL_BUCKETS.map((bucket, i) => ({
      type_category: "standard",
      limit_bucket: bucket,
      max_quantity: i % 2 === 0 ? 5 : 6,
    }));
    await renderPage(fullBody(mixed));

    expect(stepperValue("ALL OTHER CARDS")).toBe("3");
  });

  it("a null mixed into an otherwise-uniform override set displays the category default", async () => {
    const overrides = categoryOverrides("singleton", 5);
    overrides[0] = { ...overrides[0], max_quantity: null };
    await renderPage(fullBody(overrides));

    expect(stepperValue("LEADERS & BASES")).toBe("1");
  });

  it("the decrement button is disabled at each category's floor", async () => {
    await renderPage();

    expect(singletonDec().disabled).toBe(true); // floor 1
    expect(standardDec().disabled).toBe(true); // floor 3
    expect(singletonInc().disabled).toBe(false);
    expect(standardInc().disabled).toBe(false);
  });

  it("the increment button is disabled at the 999 ceiling", async () => {
    await renderPage(fullBody(categoryOverrides("singleton", 999)));

    expect(singletonInc().disabled).toBe(true);
    expect(singletonDec().disabled).toBe(false);
  });

  it("both steppers are inert (buttons disabled) when 'No limits' is selected", async () => {
    await renderPage();

    fireEvent.click(noneRadio());

    expect(singletonDec().disabled).toBe(true);
    expect(singletonInc().disabled).toBe(true);
    expect(standardDec().disabled).toBe(true);
    expect(standardInc().disabled).toBe(true);
  });

  it("raising a stepper value makes the page dirty without touching a radio", async () => {
    await renderPage();
    expect(saveBtn().disabled).toBe(true);

    fireEvent.click(singletonInc());

    expect(stepperValue("LEADERS & BASES")).toBe("2");
    expect(saveBtn().disabled).toBe(false);
  });

  it("discard restores the fetched cap values without a PUT", async () => {
    await renderPage();

    fireEvent.click(singletonInc());
    fireEvent.click(standardInc());
    expect(saveBtn().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(stepperValue("LEADERS & BASES")).toBe("1");
    expect(stepperValue("ALL OTHER CARDS")).toBe("3");
    expect(saveBtn().disabled).toBe(true);
    expect(putLimits).not.toHaveBeenCalled();
  });
});

describe("SettingsPage cap save payloads (BL-182)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("raising only the singleton cap saves 15 uniform singleton rows plus cap_mode", async () => {
    await renderPage();
    putLimits.mockResolvedValue(fullBody(categoryOverrides("singleton", 2), "hard"));

    fireEvent.click(singletonInc()); // 1 -> 2
    expect(saveBtn().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(putLimits).toHaveBeenCalledTimes(1);
    const [sentOverrides, sentCapMode] = putLimits.mock.calls[0] as [OverrideSpec[], CapMode];
    expect(sentCapMode).toBe("hard");
    expect(sentOverrides).toHaveLength(15);
    expect(
      sentOverrides.every((c) => c.type_category === "singleton" && c.max_quantity === 2)
    ).toBe(true);
    for (const bucket of CANONICAL_BUCKETS) {
      expect(sentOverrides.some((c) => c.limit_bucket === bucket)).toBe(true);
    }
  });

  it("raising both caps saves 30 rows (15 per category) at their respective values", async () => {
    await renderPage(fullBody([], "soft"));
    putLimits.mockResolvedValue(
      fullBody([...categoryOverrides("singleton", 2), ...categoryOverrides("standard", 4)], "soft")
    );

    fireEvent.click(singletonInc()); // 1 -> 2
    fireEvent.click(standardInc()); // 3 -> 4
    expect(saveBtn().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn());
    });

    const [sentOverrides, sentCapMode] = putLimits.mock.calls[0] as [OverrideSpec[], CapMode];
    expect(sentCapMode).toBe("soft");
    expect(sentOverrides).toHaveLength(30);
    expect(
      sentOverrides.filter((c) => c.type_category === "singleton" && c.max_quantity === 2)
    ).toHaveLength(15);
    expect(
      sentOverrides.filter((c) => c.type_category === "standard" && c.max_quantity === 4)
    ).toHaveLength(15);
  });

  it("saving hard/soft with both caps left at their defaults sends overrides [] (BL-182's defaults-save-[] guarantee)", async () => {
    await renderPage(fullBody([], "soft"));
    putLimits.mockResolvedValue(fullBody([], "hard"));

    fireEvent.click(hardRadio());
    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(putLimits).toHaveBeenCalledWith([], "hard");
  });
});

describe("SettingsPage dirty gating (ADR-0013, PORT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("save is disabled until the selection differs from the fetched state", async () => {
    await renderPage();
    expect(saveBtn().disabled).toBe(true);

    fireEvent.click(softRadio());
    expect(saveBtn().disabled).toBe(false);
  });

  it("re-selecting the fetched state undirties the page without a save", async () => {
    await renderPage();

    fireEvent.click(softRadio());
    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(hardRadio());
    expect(saveBtn().disabled).toBe(true);
    expect(putLimits).not.toHaveBeenCalled();
  });

  it("discard changes restores the fetched selection without a PUT (PORT of BL-25 discard)", async () => {
    await renderPage();

    fireEvent.click(noneRadio());
    expect(saveBtn().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(hardRadio().checked).toBe(true);
    expect(saveBtn().disabled).toBe(true);
    expect(putLimits).not.toHaveBeenCalled();
  });
});

describe("SettingsPage error handling (PORT of BL-25 error banners)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a 401 to a signed-out message", async () => {
    await renderPage();
    putLimits.mockRejectedValue(new LimitsApiError("Saving limits", 401));

    fireEvent.click(softRadio());
    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/session has expired/i);
  });

  it("shows a generic banner for any other failure (e.g. an unexpected 422)", async () => {
    await renderPage();
    putLimits.mockRejectedValue(new LimitsApiError("Saving limits", 422));

    fireEvent.click(softRadio());
    await act(async () => {
      fireEvent.click(saveBtn());
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    // The draft (and its dirtiness) survives the failure for a retry.
    expect(saveBtn().disabled).toBe(false);
  });
});

// DISPOSITION (BL-129 R5, PORT of BL-87's Header.test.tsx coverage): Delete
// Account's trigger moved from the avatar dropdown (UserMenu) into this
// pane's own danger zone. The two assertions PORTed below are the same
// shape the retired "Header avatar menu Delete Account item (BL-87)"
// describe block asserted -- a destructive-styled trigger is present, and
// clicking it calls the callback -- just re-pointed at the new trigger site
// (a plain button, danger-styled via `.settings-btn--danger`, rather than a
// `menuitem`). DeleteAccountModal itself is unchanged and out of scope here
// (App.test.tsx covers the App-level open/close wiring).
describe("SettingsPage danger zone (BL-129 R5)", () => {
  it("renders a destructive-styled Delete Account trigger, visually separated from keep-limit enforcement", async () => {
    await renderPage();

    const trigger = screen.getByRole("button", { name: /delete account/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveClass("settings-btn--danger");
    // A separate <section> from the keep-limit control -- "visually
    // separated" per the issue -- not just another row in the same one.
    expect(trigger.closest("section")).not.toBe(saveBtn().closest("section"));
  });

  it("calls onDeleteAccount when the trigger is clicked", async () => {
    const onDeleteAccount = vi.fn();
    await renderPage(fullBody(), onDeleteAccount);

    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
  });
});
