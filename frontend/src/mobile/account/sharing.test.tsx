import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BL-251 stage 5b: Sharing layer (S5-07), verify-email banner placement
// (S5-08), Google-only branches (S5-09), analytics (S5-10).
const auth = vi.hoisted(() => ({
  user: null as null | { email: string; providerData: { providerId: string }[] },
  emailVerified: true,
}));
vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: auth.user,
    loading: false,
    logout: vi.fn(),
    emailVerified: auth.emailVerified,
    refreshEmailVerified: vi.fn(),
  }),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/shares", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/shares")>()),
  listShares: vi.fn(),
  createShare: vi.fn(),
  renameShare: vi.fn(),
  rotateShare: vi.fn(),
  revokeShare: vi.fn(),
}));

import { capture, SCREEN_VIEWED_SCREENS } from "../../analytics/analytics";
import type { ShareRecord } from "../../api/shares";
import { createShare, listShares, renameShare, revokeShare, rotateShare } from "../../api/shares";
import { MobileApp } from "../MobileApp";
import { resetRouterForTest } from "../router";

const PASSWORD_USER = { email: "a@b.test", providerData: [{ providerId: "password" }] };
const GOOGLE_USER = { email: "g@b.test", providerData: [{ providerId: "google.com" }] };

const share = (over: Partial<ShareRecord> = {}): ShareRecord => ({
  id: 1,
  name: "Bobs vault",
  scope: "inventory",
  token: "tok-1",
  created_at: "2026-10-11T12:00:00Z",
  revoked: false,
  ...over,
});

async function goHash(h: string) {
  await act(async () => {
    window.location.hash = h;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

const dialog = () => screen.getByRole("dialog", { name: "Share Your Vault" });

describe("S5-07 Sharing layer", () => {
  beforeEach(() => {
    resetRouterForTest();
    auth.user = PASSWORD_USER;
    auth.emailVerified = true;
    for (const f of [listShares, createShare, renameShare, rotateShare, revokeShare])
      vi.mocked(f).mockReset();
    window.location.hash = "#/more";
  });

  it("More's Sharing row opens desktop's modal over More: empty -> create -> active -> rename -> rotate gate -> revoke gate -> empty", async () => {
    vi.mocked(listShares).mockResolvedValue([]);
    vi.mocked(createShare).mockResolvedValue(share());
    vi.mocked(renameShare).mockImplementation(async (_id, name) => share({ name }));
    vi.mocked(rotateShare).mockResolvedValue(share({ token: "tok-2" }));
    vi.mocked(revokeShare).mockResolvedValue();
    render(<MobileApp />);
    await act(async () => {});
    fireEvent.click(document.querySelector('[data-more="sharing"]')!);
    await goHash(window.location.hash);
    expect(window.location.hash).toBe("#/more/sharing");
    // The layer sits over More, which stays mounted (and inert) beneath it.
    expect(document.querySelector(".m-more")).not.toBeNull();
    expect(document.querySelector(".m-acctlayer")).not.toBeNull();
    expect(document.querySelector(".m-soon")).toBeNull();

    // Empty state = the create form; Create stays locked until a name is typed.
    const d = dialog();
    const create = await within(d).findByRole("button", { name: "Create Share" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Share Name"), { target: { value: "Bobs vault" } });
    fireEvent.click(create);

    // Active: the name, the link, Copy / Rotate Link / Revoke.
    const link = (await within(d).findByDisplayValue(/\/shared\/tok-1$/)) as HTMLInputElement;
    expect(link.readOnly).toBe(true);
    expect(within(d).getByText("Bobs vault")).toBeTruthy();
    expect(within(d).getByRole("button", { name: "Copy" })).toBeTruthy();

    // Rename.
    fireEvent.click(within(d).getByRole("button", { name: "Rename" }));
    fireEvent.change(within(d).getByLabelText("Share Name"), { target: { value: "Renamed" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save Name" }));
    expect(await within(d).findByText("Renamed")).toBeTruthy();
    expect(renameShare).toHaveBeenCalledWith(1, "Renamed");

    // Rotate: confirm gate first (Cancel backs out), then the new token.
    fireEvent.click(within(d).getByRole("button", { name: "Rotate Link" }));
    expect(within(d).getByText(/immediately breaks the old one/)).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }));
    expect(rotateShare).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Rotate Link" }));
    fireEvent.click(within(d).getByRole("button", { name: "Rotate Link" }));
    expect(await within(d).findByDisplayValue(/\/shared\/tok-2$/)).toBeTruthy();

    // Revoke: confirm gate, then back to the empty create form.
    fireEvent.click(within(d).getByRole("button", { name: "Revoke" }));
    expect(within(d).getByText(/Revoking immediately breaks the link/)).toBeTruthy();
    expect(revokeShare).not.toHaveBeenCalled();
    fireEvent.click(within(d).getByRole("button", { name: "Revoke" }));
    expect(await within(d).findByRole("button", { name: "Create Share" })).toBeTruthy();
    expect(revokeShare).toHaveBeenCalledWith(1);

    // X closes the layer back onto More.
    fireEvent.click(within(d).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(window.location.hash).toBe("#/more"));
    await goHash(window.location.hash);
    expect(document.querySelector(".m-acctlayer")).toBeNull();
  });

  it("loading and error states are desktop's own", async () => {
    let reject!: () => void;
    vi.mocked(listShares).mockReturnValue(
      new Promise((_, r) => {
        reject = () => r(new Error("x"));
      })
    );
    window.location.hash = "#/more/sharing";
    render(<MobileApp />);
    await act(async () => {});
    expect(within(dialog()).getByText("Loading…")).toBeTruthy();
    await act(async () => reject());
    expect(
      await within(dialog()).findByText("Couldn't load your share. Please try again.")
    ).toBeTruthy();
  });

  it("signed out at the deep link: More with sign-in raised, no sharing layer", async () => {
    auth.user = null;
    vi.mocked(listShares).mockResolvedValue([]);
    window.location.hash = "#/more/sharing";
    render(<MobileApp />);
    await act(async () => {});
    expect(window.location.hash).toBe("#/more");
    expect(document.querySelector(".m-acctlayer")).toBeNull();
    expect(listShares).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Log In" })).toBeTruthy();
  });
});

describe("S5-08 verify-email banner", () => {
  beforeEach(() => {
    resetRouterForTest();
    window.location.hash = "#/vault";
  });
  const banner = () => document.querySelector(".verify-email-banner");

  it("signed in + unverified: desktop's banner is the first child of the list area, under the header", async () => {
    auth.user = PASSWORD_USER;
    auth.emailVerified = false;
    render(<MobileApp />);
    await act(async () => {});
    const b = banner()!;
    expect(b).not.toBeNull();
    expect(b.textContent).toContain("Verify your email to manage inventory");
    expect(b.parentElement!.classList.contains("m-vault__below")).toBe(true);
    expect(b.parentElement!.firstElementChild).toBe(b);
    // No close button (dismiss-proof): Resend + I've verified only.
    expect([...b.querySelectorAll("button")].map((x) => x.textContent)).toEqual([
      "Resend email",
      "I've verified",
    ]);
    // Not part of the collapsing header.
    expect(b.closest(".m-vh")).toBeNull();
  });

  it("not shown when verified or anonymous", async () => {
    auth.user = PASSWORD_USER;
    auth.emailVerified = true;
    const first = render(<MobileApp />);
    await act(async () => {});
    expect(banner()).toBeNull();
    first.unmount();
    resetRouterForTest();
    auth.user = null;
    auth.emailVerified = false;
    render(<MobileApp />);
    await act(async () => {});
    expect(banner()).toBeNull();
  });

  it("More keeps its shortened sentence (the banner is on the Vault, not More)", async () => {
    auth.user = PASSWORD_USER;
    auth.emailVerified = false;
    window.location.hash = "#/more";
    render(<MobileApp />);
    await act(async () => {});
    expect(banner()).toBeNull();
    fireEvent.click(document.querySelector('[data-more="importexport"]')!);
    expect(screen.getByText("Verify your email to import or export your collection.")).toBeTruthy();
  });
});

describe("S5-09 Google-only accounts", () => {
  beforeEach(() => {
    resetRouterForTest();
    auth.emailVerified = true;
    window.location.hash = "#/more";
  });

  it("no Change Password row or menu entry; Sharing and Settings stay; Delete uses the Google reauth copy", async () => {
    auth.user = GOOGLE_USER;
    vi.mocked(listShares).mockResolvedValue([]);
    render(<MobileApp />);
    await act(async () => {});
    expect(document.querySelector('[data-more="password"]')).toBeNull();
    expect(document.querySelector('[data-more="sharing"]')).not.toBeNull();
    fireEvent.click(document.querySelector(".m-acct__hit")!);
    const items = [...document.querySelectorAll(".m-acct__menu [role=menuitem]")].map(
      (n) => n.textContent
    );
    expect(items).not.toContain("Change Password");
    // Delete Account (desktop's modal, unchanged) asks for Google, not a password.
    await goHash("#/more/delete");
    const dlg = screen.getByRole("dialog", { name: "Delete Account" });
    expect(within(dlg).getByText(/reauthenticate with Google/)).toBeTruthy();
    expect(dlg.querySelector("input[type=password]")).toBeNull();
  });

  it("a password account keeps the Change Password row", async () => {
    auth.user = PASSWORD_USER;
    render(<MobileApp />);
    await act(async () => {});
    expect(document.querySelector('[data-more="password"]')).not.toBeNull();
  });
});

describe("S5-10 analytics for Sharing", () => {
  const spy = vi.mocked(capture);
  const views = () => spy.mock.calls.filter(([e]) => e === "screen_viewed").map(([, p]) => p);

  beforeEach(() => {
    spy.mockClear();
    resetRouterForTest();
    auth.user = PASSWORD_USER;
    auth.emailVerified = true;
    window.location.hash = "#/more";
    vi.mocked(listShares).mockResolvedValue([]);
    vi.mocked(createShare).mockResolvedValue(share());
  });

  it("screen_viewed {sharing, phone} once (not again on close); share_created is desktop's own event", async () => {
    render(<MobileApp />);
    await act(async () => {});
    await goHash("#/more/sharing");
    const d = dialog();
    fireEvent.change(await within(d).findByLabelText("Share Name"), { target: { value: "X" } });
    fireEvent.click(within(d).getByRole("button", { name: "Create Share" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("share_created", {}));
    await goHash("#/more");
    expect(views()).toEqual([
      { screen: "more", layout: "phone" },
      { screen: "sharing", layout: "phone" },
    ]);
    // Additive screen value only; desktop sends no rotate / revoke events.
    expect(SCREEN_VIEWED_SCREENS).toContain("sharing");
    expect(spy.mock.calls.map(([e]) => String(e)).filter((e) => e.startsWith("share_"))).toEqual([
      "share_created",
    ]);
  });
});
