import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-250 S4-08 (gate matrix), S4-11 (dry-run -> commit with the same file, cap
// handling passthrough, the Replace All confirmation on the preview step),
// S4-12 (analytics, layout "phone").
vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventoryImportExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/inventoryImportExport")>()),
  runImport: vi.fn(),
  exportInventory: vi.fn(),
  downloadCatalogReference: vi.fn(),
  downloadBlob: vi.fn(),
}));

import { capture } from "../../analytics/analytics";
import { getQuantities } from "../../api/inventory";
import {
  downloadBlob,
  downloadCatalogReference,
  exportInventory,
  runImport,
} from "../../api/inventoryImportExport";
import type { ImportMode, ImportReport } from "../../api/inventoryImportExport";
import { resetRouterForTest } from "../router";
import { VaultDataProvider } from "../vault/useVaultData";
import { ImportExportScreen } from "./ImportExportScreen";

function report(stage: "dry_run" | "commit", mode: ImportMode, resolved = 2): ImportReport {
  return {
    stage,
    mode,
    cap_handling: "trim",
    committed: stage === "commit",
    totals: {
      rows: resolved + 1,
      resolved,
      matched_by_fallback: 0,
      unresolved: 1,
      ambiguous: 0,
      trimmed: 0,
      ceiling_clamped: 0,
      duplicate_rows_merged: 0,
      unrecognized_columns: [],
      removed_by_replace_all: 118,
    },
    rows: [
      {
        row_number: 1,
        status: "resolved",
        card: { set_code: "SOR", card_number: "087", variant_type: "Standard", name: "Luke" },
        file_quantity: 2,
        current_quantity: 1,
        resulting_quantity: 3,
      },
      {
        row_number: 2,
        status: "unresolved",
        reason: "unknown_triple",
        card: { set_code: "SOR", card_number: "999" },
      },
    ],
    removed: [],
  };
}

function mount(p: { signedIn: boolean; emailVerified: boolean }) {
  const onRequestSignIn = vi.fn();
  render(
    <VaultDataProvider isAuthenticated={p.signedIn}>
      <ImportExportScreen
        fromMore
        signedIn={p.signedIn}
        emailVerified={p.emailVerified}
        onRequestSignIn={onRequestSignIn}
      />
    </VaultDataProvider>
  );
  return { onRequestSignIn };
}

const pickFile = (name = "vault.csv") => {
  const f = new File(["a,b"], name, { type: "text/csv" });
  fireEvent.change(document.getElementById("ie-file-input")!, { target: { files: [f] } });
  return f;
};
const radio = (label: string) => screen.getByRole("radio", { name: new RegExp(label) });
const btn = (name: string) => screen.getByText(name).closest("button")!;

beforeEach(() => {
  resetRouterForTest();
  vi.mocked(capture).mockClear();
  vi.mocked(runImport).mockReset();
  window.location.hash = "#/more/importexport";
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("S4-08 Import & Export gate (desktop view forcing)", () => {
  it("anonymous: back to More and the sign-in prompt, nothing rendered", () => {
    const { onRequestSignIn } = mount({ signedIn: false, emailVerified: false });
    expect(document.querySelector(".m-ie")).toBeNull();
    expect(window.location.hash).toBe("#/more");
    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
  });

  it("signed in but unverified: back to More, no sign-in prompt", () => {
    const { onRequestSignIn } = mount({ signedIn: true, emailVerified: false });
    expect(document.querySelector(".m-ie")).toBeNull();
    expect(window.location.hash).toBe("#/more");
    expect(onRequestSignIn).not.toHaveBeenCalled();
  });

  it("verified: the screen renders and the route stays", () => {
    const { onRequestSignIn } = mount({ signedIn: true, emailVerified: true });
    expect(document.querySelector(".m-ie")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Import & Export" })).toBeTruthy();
    expect(window.location.hash).toBe("#/more/importexport");
    expect(onRequestSignIn).not.toHaveBeenCalled();
  });
});

describe("S4-11 preview + commit", () => {
  it("dry-runs then commits with the same file; cap handling passes through; refreshes", async () => {
    vi.mocked(runImport).mockImplementation(async (_f, mode, _c, stage) => report(stage, mode));
    mount({ signedIn: true, emailVerified: true });
    const f = pickFile();
    expect(btn("Preview import").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(radio("Merge \\(add\\)"));
    fireEvent.click(radio("Trim to my keep-limits"));
    expect(btn("Preview import").hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(btn("Preview import"));
    await screen.findByText("Import preview");
    expect(runImport).toHaveBeenLastCalledWith(f, "merge_add", "trim", "dry_run");
    // The report is a phone list (no table); the problem rows lead.
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText("Recommendation:")).toBeTruthy();
    const before = vi.mocked(getQuantities).mock.calls.length;
    fireEvent.click(btn("Confirm import"));
    await screen.findByText(/Import complete — 2 rows written\./);
    expect(runImport).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runImport).mock.calls[1]).toEqual([f, "merge_add", "trim", "commit"]);
    expect(vi.mocked(getQuantities).mock.calls.length).toBeGreaterThan(before);
  });

  it("add_above passes through unchanged", async () => {
    vi.mocked(runImport).mockImplementation(async (_f, mode, _c, stage) => report(stage, mode));
    mount({ signedIn: true, emailVerified: true });
    const f = pickFile("v.json");
    fireEvent.click(radio("^Replace(?! All)"));
    fireEvent.click(radio("Add everything"));
    fireEvent.click(btn("Preview import"));
    await screen.findByText("Import preview");
    expect(runImport).toHaveBeenLastCalledWith(f, "replace", "add_above", "dry_run");
  });

  it("Replace All: the confirmation sits on the preview step and gates the commit", async () => {
    vi.mocked(runImport).mockImplementation(async (_f, mode, _c, stage) => report(stage, mode));
    mount({ signedIn: true, emailVerified: true });
    pickFile();
    fireEvent.click(radio("Replace All"));
    fireEvent.click(radio("Trim to my keep-limits"));
    // Not on the configure step (desktop parity; rev4 had it here).
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(btn("Preview import"));
    await screen.findByText("Import preview");
    const box = screen.getByRole("checkbox");
    expect(box.textContent).toBe(
      "I understand this will permanently remove 118 cards not in this file."
    );
    const confirm = btn("Confirm import");
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirm);
    expect(runImport).toHaveBeenCalledTimes(1);
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(btn("Confirm import").hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(btn("Confirm import"));
    await screen.findByText(/Import complete/);
    expect(vi.mocked(runImport).mock.calls[1][3]).toBe("commit");
  });
});

describe("S4-12 import / export analytics (layout phone)", () => {
  it("import_dry_run, import_committed, export_performed carry layout phone", async () => {
    vi.mocked(runImport).mockImplementation(async (_f, mode, _c, stage) => report(stage, mode));
    vi.mocked(exportInventory).mockResolvedValue({ blob: new Blob(["{}"]), filename: "x.json" });
    vi.mocked(downloadCatalogReference).mockResolvedValue({
      blob: new Blob(["a"]),
      filename: "r.csv",
    });
    mount({ signedIn: true, emailVerified: true });
    await act(async () => {
      fireEvent.click(btn("Download JSON"));
    });
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.click(btn("Download catalog (CSV)"));
    });
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
    pickFile("vault.csv");
    fireEvent.click(radio("Merge \\(add\\)"));
    fireEvent.click(radio("Trim to my keep-limits"));
    fireEvent.click(btn("Preview import"));
    await screen.findByText("Import preview");
    fireEvent.click(btn("Confirm import"));
    await screen.findByText(/Import complete/);
    const calls = vi.mocked(capture).mock.calls;
    expect(calls).toContainEqual(["screen_viewed", { screen: "import_export", layout: "phone" }]);
    expect(calls).toContainEqual(["export_performed", { format: "json", layout: "phone" }]);
    expect(calls).toContainEqual([
      "import_dry_run",
      { format: "csv", rows: 3, error_rows: 1, layout: "phone" },
    ]);
    expect(calls).toContainEqual([
      "import_committed",
      { mode: "merge_add", rows_applied: 2, layout: "phone" },
    ]);
    // The catalogue reference is not the user's own data (desktop): no event.
    expect(calls.filter(([e]) => e === "export_performed")).toHaveLength(1);
  });
});
