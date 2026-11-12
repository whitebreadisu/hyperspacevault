import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ShareManageModal } from "./ShareManageModal";
import { ShareApiError } from "../../api/shares";
import { ApiError } from "../../api/errors";
import type { ShareRecord } from "../../api/shares";
import type { Stash } from "../../api/stashes";
import { ShareLinksProvider } from "../../shares/ShareLinksContext";
import { StashProvider } from "../../stashes/StashContext";

// The share window (App Spec §19.1 owner screens): one window for the vault
// link and every stash link -- Create / Link / Confirm per link, the stash
// link's fixed share name with Rename stash, and the "Your links · N" list.
// Mocks api/shares.ts and api/stashes.ts (the "mock the module, not fetch"
// shape the other modal tests use) behind stateful doubles, since the window
// re-reads the links after every write; renders under the real StashProvider
// and ShareLinksProvider, as the app does.
//
// Dispositions against the first sharing suite this file replaces (it said "this
// modal has exactly two shapes, never a list"):
//   - every earlier test is ported: the same behaviour, with the window's new
//     copy ("Create share", "New link", the new confirm sentences, the title
//     "Share your Vault") and the links read from the owner-links source;
//   - "exactly two shapes, never a list" is replaced: one live link still
//     shows no list (the "hidden with one link" test), and two or more show
//     "Your links" (the links-list tests);
//   - "ignores a revoked row" is ported: the server lists live links only now,
//     and the source still drops a revoked row.

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

const stashApi = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  updateStash: vi.fn(),
}));
vi.mock("../../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../../api/stashes")>()),
  ...stashApi,
}));

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("../../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../../analytics/analytics")>()),
  capture,
}));

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
const stashShare = (stashId: number, overrides: Partial<ShareRecord> = {}) =>
  makeShare({
    id: 100 + stashId,
    name: "Jeremy",
    scope: "stash",
    token: `tok-s${stashId}`,
    target_id: stashId,
    ...overrides,
  });

const stash = (id: number, name: string): Stash => ({
  id,
  name,
  description: id === 2 ? "Doubles for trades" : null,
  created_at: "2026-11-0" + id,
  copies: 0,
});

// The doubles' state: the live links and the caller's stashes.
let live: ShareRecord[];
let stashes: Stash[];

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  // jsdom's window.location.origin in the test environment.
  expect(window.location.origin).toBeTruthy();
  live = [];
  stashes = [stash(1, "Red binder"), stash(2, "Trade stash"), stash(3, "With Bob")];
  listShares.mockImplementation(async () => live.map((s) => ({ ...s })));
  createShare.mockImplementation(async (name: string, stashId?: number) => {
    const s =
      stashId == null
        ? makeShare({ name })
        : stashShare(stashId, { name, stash_name: stashes.find((x) => x.id === stashId)?.name });
    live = [...live, s];
    return s;
  });
  renameShare.mockImplementation(async (id: number, name: string) => {
    live = live.map((s) => (s.id === id ? { ...s, name } : s));
    return live.find((s) => s.id === id)!;
  });
  rotateShare.mockImplementation(async (id: number) => {
    live = live.map((s) => (s.id === id ? { ...s, token: s.token + "-new" } : s));
    return live.find((s) => s.id === id)!;
  });
  revokeShare.mockImplementation(async (id: number) => {
    live = live.filter((s) => s.id !== id);
  });
  stashApi.getStashes.mockImplementation(async () => stashes.map((s) => ({ ...s })));
  stashApi.getStashItems.mockResolvedValue([]);
  stashApi.updateStash.mockImplementation(async (id: number, patch: Partial<Stash>) => {
    stashes = stashes.map((s) => (s.id === id ? { ...s, ...patch } : s));
    return stashes.find((s) => s.id === id)!;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderModal(opts: { stashId?: number; onClose?: () => void } = {}) {
  const onClose = opts.onClose ?? vi.fn();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <StashProvider enabled uid="u1">
        <ShareLinksProvider enabled uid="u1">
          <ShareManageModal onClose={onClose} stashId={opts.stashId} />
        </ShareLinksProvider>
      </StashProvider>
    );
  });
  // The stash list and the links have landed.
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  return { ...utils, onClose };
}

const url = (token: string) => `${window.location.origin}/shared/${token}`;
// A stash link is served at /shared/stash/<token> (the viewer's route).
const surl = (token: string) => `${window.location.origin}/shared/stash/${token}`;

describe("vault link: Create (ported)", () => {
  it("shows the create form when there is no active share", async () => {
    await renderModal();

    expect(screen.getByRole("dialog", { name: "Share your Vault" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create a secret link that lets anyone with it view your Vault — cards, quantities, prices and value. Read-only, no account needed."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Share name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create share" })).toBeInTheDocument();
    // The vault link has no fixed-name hint.
    expect(screen.queryByText(/can’t be changed later/)).not.toBeInTheDocument();
  });

  it("ignores a revoked row when deciding whether an active share exists", async () => {
    live = [makeShare({ revoked: true })];
    await renderModal();
    expect(screen.getByRole("button", { name: "Create share" })).toBeInTheDocument();
  });

  it("creates a share and switches to the link panel; share_created says vault", async () => {
    await renderModal();

    fireEvent.change(screen.getByLabelText("Share name"), {
      target: { value: "Bobs big vault" },
    });
    expect(screen.getByText("14/30")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });

    expect(createShare).toHaveBeenCalledWith("Bobs big vault", undefined);
    expect(capture).toHaveBeenCalledWith("share_created", { what: "vault" });
    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
  });

  it("trims the name before submitting and disables submit while blank", async () => {
    await renderModal();

    const submit = screen.getByRole("button", { name: "Create share" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "  " } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "  Bob  " } });
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(createShare).toHaveBeenCalledWith("Bob", undefined);
  });

  it("shows the specific message on a 409 (active share already exists)", async () => {
    createShare.mockRejectedValue(new ShareApiError("active_share_exists", "Creating share", 409));
    await renderModal();

    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });

    expect(screen.getByText(/an active share already exists/i)).toBeInTheDocument();
  });

  it("shows a generic error message on an unexpected create failure", async () => {
    createShare.mockRejectedValue(new Error("boom"));
    await renderModal();

    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });

    expect(screen.getByText(/something went wrong creating your share/i)).toBeInTheDocument();
  });

  it("shows a friendly error when the initial list fetch fails, not a crash", async () => {
    listShares.mockRejectedValue(new Error("boom"));
    await renderModal();

    expect(await screen.findByText(/couldn't load your share/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create share" })).not.toBeInTheDocument();
  });
});

describe("vault link: Link (ported)", () => {
  it("loads directly into the link panel when one exists", async () => {
    live = [makeShare()];
    await renderModal();

    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
    expect(
      screen.getByText(
        "Anyone with this link can see your Vault — cards, quantities, prices and value. Read-only, no account needed. Stashes stay private."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create share" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename stash" })).not.toBeInTheDocument();
  });

  it("copies the share link to the clipboard and shows Copied! for 2 s", async () => {
    live = [makeShare()];
    await renderModal();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url("tok-1"));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("Rename still renames the vault share name -- token unchanged", async () => {
    live = [makeShare()];
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Bobs big vault");
    fireEvent.change(input, { target: { value: "New name" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Name" }));
    });

    expect(renameShare).toHaveBeenCalledWith(1, "New name");
    expect(stashApi.updateStash).not.toHaveBeenCalled();
    expect(screen.getByText("New name")).toBeInTheDocument();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
  });

  it("cancelling rename restores the original name without calling renameShare", async () => {
    live = [makeShare()];
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

describe("vault link: New link and Revoke (ported)", () => {
  it("New link asks first in the handoff's words; Cancel returns without rotating", async () => {
    live = [makeShare()];
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(
      screen.getByText(
        "A new link replaces this one. The old link stops working at once — anyone still using it loses access. This cannot be undone."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(rotateShare).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
  });

  it("rotates the token on confirm and shows the new link", async () => {
    live = [makeShare()];
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New link" }));
    });

    expect(rotateShare).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.getByDisplayValue(url("tok-1-new"))).toBeInTheDocument());
  });

  it("Revoke asks first ('Your Vault itself is not changed'); Cancel returns", async () => {
    live = [makeShare()];
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(
      screen.getByText(
        "Revoking breaks the link at once — anyone still using it loses access. Your Vault itself is not changed. This cannot be undone."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(revokeShare).not.toHaveBeenCalled();
    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
  });

  it("revokes on confirm and falls back to the empty create form", async () => {
    live = [makeShare()];
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    });

    expect(revokeShare).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: "Create share" })).toBeInTheDocument();
    expect(screen.getByLabelText("Share name")).toHaveValue("");
  });
});

describe("stash link: Create", () => {
  it("titles the window with the stash and pre-fills the vault link's share name", async () => {
    live = [makeShare({ name: "Jeremy" })];
    await renderModal({ stashId: 2 });

    expect(screen.getByRole("dialog", { name: "Share Trade stash" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Share Trade stash" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create a secret link that lets anyone with it view Trade stash — its name, description, cards, counts, prices and value. Read-only, no account needed."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Share name")).toHaveValue("Jeremy");
    const hint = document.querySelector(".share-modal__hint")!;
    expect(hint.textContent).toBe(
      "Filled in from your Vault link. Viewers see Jeremy · Trade stash. The share name can’t be changed later."
    );
    expect(hint.querySelector(".share-modal__hint-strong")!.textContent).toBe(
      "Jeremy · Trade stash"
    );
  });

  it("with no vault link the field is empty and the hint drops its first sentence", async () => {
    await renderModal({ stashId: 2 });

    expect(screen.getByLabelText("Share name")).toHaveValue("");
    const hint = () => document.querySelector(".share-modal__hint")!.textContent;
    expect(hint()).toBe("The share name can’t be changed later.");
    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "Sam" } });
    expect(hint()).toBe("Viewers see Sam · Trade stash. The share name can’t be changed later.");
  });

  it("creates the stash's link (stash_id sent) and shows it; share_created says stash", async () => {
    live = [makeShare({ name: "Jeremy" })];
    await renderModal({ stashId: 2 });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });

    expect(createShare).toHaveBeenCalledWith("Jeremy", 2);
    expect(capture).toHaveBeenCalledWith("share_created", { what: "stash" });
    expect(screen.getByDisplayValue(surl("tok-s2"))).toBeInTheDocument();
    expect(document.querySelector(".share-modal__stashname")!.textContent).toBe("· Trade stash");
  });

  // Replaces "a stash that is gone says so" (fold-in: the window now also
  // re-reads both lists and falls back to the vault link).
  it("a stash that is gone (404): says so, re-reads, falls back to the vault link", async () => {
    await renderModal({ stashId: 2 });
    const stashReads = stashApi.getStashes.mock.calls.length;
    const linkReads = listShares.mock.calls.length;
    // Deleted elsewhere meanwhile.
    stashes = stashes.filter((x) => x.id !== 2);
    createShare.mockRejectedValue(new ShareApiError("stash_not_found", "Creating share", 404));

    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });
    expect(await screen.findByRole("dialog", { name: "Share your Vault" })).toBeInTheDocument();
    expect(screen.getByText("This stash no longer exists.")).toBeInTheDocument();
    expect(stashApi.getStashes.mock.calls.length).toBeGreaterThan(stashReads);
    expect(listShares.mock.calls.length).toBeGreaterThan(linkReads);
  });

  it("a stash that already has a link (409): the stash sentence, then the existing link shows", async () => {
    await renderModal({ stashId: 2 });
    // Made on another device meanwhile.
    live = [stashShare(2)];
    createShare.mockRejectedValue(new ShareApiError("active_share_exists", "Creating share", 409));
    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });
    expect(await screen.findByDisplayValue(surl("tok-s2"))).toBeInTheDocument();
    // The re-read landed (no read held open) and the sentence is still there.
    expect(screen.getByText("This stash already has a share link.")).toBeInTheDocument();
    expect(screen.queryByText(/rename or rotate it/)).not.toBeInTheDocument();
    // It clears on the next action.
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New link" }));
    });
    expect(screen.queryByText("This stash already has a share link.")).not.toBeInTheDocument();
  });

  // Replaces "the 409 sentence" (it held the re-read open; the sentence now
  // survives the re-read, so nothing is held).
  it("the vault's 409 sentence is unchanged and survives the re-read", async () => {
    await renderModal();
    live = [makeShare()];
    createShare.mockRejectedValue(new ShareApiError("active_share_exists", "Creating share", 409));
    fireEvent.change(screen.getByLabelText("Share name"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create share" }));
    });
    expect(await screen.findByDisplayValue(url("tok-1"))).toBeInTheDocument();
    expect(
      screen.getByText(
        "An active share already exists — rename or rotate it instead of creating a new one."
      )
    ).toBeInTheDocument();
  });
});

describe("stash link: Link, Copied, New link, Revoke", () => {
  it("shows the share name · stash, Rename stash (no Rename), the link and the stash note", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });

    expect(document.querySelector(".share-modal__sharename")!.textContent).toBe("Jeremy");
    expect(document.querySelector(".share-modal__stashname")!.textContent).toBe("· Trade stash");
    expect(screen.getByRole("button", { name: "Rename stash" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(surl("tok-s2"))).toBeInTheDocument();
    expect(
      screen.getByText(
        "Anyone with this link can see Trade stash — its name, description, cards, counts, prices and value. Read-only, no account needed. Your Vault and other stashes stay private."
      )
    ).toBeInTheDocument();
  });

  it("Copy shows Copied!", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(surl("tok-s2"));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("New link rotates the stash link's token", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(screen.getByText(/A new link replaces this one\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New link" }));
    });
    expect(rotateShare).toHaveBeenCalledWith(102);
    await waitFor(() => expect(screen.getByDisplayValue(surl("tok-s2-new"))).toBeInTheDocument());
  });

  it("Revoke names the stash, then the window returns to Create for that stash", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal({ stashId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(
      screen.getByText(
        "Revoking breaks the link at once — anyone still using it loses access. Trade stash itself is not changed. This cannot be undone."
      )
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    });

    expect(revokeShare).toHaveBeenCalledWith(102);
    expect(screen.getByRole("dialog", { name: "Share Trade stash" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create share" })).toBeInTheDocument();
    // Pre-filled again from the vault link.
    expect(screen.getByLabelText("Share name")).toHaveValue("Jeremy");
  });
});

describe("stash link: Rename stash", () => {
  it("renames the stash in place (the share name stays); the title follows", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    const field = screen.getByDisplayValue("Trade stash");
    // Name only: no description field in the window.
    expect(screen.queryByText(/Description/)).not.toBeInTheDocument();
    expect(screen.getByText("11/40")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Trade binder" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    // The stash endpoint, description kept; never the share rename.
    expect(stashApi.updateStash).toHaveBeenCalledWith(2, {
      name: "Trade binder",
      description: "Doubles for trades",
    });
    expect(renameShare).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Share Trade binder" })).toBeInTheDocument();
    expect(document.querySelector(".share-modal__stashname")!.textContent).toBe("· Trade binder");
    expect(document.querySelector(".share-modal__sharename")!.textContent).toBe("Jeremy");
  });

  it("a duplicate name is the Stashes page's inline error, Save off until it changes", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    fireEvent.change(screen.getByDisplayValue("Trade stash"), {
      target: { value: "red binder" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "You already have a stash named red binder. Pick another name."
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(stashApi.updateStash).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue("red binder"), { target: { value: "Red binder 2" } });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("Cancel leaves the stash as it was", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    fireEvent.change(screen.getByDisplayValue("Trade stash"), { target: { value: "Gone" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stashApi.updateStash).not.toHaveBeenCalled();
    expect(document.querySelector(".share-modal__stashname")!.textContent).toBe("· Trade stash");
  });
});

describe("Your links · N", () => {
  const list = () => screen.queryByRole("region", { name: "Your links" });

  it("is hidden when the shown link is the owner's only one", async () => {
    live = [makeShare()];
    await renderModal();
    expect(list()).not.toBeInTheDocument();
  });

  it("lists the vault first, then stash links in stash order, the shown one SHOWING", async () => {
    // Server order deliberately scrambled: the window sorts by stash order.
    live = [stashShare(3), makeShare({ name: "Jeremy" }), stashShare(1)];
    await renderModal({ stashId: 3 });

    const region = list()!;
    expect(within(region).getByRole("heading", { name: "Your links · 3" })).toBeInTheDocument();
    const rows = [...region.querySelectorAll(".share-links__row")];
    expect(rows.map((r) => r.querySelector(".share-links__name")!.textContent)).toEqual([
      "Vault",
      "Red binder",
      "With Bob",
    ]);
    expect(rows[2].getAttribute("aria-current")).toBe("true");
    expect(within(rows[2] as HTMLElement).getByText("Showing")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("a row swaps the window to its link in place", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal({ stashId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Show the Vault link" }));

    expect(screen.getByRole("dialog", { name: "Share your Vault" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    // And back again, from the vault window.
    fireEvent.click(screen.getByRole("button", { name: "Show the Trade stash link" }));
    expect(screen.getByRole("dialog", { name: "Share Trade stash" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(surl("tok-s2"))).toBeInTheDocument();
  });

  it("a row's Copy copies that row's link without swapping", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the Trade stash link" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(surl("tok-s2"));
    expect(
      within(list()!).getByRole("button", { name: "Copy the Trade stash link" }).textContent
    ).toBe("Copied!");
    expect(screen.getByRole("dialog", { name: "Share your Vault" })).toBeInTheDocument();
  });

  it("hides while a rename is open", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal({ stashId: 2 });
    expect(list()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    expect(list()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(list()).toBeInTheDocument();
  });

  it("a row's Copied! returns to Copy after 2 s", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the Trade stash link" }));
    });
    const btn = () => within(list()!).getByRole("button", { name: "Copy the Trade stash link" });
    expect(btn().textContent).toBe("Copied!");
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(btn().textContent).toBe("Copied!");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(btn().textContent).toBe("Copy");
  });

  it("is not shown in Create", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    // With Bob has no link: Create.
    await renderModal({ stashId: 3 });
    expect(screen.getByRole("button", { name: "Create share" })).toBeInTheDocument();
    expect(list()).not.toBeInTheDocument();
  });

  it("is not shown in a Confirm", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal({ stashId: 2 });
    expect(list()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(list()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(list()).not.toBeInTheDocument();
  });
});

describe("link URLs", () => {
  it("the vault link copies /shared/<token>, a stash link /shared/stash/<token>", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(url("tok-1"));
    // The list's Copy on the stash row.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the Trade stash link" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(surl("tok-s2"));

    // Swap to the stash link: its field and Copy, and the list's vault Copy.
    fireEvent.click(screen.getByRole("button", { name: "Show the Trade stash link" }));
    expect(screen.getByDisplayValue(surl("tok-s2"))).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(surl("tok-s2"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the Vault link" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(url("tok-1"));
  });
});

describe("reads", () => {
  it("every open reads the links again", async () => {
    const first = await renderModal();
    const reads = listShares.mock.calls.length;
    first.unmount();
    await renderModal();
    expect(listShares.mock.calls.length).toBeGreaterThan(reads);
  });

  it("a failed first read offers Try again, which reads again", async () => {
    listShares.mockRejectedValueOnce(new Error("down"));
    await renderModal();
    expect(await screen.findByText(/couldn't load your share/i)).toBeInTheDocument();
    live = [makeShare()];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByDisplayValue(url("tok-1"))).toBeInTheDocument();
  });

  it("Revoke on a link already revoked elsewhere: re-reads, Create shows, and says why", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });
    live = []; // revoked on another device
    revokeShare.mockRejectedValue(new ApiError("Failed to revoke share: 404", 404));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    });
    expect(await screen.findByRole("button", { name: "Create share" })).toBeInTheDocument();
    expect(screen.getByText("This link was already revoked.")).toBeInTheDocument();
  });

  it("New link on a link already revoked (vault): the same sentence survives into Create", async () => {
    live = [makeShare()];
    await renderModal();
    live = [];
    rotateShare.mockRejectedValue(new ApiError("Failed to rotate share: 404", 404));
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New link" }));
    });
    expect(await screen.findByRole("button", { name: "Create share" })).toBeInTheDocument();
    expect(screen.getByText("This link was already revoked.")).toBeInTheDocument();
  });

  it("the stash list failed to load: the window shows the vault link", async () => {
    stashApi.getStashes.mockRejectedValue(new Error("down"));
    live = [makeShare(), stashShare(2)];
    await renderModal({ stashId: 2 });
    expect(await screen.findByRole("dialog", { name: "Share your Vault" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
  });

  it("a failed New link re-reads too", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });
    const reads = listShares.mock.calls.length;
    rotateShare.mockRejectedValue(new Error("404"));
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New link" }));
    });
    expect(screen.getByText(/something went wrong making a new link/i)).toBeInTheDocument();
    expect(listShares.mock.calls.length).toBeGreaterThan(reads);
  });

  it("an unknown stash id opens the vault link", async () => {
    live = [makeShare()];
    await renderModal({ stashId: 99 });
    expect(screen.getByRole("dialog", { name: "Share your Vault" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(url("tok-1"))).toBeInTheDocument();
  });
});

describe("focus and Escape", () => {
  it("Rename stash gets focus back after a save and after a cancel", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename stash" }));

    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    fireEvent.change(screen.getByDisplayValue("Trade stash"), { target: { value: "Swap box" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename stash" }))
    );
  });

  it("a list swap focuses the new link's title", async () => {
    live = [makeShare({ name: "Jeremy" }), stashShare(2)];
    await renderModal({ stashId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Show the Vault link" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Share your Vault" }));
  });

  it("a revoke returns to Create with focus on the share-name field", async () => {
    live = [stashShare(2)];
    await renderModal({ stashId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Share name")));
  });

  it("Escape ends an in-place rename only; the next Escape closes the window", async () => {
    live = [stashShare(2)];
    const { onClose } = await renderModal({ stashId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Rename stash" }));
    expect(screen.getByDisplayValue("Trade stash")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Trade stash")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename stash" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape ends the vault Rename the same way", async () => {
    live = [makeShare()];
    const { onClose } = await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Bobs big vault")).toBeInTheDocument();
  });
});

describe("dismissal (ported)", () => {
  it("calls onClose from the close button", async () => {
    const { onClose } = await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    const { onClose } = await renderModal();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the Cancel button in the create form", async () => {
    const { onClose } = await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
