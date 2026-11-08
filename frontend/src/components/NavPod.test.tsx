import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StashProvider } from "../stashes/StashContext";
import { Header } from "./Header";
import type { AppView } from "./Header";

// The desktop Command pod's stash entries and its motion: the Stashes sub
// item exists signed in on the own vault only (never signed out, never on
// the shared vault); hovering it drops the stash menu (rows from the stash
// context, closing 120 ms after the pointer leaves); a row opens that stash,
// All stashes the page; the glide's clip phase lifts 650 ms after a route
// change and never starts under prefers-reduced-motion.

const api = vi.hoisted(() => ({ getStashes: vi.fn(), getStashItems: vi.fn() }));
vi.mock("../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../api/stashes")>()),
  ...api,
}));

const STASHES = [
  { id: 1, name: "Red binder", description: null, created_at: "1", copies: 12 },
  { id: 2, name: "Trade stash", description: null, created_at: "2", copies: 2 },
];

const BASE = {
  onLogout: () => {},
  onSignIn: () => {},
  onChangePassword: () => {},
  onOpenSettings: () => {},
  onOpenAbout: () => {},
  onOpenFeedback: () => {},
};

function setReducedMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: on && q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getStashes.mockResolvedValue(STASHES);
  api.getStashItems.mockResolvedValue([]);
  setReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
});

async function mount(
  opts: {
    email?: string | null;
    view?: AppView;
    shareName?: string | null;
    onNavigateStashes?: (id: number | null) => void;
  } = {}
) {
  const onNavigateStashes = opts.onNavigateStashes ?? vi.fn();
  const email = opts.email === undefined ? "a@b.com" : opts.email;
  const r = render(
    <StashProvider enabled={!!email} paused={opts.view === "shared"}>
      <Header
        userEmail={email}
        {...BASE}
        view={opts.view ?? "cards"}
        shareName={opts.shareName ?? null}
        onNavigateStashes={onNavigateStashes}
      />
    </StashProvider>
  );
  await act(async () => {});
  return { ...r, onNavigateStashes };
}

const menu = () => screen.getByTestId("stash-menu");

describe("Stashes entries", () => {
  it("signed in on the own vault: Collection · Stashes, Stashes current on the page", async () => {
    await mount({ view: "stashes" });
    expect(screen.getByRole("button", { name: "Collection" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Stashes" })).toHaveAttribute("aria-current", "page");
  });

  it("signed out: no Stashes entry, no menu, no names", async () => {
    await mount({ email: null });
    expect(screen.queryByRole("button", { name: "Stashes" })).toBeNull();
    expect(screen.queryByTestId("stash-menu")).toBeNull();
    expect(screen.queryByText("Red binder")).toBeNull();
    expect(api.getStashes).not.toHaveBeenCalled();
  });

  it("on the shared vault: no Stashes entry and no names", async () => {
    await mount({ view: "shared", shareName: "Bob" });
    expect(screen.queryByRole("button", { name: "Stashes" })).toBeNull();
    expect(screen.queryByTestId("stash-menu")).toBeNull();
    expect(screen.queryByText("Red binder")).toBeNull();
  });

  it("with a share held, the own vault lists Collection · Stashes · the share", async () => {
    await mount({ shareName: "Bob" });
    const subs = [...document.querySelectorAll<HTMLElement>(".pod__subs--open [data-sub]")].map(
      (b) => b.dataset.sub
    );
    expect(subs).toEqual(["collection", "stashes", "shared"]);
  });

  it("clicking Stashes opens the page on its default stash", async () => {
    const { onNavigateStashes } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Stashes" }));
    expect(onNavigateStashes).toHaveBeenCalledWith(null);
  });
});

describe("the stash menu", () => {
  it("drops on hover with the stash list and copies, closes 120 ms after leaving", async () => {
    await mount();
    expect(menu()).not.toHaveClass("pod-menu--open");
    expect(menu()).toHaveAttribute("aria-hidden", "true");
    vi.useFakeTimers();
    const wrap = screen.getByRole("button", { name: "Stashes" }).parentElement!;
    fireEvent.mouseEnter(wrap);
    expect(menu()).toHaveClass("pod-menu--open");
    expect([...menu().querySelectorAll(".pod-menu__name")].map((e) => e.textContent)).toEqual([
      "Red binder",
      "Trade stash",
    ]);
    expect([...menu().querySelectorAll(".pod-menu__count")].map((e) => e.textContent)).toEqual([
      "12",
      "2",
    ]);
    fireEvent.mouseLeave(wrap);
    act(() => void vi.advanceTimersByTime(100));
    expect(menu()).toHaveClass("pod-menu--open");
    // Re-entering within the delay keeps it open.
    fireEvent.mouseEnter(wrap);
    act(() => void vi.advanceTimersByTime(200));
    expect(menu()).toHaveClass("pod-menu--open");
    fireEvent.mouseLeave(wrap);
    act(() => void vi.advanceTimersByTime(121));
    expect(menu()).not.toHaveClass("pod-menu--open");
  });

  it("a row opens that stash; All stashes opens the page", async () => {
    const { onNavigateStashes } = await mount();
    const wrap = screen.getByRole("button", { name: "Stashes" }).parentElement!;
    fireEvent.mouseEnter(wrap);
    fireEvent.click(within(menu()).getByRole("button", { name: "Trade stash, 2 copies" }));
    expect(onNavigateStashes).toHaveBeenCalledWith(2);
    expect(menu()).not.toHaveClass("pod-menu--open");
    fireEvent.mouseEnter(wrap);
    fireEvent.click(within(menu()).getByRole("button", { name: "All stashes" }));
    expect(onNavigateStashes).toHaveBeenLastCalledWith(null);
  });

  it("Escape closes it and returns focus to Stashes, without reopening it", async () => {
    await mount();
    const stashes = screen.getByRole("button", { name: "Stashes" });
    fireEvent.mouseEnter(stashes.parentElement!);
    const row = within(menu()).getByRole("button", { name: "Red binder, 12 copies" });
    row.focus();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(menu()).not.toHaveClass("pod-menu--open");
    expect(document.activeElement).toBe(stashes);
    expect(stashes).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape with focus on Stashes closes it; tabbing away and back opens it again", async () => {
    await mount();
    const stashes = screen.getByRole("button", { name: "Stashes" });
    // Keyboard focus on Stashes opens the menu.
    act(() => stashes.focus());
    expect(menu()).toHaveClass("pod-menu--open");
    fireEvent.keyDown(stashes, { key: "Escape" });
    expect(menu()).not.toHaveClass("pod-menu--open");
    expect(document.activeElement).toBe(stashes);
    // No leftover flag: tab away and back, the menu opens.
    vi.useFakeTimers();
    const collection = screen.getByRole("button", { name: "Collection" });
    act(() => collection.focus());
    act(() => void vi.advanceTimersByTime(200));
    expect(menu()).not.toHaveClass("pod-menu--open");
    act(() => stashes.focus());
    expect(menu()).toHaveClass("pod-menu--open");
  });

  it("Escape typed in an unrelated field closes the menu but does not move focus", async () => {
    await mount();
    const field = document.createElement("input");
    document.body.appendChild(field);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Stashes" }).parentElement!);
    expect(menu()).toHaveClass("pod-menu--open");
    act(() => field.focus());
    fireEvent.keyDown(field, { key: "Escape" });
    expect(menu()).not.toHaveClass("pod-menu--open");
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("opens from the keyboard too (focus)", async () => {
    await mount();
    fireEvent.focus(screen.getByRole("button", { name: "Stashes" }));
    expect(menu()).toHaveClass("pod-menu--open");
  });
});

describe("glide motion", () => {
  function views(rerender: (ui: React.ReactElement) => void, view: AppView) {
    rerender(
      <StashProvider enabled>
        <Header userEmail="a@b.com" {...BASE} view={view} onNavigateStashes={() => {}} />
      </StashProvider>
    );
  }

  it("clips the unfolding subsections, then lifts the clip after 650 ms", async () => {
    const { rerender } = await mount();
    vi.useFakeTimers();
    views(rerender, "deck-check");
    expect(document.querySelector(".pod__subs--clip")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(649));
    expect(document.querySelector(".pod__subs--clip")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(document.querySelector(".pod__subs--clip")).toBeNull();
  });

  it("under prefers-reduced-motion never enters the clip phase", async () => {
    setReducedMotion(true);
    const { rerender } = await mount();
    views(rerender, "deck-check");
    expect(document.querySelector(".pod__subs--clip")).toBeNull();
  });

  it("folds the subsections of the item that is not lit (hidden from the a11y tree)", async () => {
    await mount({ view: "deck-check" });
    const vaultSubs = document.querySelector(".pod__item--vault .pod__subs")!;
    expect(vaultSubs).toHaveAttribute("aria-hidden", "true");
    expect((vaultSubs as HTMLElement).style.maxWidth).toBe("0px");
    expect(screen.getByRole("button", { name: "Deck Check" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
