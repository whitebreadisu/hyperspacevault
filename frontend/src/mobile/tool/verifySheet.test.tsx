import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-322: the Verify Cards sheet's post-commit refresh. The write decides
// success; if the Vault refetch after it fails, the done screen carries a
// "didn't refresh" note and stays open (no auto-close); on success it closes
// itself after 1.3 s as before (App Spec §25.3).
import cardsJson from "../../../e2e/mobile/fixtures/base-cards.json";
import setsJson from "../../../e2e/mobile/fixtures/sets.json";

vi.mock("../../api/baseCards", () => ({
  getBaseCardsList: vi.fn().mockResolvedValue(cardsJson),
  getBaseCardDetail: vi.fn().mockRejectedValue(new Error("404")),
}));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue(setsJson) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn() }));
vi.mock("../../api/settingsLimits", () => ({
  getLimits: vi.fn().mockResolvedValue([]),
  putLimits: vi.fn().mockResolvedValue([]),
}));
vi.mock("./commit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./commit")>()),
  executeCommit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));

import { getQuantities } from "../../api/inventory";
import { SheetHost } from "../Sheet";
import { VaultDataProvider } from "../../vault/useVaultData";
import { addCopy, resetBatchForTest } from "./batch";
import { VerifySheet } from "./VerifySheet";
import { NO_PICKS, resetToolForTest } from "./toolStore";

const mockQuantities = vi.mocked(getQuantities);

function mount() {
  const onClose = vi.fn();
  render(
    <VaultDataProvider isAuthenticated>
      <SheetHost>
        <VerifySheet onClose={onClose} />
      </SheetHost>
    </VaultDataProvider>
  );
  return onClose;
}

async function commitOneCopy() {
  // SOR 87 Standard (variant 7221) fits under the default keep-limit.
  addCopy({
    via: "keypad",
    force: false,
    setCode: "SOR",
    cardNumber: "87",
    picks: NO_PICKS,
    variantId: 7221,
    baseCardId: 814,
  });
  const onClose = mount();
  const add = await screen.findByText(/Add 1 card to vault/);
  // The initial Vault load is done; only the commit's refetch is left to fail.
  return { onClose, add: add.closest("button")! };
}

describe("VerifySheet post-commit refresh (BL-322)", () => {
  beforeEach(() => {
    resetBatchForTest();
    resetToolForTest();
    mockQuantities.mockReset();
    mockQuantities.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refresh fails after the write: the note shows and the sheet does not auto-close", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { onClose, add } = await commitOneCopy();
      mockQuantities.mockRejectedValue(new Error("quantities fetch failed"));
      await act(async () => {
        fireEvent.click(add);
      });
      await screen.findByText(/1 card added\./);
      expect(screen.getByText("Your Vault didn't refresh.")).toBeTruthy();
      expect(screen.getByText(/Your cards were added/)).toBeTruthy();
      expect(screen.getByText(/don't add them again/)).toBeTruthy();
      // Well past the 1.3 s auto-close (+ leave motion): still open.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1900));
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Your Vault didn't refresh.")).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("refresh succeeds: no note, and the sheet closes itself", async () => {
    const { onClose, add } = await commitOneCopy();
    await act(async () => {
      fireEvent.click(add);
    });
    await screen.findByText(/1 card added\./);
    expect(screen.queryByText(/didn't refresh/)).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 3000 });
  });
});
