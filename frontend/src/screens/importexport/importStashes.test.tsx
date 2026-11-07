import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportReport, StashImpact } from "../../api/inventoryImportExport";
import type { Stash } from "../../api/stashes";

// BL-344 slice 1: the import stash warning and the export note, desktop
// (ImportExportPage) and phone (mobile/more/ImportExportScreen).
//   - a preview with stash_impacts: an always-visible danger section listing
//     each impact (stash: card printing before -> after), and Confirm stays
//     disabled until "I understand this will take N copies out of my
//     stashes." is ticked; an empty list = nothing new on screen;
//   - the commit refreshes the stash data;
//   - users with at least one stash see "Exports don't include stashes."
//     next to the export downloads; users with none see nothing new.

vi.mock("../../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", async (orig) => ({
  ...(await orig<typeof import("../../api/inventory")>()),
  getQuantities: vi.fn().mockResolvedValue([]),
}));
const { runImport } = vi.hoisted(() => ({ runImport: vi.fn() }));
vi.mock("../../api/inventoryImportExport", async (orig) => ({
  ...(await orig<typeof import("../../api/inventoryImportExport")>()),
  runImport,
  exportInventory: vi.fn(),
  downloadCatalogReference: vi.fn(),
  downloadBlob: vi.fn(),
}));
const { getStashes, getStashItems } = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
}));
vi.mock("../../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../../api/stashes")>()),
  getStashes,
  getStashItems,
}));

import { ImportApiError } from "../../api/inventoryImportExport";
import { ImportExportScreen } from "../../mobile/more/ImportExportScreen";
import { resetRouterForTest } from "../../mobile/router";
import { StashProvider } from "../../stashes/StashContext";
import { VaultDataProvider } from "../../vault/useVaultData";
import { ImportExportPage } from "./ImportExportPage";

const STASH: Stash = {
  id: 1,
  name: "Red binder",
  description: null,
  created_at: "2026-11-01T00:00:00Z",
  copies: 3,
};
const IMPACTS: StashImpact[] = [
  {
    stash_id: 2,
    stash_name: "Trade stash",
    variant_id: 10,
    card_name: "Luke Skywalker",
    printing_label: "Standard · SOR 005",
    before: 2,
    after: 0,
  },
  {
    stash_id: 1,
    stash_name: "Red binder",
    variant_id: 10,
    card_name: "Luke Skywalker",
    printing_label: "Standard · SOR 005",
    before: 3,
    after: 2,
  },
];

function report(impacts: StashImpact[] | undefined, stage: "dry_run" | "commit" = "dry_run") {
  const r: ImportReport = {
    stage,
    mode: "replace",
    cap_handling: "add_above",
    committed: stage === "commit",
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
        card: { set_code: "SOR", card_number: "5", variant_type: "Standard", name: "Luke" },
        file_quantity: 0,
        current_quantity: 3,
        resulting_quantity: 0,
      },
    ],
    removed: [],
  };
  if (impacts !== undefined) {
    r.stash_impacts = impacts;
    // Contract fold-in 1: present whenever the list is (empty included).
    r.stash_impacts_token = `tok-${impacts.length}`;
  }
  return r;
}

type Layout = "desktop" | "phone";

async function mount(layout: Layout, stashes: Stash[] = []) {
  getStashes.mockResolvedValue(stashes);
  getStashItems.mockResolvedValue([]);
  await act(async () => {
    render(
      layout === "desktop" ? (
        <StashProvider enabled>
          <ImportExportPage onBackToVault={vi.fn()} onImported={async () => {}} />
        </StashProvider>
      ) : (
        <div className="m-app">
          <VaultDataProvider isAuthenticated>
            <StashProvider enabled>
              <ImportExportScreen fromMore signedIn emailVerified onRequestSignIn={vi.fn()} />
            </StashProvider>
          </VaultDataProvider>
        </div>
      )
    );
  });
  await waitFor(() => expect(getStashes).toHaveBeenCalled());
  await act(async () => {});
}

async function preview(layout: Layout, r: ImportReport) {
  runImport.mockResolvedValueOnce(r);
  const input = document.getElementById("ie-file-input") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["a"], "f.csv")] } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: /^Replace$|Replace(?! All)/ }));
    fireEvent.click(screen.getByRole("radio", { name: /add everything/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Preview import").closest("button")!);
  });
  await waitFor(() => screen.getByText("Import preview"));
  void layout;
}

const confirmBtn = () => screen.getByText("Confirm import").closest("button")!;
const stashSection = () =>
  screen.queryByRole("region", { name: "Copies that will be taken out of stashes" });

beforeEach(() => {
  vi.clearAllMocks();
  resetRouterForTest();
  window.location.hash = "#/more/importexport";
});

describe.each<Layout>(["desktop", "phone"])("BL-344 import stash warning (%s)", (layout) => {
  it("lists every impact in a danger section and gates Confirm on the tick", async () => {
    await mount(layout, [STASH]);
    await preview(layout, report(IMPACTS));
    const section = stashSection()!;
    expect(section).not.toBeNull();
    expect(section.className).toContain("ie-report-section--danger");
    // 3 copies leave stashes: 2 from Trade stash, 1 from Red binder.
    expect(within(section).getByRole("heading").textContent).toMatch(
      /Will be taken out of stashes \(3\)/
    );
    const text = section.textContent!;
    expect(text).toMatch(/Trade stash.*Luke Skywalker Standard · SOR 005.*2 → 0/);
    expect(text).toMatch(/Red binder.*Luke Skywalker Standard · SOR 005.*3 → 2/);

    expect(confirmBtn().getAttribute("aria-disabled")).toBe("true");
    const tick = screen.getByRole("checkbox", {
      name: "I understand this will take 3 copies out of my stashes.",
    });
    await act(async () => {
      fireEvent.click(tick);
    });
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("Confirm does nothing until ticked, then commits and refreshes the stashes", async () => {
    await mount(layout, [STASH]);
    await preview(layout, report(IMPACTS));
    await act(async () => {
      fireEvent.click(confirmBtn());
    });
    expect(runImport).toHaveBeenCalledTimes(1); // the preview only
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /take 3 copies out of my stashes/ }));
    });
    runImport.mockResolvedValueOnce(report(IMPACTS, "commit"));
    const before = getStashes.mock.calls.length;
    await act(async () => {
      fireEvent.click(confirmBtn());
    });
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(2));
    expect(runImport.mock.calls[1][3]).toBe("commit");
    await waitFor(() => expect(getStashes.mock.calls.length).toBeGreaterThan(before));
  });

  it("one copy reads singular", async () => {
    await mount(layout, [STASH]);
    await preview(layout, report([{ ...IMPACTS[1] }]));
    expect(
      screen.getByRole("checkbox", {
        name: "I understand this will take 1 copy out of my stashes.",
      })
    ).toBeTruthy();
  });

  it("an empty list (or none at all) adds nothing and Confirm is open", async () => {
    await mount(layout, [STASH]);
    await preview(layout, report([]));
    expect(stashSection()).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /out of my stashes/ })).toBeNull();
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("a backend without the field reads as no impacts", async () => {
    await mount(layout, []);
    await preview(layout, report(undefined));
    expect(stashSection()).toBeNull();
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
  });
});

// Contract fold-in 1 (F2): the preview's token travels back on the commit;
// a 409 stash_impacts_changed (or exceeds_owned) writes nothing and sends the
// user back to preview again -- no stale Confirm.
describe.each<Layout>(["desktop", "phone"])("BL-344 import commit token (%s)", (layout) => {
  const tick = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /out of my stashes/ }));
    });
  };

  it("sends the preview's stash_impacts_token with the commit", async () => {
    await mount(layout, [STASH]);
    await preview(layout, report(IMPACTS));
    await tick();
    runImport.mockResolvedValueOnce(report(IMPACTS, "commit"));
    await act(async () => {
      fireEvent.click(confirmBtn());
    });
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(2));
    expect(runImport.mock.calls[1][3]).toBe("commit");
    expect(runImport.mock.calls[1][4]).toBe("tok-2");
  });

  it("an empty list's token is sent too", async () => {
    await mount(layout, []);
    await preview(layout, report([]));
    runImport.mockResolvedValueOnce(report([], "commit"));
    await act(async () => {
      fireEvent.click(confirmBtn());
    });
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(2));
    expect(runImport.mock.calls[1][4]).toBe("tok-0");
  });

  it.each([
    ["stash_impacts_changed", "Your stashes changed since the preview. Preview the file again."],
    [
      "exceeds_owned",
      "This import would leave a stash holding more copies than you own, so nothing was written. Preview the file again.",
    ],
  ] as const)("409 %s: says so and returns to a fresh preview", async (code, message) => {
    await mount(layout, [STASH]);
    await preview(layout, report(IMPACTS));
    await tick();
    runImport.mockRejectedValueOnce(new ImportApiError(code, 409));
    await act(async () => {
      fireEvent.click(confirmBtn());
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
    // No success, no stale report or Confirm; the next step is Preview import.
    expect(screen.queryByText(/Import complete/)).toBeNull();
    expect(screen.queryByText("Confirm import")).toBeNull();
    expect(stashSection()).toBeNull();
    expect(screen.getByText("Preview import")).toBeTruthy();
    // The file and choices are kept: preview again, then the fresh report.
    runImport.mockResolvedValueOnce(report([]));
    await act(async () => {
      fireEvent.click(screen.getByText("Preview import").closest("button")!);
    });
    await waitFor(() => screen.getByText("Import preview"));
    expect(runImport).toHaveBeenCalledTimes(3);
    expect(runImport.mock.calls[2][3]).toBe("dry_run");
  });
});

describe.each<Layout>(["desktop", "phone"])("BL-344 export note (%s)", (layout) => {
  it("a user with a stash sees the note next to the downloads", async () => {
    await mount(layout, [STASH]);
    const note = await screen.findByText("Exports don't include stashes.");
    const exportSection = document.querySelector('[aria-labelledby="ie-export-title"]')!;
    expect(exportSection.contains(note)).toBe(true);
  });

  it("a user with no stashes sees nothing new", async () => {
    await mount(layout, []);
    expect(screen.queryByText("Exports don't include stashes.")).toBeNull();
  });
});
