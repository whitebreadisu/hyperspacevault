import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BL-251 stage 5a: Settings card (S5-01), Change Password's provider gate
// (S5-02), Delete Account / routes (S5-03 / S5-04), screen_viewed (S5-05).
const auth = vi.hoisted(() => ({
  user: null as null | { email: string; providerData: { providerId: string }[] },
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
    emailVerified: true,
  }),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/settingsLimits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settingsLimits")>()),
  getLimits: vi.fn(),
  putLimits: vi.fn(),
}));

import { capture } from "../../analytics/analytics";
import { getLimits, putLimits } from "../../api/settingsLimits";
import type { LimitCell, LimitsResponseBody } from "../../api/settingsLimits";
import { LimitsProvider, useLimits } from "../../context/LimitsContext";
import { ALL_TYPE_CATEGORIES, CANONICAL_BUCKETS, DEFAULT_LIMITS } from "../../utils/limits";
import { MobileApp } from "../MobileApp";
import { resetRouterForTest } from "../router";
import { SettingsScreen } from "./SettingsScreen";

const PASSWORD_USER = { email: "a@b.test", providerData: [{ providerId: "password" }] };
const GOOGLE_USER = { email: "g@b.test", providerData: [{ providerId: "google.com" }] };

function defaultCells(): LimitCell[] {
  return ALL_TYPE_CATEGORIES.flatMap((category) =>
    CANONICAL_BUCKETS.map((bucket) => ({
      type_category: category,
      limit_bucket: bucket,
      max_quantity: DEFAULT_LIMITS[category],
      is_default: true,
    }))
  );
}

async function goHash(h: string) {
  await act(async () => {
    window.location.hash = h;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

function Probe() {
  const { capMode, cells } = useLimits();
  return (
    <output data-testid="probe">
      {capMode}:{cells?.every((c) => c.max_quantity === null) ? "all-null" : "cells"}
    </output>
  );
}

describe("S5-01 Settings card", () => {
  beforeEach(() => {
    resetRouterForTest();
    window.location.hash = "#/more/settings";
    vi.mocked(getLimits).mockReset();
    vi.mocked(putLimits).mockReset();
  });

  it("dirty enables Save, No limits inerts the steppers, save calls settingsLimits and updates LimitsContext", async () => {
    const body: LimitsResponseBody = { limits: defaultCells(), cap_mode: "hard" };
    vi.mocked(getLimits).mockResolvedValue(body);
    vi.mocked(putLimits).mockImplementation(async (overrides, capMode) => ({
      cap_mode: capMode ?? "hard",
      limits: body.limits.map((c) => {
        const o = overrides.find(
          (x) => x.type_category === c.type_category && x.limit_bucket === c.limit_bucket
        );
        return o ? { ...c, max_quantity: o.max_quantity, is_default: false } : c;
      }),
    }));
    render(
      <LimitsProvider isAuthenticated>
        <SettingsScreen fromMore={false} onDeleteAccount={vi.fn()} />
        <Probe />
      </LimitsProvider>
    );

    // Loading state is desktop's own.
    expect(screen.getByText("Loading settings…")).toBeTruthy();
    const save = await screen.findByRole("button", { name: "Save changes" });
    const discard = screen.getByRole("button", { name: "Discard changes" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect((discard as HTMLButtonElement).disabled).toBe(true);

    // Floors: Leaders & Bases 1, all other cards 3 -- decrease is inert at the floor.
    const lbDec = screen.getByRole("button", { name: "Decrease Leaders & Bases cap" });
    const lbInc = screen.getByRole("button", { name: "Increase Leaders & Bases cap" });
    const otherDec = screen.getByRole("button", { name: "Decrease All other cards cap" });
    expect((lbDec as HTMLButtonElement).disabled).toBe(true);
    expect((otherDec as HTMLButtonElement).disabled).toBe(true);

    // Dirty: Save and Discard unlock; Discard locks it again.
    fireEvent.click(lbInc);
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect((discard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(discard);
    expect((save as HTMLButtonElement).disabled).toBe(true);

    // No limits makes both steppers inert.
    fireEvent.click(screen.getByRole("radio", { name: /No limits/ }));
    expect((lbInc as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Increase All other cards cap" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Saved.")).toBeNull();

    fireEvent.click(save);
    await waitFor(() => expect(putLimits).toHaveBeenCalledTimes(1));
    const [overrides, capMode] = vi.mocked(putLimits).mock.calls[0];
    expect(capMode).toBe("hard");
    expect(overrides).toHaveLength(30);
    expect(overrides.every((o) => o.max_quantity === null)).toBe(true);

    // LimitsContext now serves the saved matrix; "Saved." shows; editing clears it.
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(screen.getByTestId("probe").textContent).toBe("hard:all-null");
    fireEvent.click(screen.getByRole("radio", { name: /Soft cap/ }));
    expect(screen.queryByText("Saved.")).toBeNull();

    // Usage Analytics checkbox and the Danger Zone are part of the card.
    expect(screen.getByRole("checkbox", { name: /Share anonymous usage analytics/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeTruthy();
  });

  it("S5-01 F2: a failed PUT shows desktop's alert and no 'Saved.'; the next success shows it", async () => {
    const body: LimitsResponseBody = { limits: defaultCells(), cap_mode: "hard" };
    vi.mocked(getLimits).mockResolvedValue(body);
    vi.mocked(putLimits).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(putLimits).mockImplementation(async (_overrides, capMode) => ({
      cap_mode: capMode ?? "hard",
      limits: body.limits.map((c) => ({ ...c })),
    }));
    render(
      <LimitsProvider isAuthenticated>
        <SettingsScreen fromMore={false} onDeleteAccount={vi.fn()} />
      </LimitsProvider>
    );
    const save = await screen.findByRole("button", { name: "Save changes" });
    fireEvent.click(screen.getByRole("radio", { name: /No limits/ }));
    fireEvent.click(save);
    await waitFor(() => expect(putLimits).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Saved.")).toBeNull();
    // Retry succeeds: the status line appears once, from the new tap.
    fireEvent.click(save);
    await waitFor(() => expect(putLimits).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("Delete Account in the Danger Zone calls the delete trigger", async () => {
    vi.mocked(getLimits).mockResolvedValue({ limits: defaultCells(), cap_mode: "hard" });
    const onDelete = vi.fn();
    render(
      <LimitsProvider isAuthenticated>
        <SettingsScreen fromMore onDeleteAccount={onDelete} />
      </LimitsProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Account" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("S5-02 / S5-09 hidden without a password provider", () => {
  beforeEach(() => {
    resetRouterForTest();
    window.location.hash = "#/more";
  });

  it("password account: More row and account menu entry route to the layer", async () => {
    auth.user = PASSWORD_USER;
    render(<MobileApp />);
    await act(async () => {});
    expect(document.querySelector('[data-more="password"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-more="password"]')!);
    await goHash(window.location.hash);
    expect(window.location.hash).toBe("#/more/password");
    expect(screen.getByRole("dialog", { name: "Change Password" })).toBeTruthy();
  });

  it("Google-only account: no row, no menu entry, and the deep link falls back to More", async () => {
    auth.user = GOOGLE_USER;
    render(<MobileApp />);
    await act(async () => {});
    expect(document.querySelector('[data-more="settings"]')).not.toBeNull();
    expect(document.querySelector('[data-more="password"]')).toBeNull();
    fireEvent.click(document.querySelector(".m-acct__hit")!);
    const items = [...document.querySelectorAll(".m-acct__menu [role=menuitem]")].map(
      (n) => n.textContent
    );
    expect(items).toEqual(["Settings", "About & Legal", "Log Out"]);
    await goHash("#/more/password");
    expect(window.location.hash).toBe("#/more");
    expect(document.querySelector(".m-authlayer")).toBeNull();
  });
});

describe("S5-03 / S5-04 delete layer and routes", () => {
  beforeEach(() => {
    resetRouterForTest();
    auth.user = PASSWORD_USER;
    window.location.hash = "#/more";
    vi.mocked(getLimits).mockResolvedValue({ limits: defaultCells(), cap_mode: "hard" });
  });

  it("Settings' Danger Zone opens desktop's Delete Account over Settings; no ComingSoon remains", async () => {
    render(
      <LimitsProvider isAuthenticated>
        <MobileApp />
      </LimitsProvider>
    );
    await act(async () => {});
    fireEvent.click(document.querySelector('[data-more="settings"]')!);
    await goHash(window.location.hash);
    expect(window.location.hash).toBe("#/more/settings");
    expect(document.querySelector(".m-soon")).toBeNull();
    expect(document.querySelector(".m-settings")).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Account" }));
    await goHash(window.location.hash);
    expect(window.location.hash).toBe("#/more/delete");
    const dlg = screen.getByRole("dialog", { name: "Delete Account" });
    // Step one: warning + current password; Continue -> "Are You Sure?" + DELETE gate.
    fireEvent.change(dlg.querySelector("input[type=password]")!, { target: { value: "pw" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Continue" }));
    expect(within(dlg).getByText("Are You Sure?")).toBeTruthy();
    const gate = within(dlg).getByRole("button", { name: "Delete Account" }) as HTMLButtonElement;
    expect(gate.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    expect(gate.disabled).toBe(false);
    // Settings stays mounted beneath the layer.
    expect(document.querySelector(".m-settings")).not.toBeNull();
  });
});

describe("S5-05 screen_viewed for Settings, Password, Delete", () => {
  const spy = vi.mocked(capture);
  const views = () => spy.mock.calls.filter(([e]) => e === "screen_viewed").map(([, p]) => p);

  beforeEach(() => {
    spy.mockClear();
    resetRouterForTest();
    auth.user = PASSWORD_USER;
    window.location.hash = "#/more";
  });

  it("settings, delete (layer), password (layer) -- once each, layout phone, no repeat on close", async () => {
    render(<MobileApp />);
    await act(async () => {});
    await goHash("#/more/settings");
    await goHash("#/more/delete");
    await goHash("#/more/settings");
    await goHash("#/more");
    await goHash("#/more/password");
    await goHash("#/more");
    expect(views()).toEqual([
      { screen: "more", layout: "phone" },
      { screen: "settings", layout: "phone" },
      { screen: "delete", layout: "phone" },
      { screen: "more", layout: "phone" },
      { screen: "password", layout: "phone" },
    ]);
  });
});

describe("S5-F1 screen_viewed after a layer closes onto an unreported screen", () => {
  const spy = vi.mocked(capture);
  const views = () => spy.mock.calls.filter(([e]) => e === "screen_viewed").map(([, p]) => p);

  beforeEach(() => {
    spy.mockClear();
    resetRouterForTest();
  });

  it("cold deep link #/more/password then close: password, then more once", async () => {
    auth.user = PASSWORD_USER;
    window.location.hash = "#/more/password";
    render(<MobileApp />);
    await act(async () => {});
    await goHash("#/more");
    expect(views()).toEqual([
      { screen: "password", layout: "phone" },
      { screen: "more", layout: "phone" },
    ]);
  });

  it("Google-only deep link #/more/password sends no password view; More reported once", async () => {
    auth.user = GOOGLE_USER;
    window.location.hash = "#/more/password";
    render(<MobileApp />);
    await act(async () => {});
    expect(window.location.hash).toBe("#/more");
    expect(views()).toEqual([{ screen: "more", layout: "phone" }]);
  });

  it("signed-out #/more/sharing from About redirects to More, which is reported once", async () => {
    auth.user = null;
    window.location.hash = "#/about";
    render(<MobileApp />);
    await act(async () => {});
    await goHash("#/more/sharing");
    expect(views()).toEqual([
      { screen: "about", layout: "phone" },
      { screen: "more", layout: "phone" },
    ]);
  });
});

describe("S5-F7 post-delete return", () => {
  it("when the user signs out on Settings, the shell returns to the anonymous Vault", async () => {
    resetRouterForTest();
    auth.user = PASSWORD_USER;
    vi.mocked(getLimits).mockResolvedValue({ limits: defaultCells(), cap_mode: "hard" });
    window.location.hash = "#/more/settings";
    const ui = (
      <LimitsProvider isAuthenticated>
        <MobileApp />
      </LimitsProvider>
    );
    const { rerender } = render(ui);
    const ui2 = (
      <LimitsProvider isAuthenticated>
        <MobileApp />
      </LimitsProvider>
    );
    await act(async () => {});
    expect(window.location.hash).toBe("#/more/settings");
    auth.user = null;
    rerender(ui2);
    await waitFor(() => expect(window.location.hash).toBe("#/vault"));
  });
});
