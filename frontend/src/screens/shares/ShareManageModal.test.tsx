import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShareManageModal } from "./ShareManageModal";
import { ShareApiError } from "../../api/shares";
import type { ShareRecord } from "../../api/shares";

// BL-205: owner-side share management modal -- create/rename/rotate/revoke,
// plus the empty-state/active-state split (§19.1: at most one active share
// per scope target, so this modal has exactly two shapes, never a list).
// Mocks api/shares.ts directly (same "mock the module, not fetch" shape
// AddCardsModal/SettingsPage tests use for their own API modules).

const { listShares, createShare, renameShare, rotateShare, revokeShare } = vi.hoisted(() => ({
  listShares: vi.fn(),
  createShare: vi.fn(),
  renameShare: vi.fn(),
  rotateShare: vi.fn(),
  revokeShare: vi.fn(),
}));

vi.mock("../../api/shares", async () => {
  const actual = await vi.importActual<typeof import("../../api/shares")>("../../api/shares");
  return { ...actual, listShares, createShare, renameShare, rotateShare, revokeShare };
});

function makeShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    id: 1,
    name: "Bobs big vault",
    scope: "inventory",
    token: "tok-1",
    created_at: "2026-08-11T00:00:00Z",
    revoked: false,
    ...overrides,
  };
}

async function renderModal(onClose = vi.fn()) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<ShareManageModal onClose={onClose} />);
  });
  return { ...utils, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  // jsdom's window.location.origin in the test environment.
  expect(window.location.origin).toBeTruthy();
});

describe("ShareManageModal empty state (BL-205, CREATE)", () => {
  it("shows the create form when there is no active share", async () => {
    listShares.mockResolvedValue([]);
    await renderModal();

    expect(screen.getByRole("dialog", { name: /share your vault/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/share name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Share" })).toBeInTheDocument();
  });

  it("ignores a revoked row when deciding whether an active share exists", async () => {
    listShares.mockResolvedValue([makeShare({ revoked: true })]);
    await renderModal();
    expect(screen.getByRole("button", { name: "Create Share" })).toBeInTheDocument();
  });

  it("creates a share and switches to the active-share panel", async () => {
    listShares.mockResolvedValue([]);
    createShare.mockResolvedValue(makeShare());
    await renderModal();

    fireEvent.change(screen.getByLabelText(/share name/i), {
      target: { value: "Bobs big vault" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Share" }));
    });

    expect(createShare).toHaveBeenCalledWith("Bobs big vault");
    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
    expect(screen.getByDisplayValue(`${window.location.origin}/shared/tok-1`)).toBeInTheDocument();
  });

  it("trims the name before submitting and disables submit while blank", async () => {
    listShares.mockResolvedValue([]);
    await renderModal();

    const submit = screen.getByRole("button", { name: "Create Share" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/share name/i), { target: { value: "  " } });
    expect(submit).toBeDisabled();
  });

  it("shows the specific message on a 409 (active share already exists)", async () => {
    listShares.mockResolvedValue([]);
    createShare.mockRejectedValue(new ShareApiError("active_share_exists", "Creating share", 409));
    await renderModal();

    fireEvent.change(screen.getByLabelText(/share name/i), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Share" }));
    });

    expect(screen.getByText(/an active share already exists/i)).toBeInTheDocument();
  });

  it("shows a generic error message on an unexpected create failure", async () => {
    listShares.mockResolvedValue([]);
    createShare.mockRejectedValue(new Error("boom"));
    await renderModal();

    fireEvent.change(screen.getByLabelText(/share name/i), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Share" }));
    });

    expect(screen.getByText(/something went wrong creating your share/i)).toBeInTheDocument();
  });

  it("shows a friendly error when the initial list fetch fails, not a crash", async () => {
    listShares.mockRejectedValue(new Error("boom"));
    await renderModal();

    expect(screen.getByText(/couldn't load your share/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Share" })).not.toBeInTheDocument();
  });
});

describe("ShareManageModal active-share panel (BL-205, CREATE)", () => {
  it("loads directly into the active-share panel when one exists", async () => {
    listShares.mockResolvedValue([makeShare()]);
    await renderModal();

    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
    expect(screen.getByDisplayValue(`${window.location.origin}/shared/tok-1`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Share" })).not.toBeInTheDocument();
  });

  it("copies the share link to the clipboard and shows transient feedback", async () => {
    listShares.mockResolvedValue([makeShare()]);
    await renderModal();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/shared/tok-1`
    );
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("renames the share -- token stays unchanged", async () => {
    listShares.mockResolvedValue([makeShare()]);
    renameShare.mockResolvedValue(makeShare({ name: "New name" }));
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Bobs big vault");
    fireEvent.change(input, { target: { value: "New name" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Name" }));
    });

    expect(renameShare).toHaveBeenCalledWith(1, "New name");
    expect(screen.getByText("New name")).toBeInTheDocument();
    expect(screen.getByDisplayValue(`${window.location.origin}/shared/tok-1`)).toBeInTheDocument();
  });

  it("cancelling rename restores the original name without calling renameShare", async () => {
    listShares.mockResolvedValue([makeShare()]);
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByDisplayValue("Bobs big vault"), {
      target: { value: "Discarded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(renameShare).not.toHaveBeenCalled();
    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
  });
});

describe("ShareManageModal rotate (BL-205, CREATE)", () => {
  it('shows a "kills the old link" confirm before rotating, cancel returns without calling rotateShare', async () => {
    listShares.mockResolvedValue([makeShare()]);
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Rotate Link" }));
    expect(screen.getByText(/immediately breaks the old one/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(rotateShare).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(`${window.location.origin}/shared/tok-1`)).toBeInTheDocument();
  });

  it("rotates the token on confirm and shows the new link", async () => {
    listShares.mockResolvedValue([makeShare()]);
    rotateShare.mockResolvedValue(makeShare({ token: "tok-2" }));
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Rotate Link" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rotate Link" }));
    });

    expect(rotateShare).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(screen.getByDisplayValue(`${window.location.origin}/shared/tok-2`)).toBeInTheDocument()
    );
  });
});

describe("ShareManageModal revoke (BL-205, CREATE)", () => {
  it("shows a confirm before revoking, cancel returns without calling revokeShare", async () => {
    listShares.mockResolvedValue([makeShare()]);
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByText(/immediately breaks the link/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(revokeShare).not.toHaveBeenCalled();
    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
  });

  it("revokes on confirm and falls back to the empty create-form state", async () => {
    listShares.mockResolvedValue([makeShare()]);
    revokeShare.mockResolvedValue(undefined);
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    });

    expect(revokeShare).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: "Create Share" })).toBeInTheDocument();
  });
});

describe("ShareManageModal dismissal (BL-205, CREATE)", () => {
  it("calls onClose from the close button", async () => {
    listShares.mockResolvedValue([]);
    const { onClose } = await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    listShares.mockResolvedValue([]);
    const { onClose } = await renderModal();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the Cancel button in the create form", async () => {
    listShares.mockResolvedValue([]);
    const { onClose } = await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
