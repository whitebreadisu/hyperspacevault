import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stash, StashItem } from "../../api/stashes";
import { LimitsProvider } from "../../context/LimitsContext";
import type { ShareRecord } from "../../api/shares";
import { ShareLinksProvider } from "../../shares/ShareLinksContext";
import { StashProvider } from "../../stashes/StashContext";
import type { InventoryCard } from "../../utils/inventory";
import { VaultDataValue } from "../../vault/useVaultData";
import type { VaultData } from "../../vault/useVaultData";
import { MobileNav } from "../MobileNav";
import { parseHash, resetRouterForTest } from "../router";
import { SheetHost } from "../Sheet";
import { phoneCard } from "../vault/phoneCardFixtures";
import { StashesScreen } from "./StashesScreen";
import { StashScreen } from "./StashScreen";

// Phone 1d and the bottom bar's tap-again Vault menu: the menu's items per
// state (signed in, signed out, a share held), its choices and closing;
// the Stashes list (rows, edit sheet with a duplicate name, delete, create,
// no stashes); inside a stash: the panel in the Vault's header frame
// (expanded panel below the bar, COPIES / VALUE in the collapsed strip slot,
// collapsing by useCollapse on scroll), the resting Return -> active row
// (− / chip / trash) reverting on another row's tap or on a scroll, Undo,
// the description popover, the gallery, the stash's own sort sheet and
// delete from inside the stash. Bulk Select was removed (R1-14).

const api = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  createStash: vi.fn(),
  updateStash: vi.fn(),
  deleteStash: vi.fn(),
  returnStashItems: vi.fn(),
  restoreStashItems: vi.fn(),
}));
vi.mock("../../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../../api/stashes")>()),
  ...api,
}));
// The owner's share links (the list marks, the stash's Share, the delete
// line): empty unless a test sets `shares`.
const shareApi = vi.hoisted(() => ({ listShares: vi.fn() }));
vi.mock("../../api/shares", async (orig) => ({
  ...(await orig<typeof import("../../api/shares")>()),
  ...shareApi,
}));
vi.mock("../../context/AuthContext", async (orig) => ({
  ...(await orig<typeof import("../../context/AuthContext")>()),
  useAuth: () => ({ user: { email: "a@b.com" }, emailVerified: true, loading: false }),
}));
vi.mock("../../analytics/analytics", async (orig) => ({
  ...(await orig<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));

const LUKE = phoneCard({
  id: 1,
  name: "Luke Skywalker",
  subtitle: "Faithful Friend",
  number: "5",
  variants: [
    {
      id: 11,
      finish: "Standard",
      number: "5",
      qty: 2,
      market: 4,
      frontImage: "https://cdn.example/cards/SOR_005.png",
    },
    {
      id: 12,
      finish: "Hyperspace",
      number: "269",
      qty: 1,
      market: 9,
      frontImage: "https://cdn.example/cards/SOR_269.png",
    },
  ],
});
const VADER = phoneCard({
  id: 2,
  name: "Darth Vader",
  type: "Leader",
  number: "10",
  variants: [{ id: 21, finish: "Standard", number: "10", qty: 1, market: 2 }],
});
const CARDS = [LUKE, VADER];

let stashes: Stash[];
let items: StashItem[];
let shares: ShareRecord[];
const stashLink = (stashId: number, name = "Jeremy"): ShareRecord => ({
  id: 100 + stashId,
  name,
  scope: "stash",
  token: "tok-s" + stashId,
  created_at: "2026-11-12T00:00:00Z",
  revoked: false,
  target_id: stashId,
});
const mk = (id: number, name: string, description: string | null = null): Stash => ({
  id,
  name,
  description,
  created_at: String(id),
  copies: 0,
});

/** The backend's answer: the stash's remaining quantity for each printing
 * sent (0 = gone) and its new total. */
function moved(id: number, moves: { variant_id: number; quantity: number }[]) {
  const held = (v: number) =>
    items.find((i) => i.stash_id === id && i.variant_id === v)?.quantity ?? 0;
  return {
    stash_id: id,
    copies: items.filter((i) => i.stash_id === id).reduce((n, i) => n + i.quantity, 0),
    items: moves.map((m) => ({ variant_id: m.variant_id, quantity: held(m.variant_id) })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRouterForTest();
  window.location.hash = "";
  shares = [];
  shareApi.listShares.mockImplementation(async () => shares.map((x) => ({ ...x })));
  stashes = [
    mk(1, "Red binder", "Blue binder on the shelf, sleeved, by set"),
    mk(2, "Trade stash"),
  ];
  items = [
    { stash_id: 1, variant_id: 11, quantity: 2 },
    { stash_id: 1, variant_id: 12, quantity: 1 },
    { stash_id: 1, variant_id: 21, quantity: 1 },
  ];
  api.getStashes.mockImplementation(async () =>
    stashes.map((s) => ({
      ...s,
      copies: items.filter((i) => i.stash_id === s.id).reduce((n, i) => n + i.quantity, 0),
    }))
  );
  api.getStashItems.mockImplementation(async () => items.map((i) => ({ ...i })));
  api.returnStashItems.mockImplementation(
    async (id: number, moves: { variant_id: number; quantity: number }[]) => {
      for (const m of moves) {
        const it = items.find((i) => i.stash_id === id && i.variant_id === m.variant_id)!;
        it.quantity -= m.quantity;
      }
      items = items.filter((i) => i.quantity > 0);
      return moved(id, moves);
    }
  );
  api.restoreStashItems.mockImplementation(
    async (id: number, moves: { variant_id: number; quantity: number }[]) => {
      for (const m of moves) {
        const it = items.find((i) => i.stash_id === id && i.variant_id === m.variant_id);
        if (it) it.quantity += m.quantity;
        else items.push({ stash_id: id, ...m });
      }
      return moved(id, moves);
    }
  );
  api.deleteStash.mockImplementation(async (id: number) => {
    stashes = stashes.filter((s) => s.id !== id);
    items = items.filter((i) => i.stash_id !== id);
  });
  api.createStash.mockImplementation(async (name: string) => {
    const s = mk(5, name);
    stashes.push(s);
    return s;
  });
});
afterEach(() => {
  window.location.hash = "";
});

function data(cards: InventoryCard[]): VaultData {
  return {
    cards,
    catalogWithQuantities: [],
    quantities: {},
    readOnly: false,
    sets: [],
    setOrder: {},
    setNameByCode: {},
    isAuthenticated: true,
    loading: false,
    error: null,
    refreshQuantities: async () => {},
    patchQuantity: () => {},
  };
}

function Shell({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  return (
    <LimitsProvider isAuthenticated={false}>
      <VaultDataValue value={data(CARDS)}>
        <StashProvider enabled={enabled}>
          <ShareLinksProvider enabled={enabled}>
            <div className="m-app">
              <SheetHost>{children}</SheetHost>
            </div>
          </ShareLinksProvider>
        </StashProvider>
      </VaultDataValue>
    </LimitsProvider>
  );
}
const settle = () => act(async () => {});

describe("the bottom bar's Vault menu (tap the lit tab again)", () => {
  const vaultTab = () => screen.getByRole("button", { name: "Vault" });

  it("signed in: Collection · Stashes, then the stash list with cards", async () => {
    render(
      <Shell>
        <MobileNav route={parseHash("#/vault")} />
      </Shell>
    );
    await settle();
    expect(vaultTab()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(vaultTab());
    const menu = screen.getByRole("group", { name: "Vault menu" });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Collection", "Stashes", "Red binder4", "Trade stash0"]);
    // R3-1: the count column and the rows' names say cards, not copies.
    expect(menu.querySelector(".m-navmenu__label")!.textContent).toBe("Your stashesCards");
    // Open, it holds the feature tour's next tip back (App Spec §20).
    expect(menu).toHaveAttribute("data-tour-busy");
    expect(within(menu).getByRole("button", { name: "Red binder, 4 cards" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Collection" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(document.querySelector(".m-navmenu-scrim")).not.toBeNull();
  });

  it("keyboard: focus moves into the list on open; Escape closes it and returns focus to the tab", async () => {
    render(
      <Shell>
        <MobileNav route={parseHash("#/stashes")} />
      </Shell>
    );
    await settle();
    vaultTab().focus();
    fireEvent.click(vaultTab());
    const menu = screen.getByRole("group", { name: "Vault menu" });
    // A plain list of buttons, not a menu role.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(within(menu).getByRole("button", { name: "Stashes" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
    expect(document.activeElement).toBe(vaultTab());
    expect(vaultTab()).toHaveAttribute("aria-expanded", "false");
  });

  it("a choice navigates and closes; the scrim closes too; a tab not lit has no menu", async () => {
    const { rerender } = render(
      <Shell>
        <MobileNav route={parseHash("#/more")} />
      </Shell>
    );
    await settle();
    // Not lit: the tap goes to the Vault, no menu.
    fireEvent.click(vaultTab());
    expect(window.location.hash).toBe("#/vault");
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
    rerender(
      <Shell>
        <MobileNav route={parseHash("#/vault")} />
      </Shell>
    );
    fireEvent.click(vaultTab());
    fireEvent.click(screen.getByRole("button", { name: /Red binder/ }));
    expect(window.location.hash).toBe("#/stashes/1");
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
    fireEvent.click(vaultTab());
    fireEvent.click(document.querySelector(".m-navmenu-scrim")!);
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
  });

  it("lights Vault on the Stashes page, Stashes current in its menu", async () => {
    render(
      <Shell>
        <MobileNav route={parseHash("#/stashes/1")} />
      </Shell>
    );
    await settle();
    expect(vaultTab()).toHaveAttribute("aria-current", "page");
    fireEvent.click(vaultTab());
    expect(screen.getByRole("button", { name: "Stashes" })).toHaveAttribute("aria-current", "page");
  });

  it("signed out: no menu, no stash names (the tap is today's Vault tap)", async () => {
    render(
      <Shell enabled={false}>
        <MobileNav route={parseHash("#/vault")} />
      </Shell>
    );
    await settle();
    expect(vaultTab()).not.toHaveAttribute("aria-expanded");
    fireEvent.click(vaultTab());
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
    expect(api.getStashes).not.toHaveBeenCalled();
  });

  // REPLACE (owner, 2026-11-07): with a share held but the own vault shown,
  // the lit switch opens the Vault menu with the share as one more row (it
  // used to expand the switch, leaving Stashes unreachable).
  it("a share held, own vault shown: the lit switch opens the menu with the share as a row", async () => {
    const onPick = vi.fn();
    render(
      <Shell>
        <MobileNav route={parseHash("#/vault")} share={{ name: "Bob", shown: false, onPick }} />
      </Shell>
    );
    await settle();
    const face = screen.getByRole("button", { name: "Vault: switch vault" });
    fireEvent.click(face);
    const menu = screen.getByRole("group", { name: "Vault menu" });
    expect(
      within(menu)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Collection", "Stashes", "Bob", "Red binder4", "Trade stash0"]);
    expect(face).toHaveAttribute("aria-expanded", "true");
    // The switch's own panel did not open.
    expect(screen.queryByRole("group", { name: "Choose a vault" })).toBeNull();
    fireEvent.click(within(menu).getByRole("button", { name: "Bob's vault" }));
    expect(onPick).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
  });

  it("a share held, own vault shown: the menu's Stashes opens the Stashes page", async () => {
    render(
      <Shell>
        <MobileNav
          route={parseHash("#/vault")}
          share={{ name: "Bob", shown: false, onPick: () => {} }}
        />
      </Shell>
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Vault: switch vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Stashes" }));
    expect(window.location.hash).toBe("#/stashes");
  });

  it("the shared vault shown: the switch keeps its own behaviour, no stash menu or names", async () => {
    render(
      <Shell enabled={false}>
        <MobileNav
          route={parseHash("#/vault")}
          share={{ name: "Bob", shown: true, onPick: () => {} }}
        />
      </Shell>
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Bob: switch vault" }));
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
    expect(screen.getByRole("group", { name: "Choose a vault" })).toBeInTheDocument();
    expect(screen.queryByText("Red binder")).toBeNull();
  });

  it("a share held, own vault not lit: the switch expands as before", async () => {
    render(
      <Shell>
        <MobileNav
          route={parseHash("#/more")}
          share={{ name: "Bob", shown: false, onPick: () => {} }}
        />
      </Shell>
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Vault: switch vault" }));
    expect(screen.getByRole("group", { name: "Choose a vault" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Vault menu" })).toBeNull();
  });
});

describe("the Stashes list", () => {
  const list = () =>
    render(
      <Shell>
        <StashesScreen account={null} unread={false} onOpenChooser={() => {}} />
      </Shell>
    );

  it("one row per stash with copies and value; a row opens the stash", async () => {
    list();
    await screen.findByRole("button", { name: "Red binder, 4 cards" });
    expect(screen.getByRole("heading", { name: "Stashes" })).toBeInTheDocument();
    // No back chevron, no X: a Vault subsection.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(document.querySelector(".m-stashrow__value")!.textContent).toBe("$19.00");
    // R2-8: no chevron at the row's right; the row itself opens the stash.
    expect(document.querySelector(".m-stashrow__chev")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Red binder, 4 cards" }));
    expect(window.location.hash).toBe("#/stashes/1");
  });

  it("the pencil's Edit sheet refuses a duplicate name and offers Delete", async () => {
    list();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Trade stash: name and description" })
    );
    const dlg = await screen.findByRole("dialog", { name: "Edit stash" });
    fireEvent.change(within(dlg).getAllByRole("textbox")[0], { target: { value: "Red Binder" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent(
      "You already have a stash named Red Binder. Pick another name."
    );
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete stash" }));
    const del = await screen.findByRole("dialog", { name: "Delete Trade stash?" });
    // Copy replaced (R1-9, 2026-11-08): every card returns, with the count.
    expect(del).toHaveTextContent("It holds no cards.");
    await act(async () => {
      fireEvent.click(within(del).getByRole("button", { name: "Delete stash" }));
    });
    expect(api.deleteStash).toHaveBeenCalledWith(2);
    await waitFor(() => expect(document.querySelectorAll(".m-stashrow")).toHaveLength(1));
  });

  it("no stashes: one sentence and New stash, which creates one", async () => {
    stashes = [];
    items = [];
    list();
    expect(
      await screen.findByText(
        "You have no stashes. A stash records where cards are kept, like a binder or a trade box."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New stash" }));
    const dlg = await screen.findByRole("dialog", { name: "New stash" });
    fireEvent.change(within(dlg).getAllByRole("textbox")[0], { target: { value: "With Bob" } });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole("button", { name: "Create stash" }));
    });
    expect(api.createStash).toHaveBeenCalledWith("With Bob", null);
  });
});

describe("inside a stash", () => {
  function inside(id = 1) {
    return render(
      <Shell>
        <StashScreen
          stashId={id}
          account={null}
          unread={false}
          onOpenChooser={() => {}}
          onOpenFeedback={() => {}}
          onSearchMode={() => {}}
        />
      </Shell>
    );
  }
  const line = (vid: number) =>
    document.querySelector<HTMLElement>(`.m-stashline[data-variant="${vid}"]`)!;
  async function ready() {
    inside();
    await waitFor(() => expect(line(11)).not.toBeNull());
  }

  it("draws in the Vault's header frame: expanded panel below the bar, COPIES / VALUE in the strip slot", async () => {
    await ready();
    const header = document.querySelector(".m-vh")!;
    const panel = header.querySelector(".m-vh__panel")!;
    expect(within(panel as HTMLElement).getByText("Red binder")).toBeInTheDocument();
    // Ported: the panel's numbers are the Vault panel's m-metric tiles, the
    // strip's the Vault readout's roles, with the stash name on top (R1-12).
    expect(panel.querySelector(".m-metric__value")!.textContent).toBe("4");
    const strip = header.querySelector(".m-vh__strip")!;
    expect(strip.querySelector(".m-stashstrip")).not.toBeNull();
    expect(strip.querySelector(".m-stashstrip__name")!.textContent).toBe("Red binder");
    expect(strip.querySelector(".m-vh__n")!.textContent).toBe("4");
    expect(strip.querySelector(".m-vh__value")!.textContent).toBe("$19.00");
    // Expanded: the strip is out of the a11y tree, the panel in it.
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("4 printings".replace("4", "3"))).toBeInTheDocument();
  });

  it("collapses by useCollapse on scroll: the strip shows, the panel hides; a strip tap expands", async () => {
    await ready();
    const scroller = document.querySelector<HTMLElement>(".m-vault__scroll")!;
    let top = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 4000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
    for (const y of [10, 20, 40]) {
      act(() => {
        top = y;
        fireEvent.scroll(scroller);
      });
    }
    expect(document.querySelector(".m-vh--collapsed")).not.toBeNull();
    expect(document.querySelector(".m-vh__strip")).not.toHaveAttribute("aria-hidden");
    expect(document.querySelector(".m-vh__panel")).toHaveAttribute("aria-hidden", "true");
    // Back at the top it stays collapsed.
    act(() => {
      top = 0;
      fireEvent.scroll(scroller);
    });
    expect(document.querySelector(".m-vh--collapsed")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Red binder: cards 4/ }));
    expect(document.querySelector(".m-vh--collapsed")).toBeNull();
  });

  it("Return makes the row active (− / chip / trash); another row's tap reverts it", async () => {
    await ready();
    expect(within(line(11)).queryByRole("button", { name: /Return one/ })).toBeNull();
    fireEvent.click(within(line(11)).getByRole("button", { name: /^Return Luke Skywalker/ }));
    expect(line(11).className).toContain("m-stashline--active");
    expect(within(line(11)).getByRole("button", { name: /Return one/ })).toBeInTheDocument();
    expect(within(line(11)).getByRole("button", { name: /Return all 2/ })).toBeInTheDocument();
    // Tapping another row only reverts (it does not open that card).
    fireEvent.click(line(21).querySelector(".m-stashline__main")!);
    expect(line(11).className).not.toContain("m-stashline--active");
    expect(window.location.hash).toBe("");
  });

  it("the active row reverts when a scroll starts", async () => {
    await ready();
    const scroller = document.querySelector<HTMLElement>(".m-vault__scroll")!;
    fireEvent.click(within(line(11)).getByRole("button", { name: /^Return Luke Skywalker/ }));
    // A nudge of a few px is not a scroll the user started.
    act(() => {
      scroller.scrollTop = 2;
      fireEvent.scroll(scroller);
    });
    expect(line(11).className).toContain("m-stashline--active");
    act(() => {
      scroller.scrollTop = 40;
      fireEvent.scroll(scroller);
    });
    expect(line(11).className).not.toContain("m-stashline--active");
  });

  it("− returns one with the green line and Undo; trash returns all and the row leaves", async () => {
    await ready();
    fireEvent.click(within(line(11)).getByRole("button", { name: /^Return Luke Skywalker/ }));
    await act(async () => {
      fireEvent.click(within(line(11)).getByRole("button", { name: /Return one/ }));
    });
    expect(api.returnStashItems).toHaveBeenCalledWith(1, [{ variant_id: 11, quantity: 1 }]);
    await waitFor(() => expect(line(11).querySelector(".playset-chip")!.textContent).toBe("1"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 Luke Skywalker · Standard is back in your Vault."
    );
    expect(document.querySelector(".m-stashpanel__sub")!.textContent).toBe("1 back in Vault");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(api.restoreStashItems).toHaveBeenCalledWith(1, [{ variant_id: 11, quantity: 1 }]);
    await waitFor(() => expect(line(11).querySelector(".playset-chip")!.textContent).toBe("2"));
    await act(async () => {
      fireEvent.click(within(line(11)).getByRole("button", { name: /Return all 2/ }));
    });
    await waitFor(() => expect(line(11)).toBeNull());
  });

  // Retired: "bulk: Select, check rows, Return N to Vault; the returned rows
  // dim at 0 beside Undo" and "bulk Undo restores exactly what was returned
  // and the rows recover" -- owner removed, 2026-11-08 R1-14 (desktop has no
  // bulk return). This test pins the removal.
  it("has no Select mode and no pinned bulk Return (R1-14)", async () => {
    await ready();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Selected copies" })).toBeNull();
    expect(document.querySelector(".m-stashbulk")).toBeNull();
  });

  it("defaults to Set | # by base card; the sort sheet has the stash's own sorts", async () => {
    await ready();
    const order = () =>
      [...document.querySelectorAll(".m-stashline")].map((e) => e.getAttribute("data-variant"));
    expect(order()).toEqual(["11", "12", "21"]);
    fireEvent.click(screen.getByRole("button", { name: /^Sort: Set \| # \(base card\)/ }));
    const sheet = await screen.findByRole("dialog", { name: "Sort" });
    const labels = [...sheet.querySelectorAll(".m-choice__row > span:first-child")].map(
      (e) => e.textContent
    );
    expect(labels).toEqual([
      "Set | # (base card)",
      "Set | # (this printing)",
      "Name",
      "Value",
      "Copies in stash",
      "Rarity",
      "Recently stashed",
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Set | # (this printing)" }));
    await waitFor(() => expect(order()).toEqual(["11", "21", "12"]));
  });

  it("Recently stashed puts the newest first", async () => {
    items = [
      { stash_id: 1, variant_id: 11, quantity: 2, stashed_at: "2026-11-01T10:00:00" },
      { stash_id: 1, variant_id: 12, quantity: 1, stashed_at: "2026-11-02T10:00:00" },
      { stash_id: 1, variant_id: 21, quantity: 1, stashed_at: "2026-11-08T10:00:00" },
    ];
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Recently stashed" }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".m-stashline")].map((e) => e.getAttribute("data-variant"))
      ).toEqual(["21", "12", "11"])
    );
  });

  it("R1-9: the trash in the status row deletes the stash after a confirm with the count", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Delete Red binder" }));
    const del = await screen.findByRole("dialog", { name: "Delete Red binder?" });
    expect(del).toHaveTextContent("Every card in it returns to your Vault: 4 cards.");
    await act(async () => {
      fireEvent.click(within(del).getByRole("button", { name: "Delete stash" }));
    });
    expect(api.deleteStash).toHaveBeenCalledWith(1);
    // It lands on the Stashes list.
    await waitFor(() => expect(window.location.hash).toBe("#/stashes"));
  });

  it("rows use the Vault row's type roles and the plain count chip", async () => {
    await ready();
    expect(line(12).querySelector(".m-row__name")!.textContent).toBe("Luke Skywalker");
    expect(line(12).querySelector(".m-row__num")!.textContent).toBe("SOR 269");
    expect(line(12).querySelector(".m-row__type")!.textContent).toBe("Hyperspace");
    expect(line(12).querySelector(".m-row__thumb")).not.toBeNull();
    expect(line(21).querySelector(".playset-chip")!.className).toContain("playset-chip--complete");
  });

  it("the description opens in a popover; a tap outside closes it", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Description: show all" }));
    expect(screen.getByRole("dialog", { name: "Description" })).toHaveTextContent(
      "Blue binder on the shelf, sleeved, by set"
    );
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Description" })).toBeNull();
  });

  it("the gallery draws one tile per printing; a tile opens that printing", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    const tiles = document.querySelectorAll(".m-stashtile");
    expect(tiles).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "Luke Skywalker, Hyperspace, 1 in this stash" })
    );
    expect(window.location.hash).toBe("#/card/1?v=12");
  });

  it("Value sorts by each row's value as shown (price x copies in the stash), both directions", async () => {
    // Luke Standard 3 x $4 = $12, Luke Hyperspace 1 x $9 = $9, Vader 1 x $2:
    // a unit-price order would put Standard before Hyperspace.
    items[0].quantity = 3;
    await ready();
    const order = () =>
      [...document.querySelectorAll(".m-stashline")].map((e) => e.getAttribute("data-variant"));
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Value" }));
    await waitFor(() => expect(order()).toEqual(["21", "12", "11"]));
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Value, ascending" }));
    await waitFor(() => expect(order()).toEqual(["11", "12", "21"]));
  });

  it("a return shows the server's answer even when the refresh fails, with Try again", async () => {
    await ready();
    api.getStashItems.mockRejectedValueOnce(new Error("offline"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(within(line(11)).getByRole("button", { name: /^Return Luke Skywalker/ }));
    await act(async () => {
      fireEvent.click(within(line(11)).getByRole("button", { name: /Return one/ }));
    });
    expect(line(11).querySelector(".playset-chip")!.textContent).toBe("1");
    expect(document.querySelector(".m-stashpanel .m-metric__value")!.textContent).toBe("3");
    expect(screen.getByText("The stash list did not refresh.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.queryByText("The stash list did not refresh.")).toBeNull();
    err.mockRestore();
  });

  it("a gallery tile shows that printing's own art", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
    const tile = screen.getByRole("button", {
      name: "Luke Skywalker, Hyperspace, 1 in this stash",
    });
    expect(tile.querySelector("img")!.getAttribute("src")).toContain("SOR_269");
    const std = screen.getByRole("button", { name: "Luke Skywalker, Standard, 2 in this stash" });
    expect(std.querySelector("img")!.getAttribute("src")).toContain("SOR_005");
  });

  it("the first load failing offers Try again instead of loading forever", async () => {
    api.getStashes.mockRejectedValueOnce(new Error("offline"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    inside();
    expect(await screen.findByText("Your stashes did not load.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => expect(line(11)).not.toBeNull());
    err.mockRestore();
  });

  it("an empty stash says where copies come from", async () => {
    inside(2);
    expect(
      await screen.findByText(
        "Trade stash has no cards. Cards go into a stash from a card’s detail."
      )
    ).toBeInTheDocument();
  });
});

describe("R1-10: scale on the phone", () => {
  it("60 stashes with long names all list, one row each", async () => {
    stashes = Array.from({ length: 60 }, (_, i) => mk(i + 1, `Stash number ${i + 1}`));
    stashes[59].name = "y".repeat(40);
    render(
      <Shell>
        <StashesScreen account={null} unread={false} onOpenChooser={() => {}} />
      </Shell>
    );
    await screen.findByRole("button", {
      name: "Stash number 1, 4 cards",
    });
    expect(document.querySelectorAll(".m-stashrow")).toHaveLength(60);
    expect(screen.getByRole("button", { name: new RegExp("^y{40},") })).toBeInTheDocument();
    // The list scrolls inside the screen's own scroller.
    expect(document.querySelector(".m-more__scroll .m-stashes__group")).not.toBeNull();
  });

  it("a stash with hundreds of printings draws every row", async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      phoneCard({
        id: 100 + i,
        name: `Card ${i}`,
        number: String(i + 1),
        variants: [
          { id: 1000 + i * 2, finish: "Standard", number: String(i + 1), market: 1 },
          { id: 1001 + i * 2, finish: "Hyperspace", number: String(300 + i), market: 2 },
        ],
      })
    );
    items = many.flatMap((c) =>
      c.variants.map((v) => ({ stash_id: 1, variant_id: v.variant_id, quantity: 1 }))
    );
    render(
      <LimitsProvider isAuthenticated={false}>
        <VaultDataValue value={data(many)}>
          <StashProvider enabled>
            <div className="m-app">
              <SheetHost>
                <StashScreen
                  stashId={1}
                  account={null}
                  unread={false}
                  onOpenChooser={() => {}}
                  onOpenFeedback={() => {}}
                  onSearchMode={() => {}}
                />
              </SheetHost>
            </div>
          </StashProvider>
        </VaultDataValue>
      </LimitsProvider>
    );
    await waitFor(() => expect(document.querySelectorAll(".m-stashline")).toHaveLength(240));
    expect(screen.getByText("240 printings")).toBeInTheDocument();
    const first = [...document.querySelectorAll(".m-stashline")]
      .slice(0, 2)
      .map((e) => e.getAttribute("data-variant"));
    expect(first).toEqual(["1000", "1001"]);
  });
});

// App Spec §19.1 owner screens on the phone: the Stashes list's link marks
// and "N shared", the stash's Share in the status row (tip 5's target),
// "Link on" under VALUE, and the delete sheet's link line.
describe("sharing a stash on the phone (owner screens)", () => {
  const list = () =>
    render(
      <Shell>
        <StashesScreen account={null} unread={false} onOpenChooser={() => {}} />
      </Shell>
    );
  function inside(id = 1) {
    return render(
      <Shell>
        <StashScreen
          stashId={id}
          account={null}
          unread={false}
          onOpenChooser={() => {}}
          onOpenFeedback={() => {}}
          onSearchMode={() => {}}
        />
      </Shell>
    );
  }

  it("the list: the group label counts stashes; no links, no marks and no shared count", async () => {
    list();
    await screen.findByRole("button", { name: "Red binder, 4 cards" });
    await waitFor(() => expect(shareApi.listShares).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Your stashes · 2" })).toBeInTheDocument();
    expect(document.querySelector(".m-stashrow__link")).toBeNull();
    expect(document.querySelector(".m-stashes__shared")).toBeNull();
  });

  it("the list: a link mark after each shared stash's name and 'N shared' at the right", async () => {
    shares = [stashLink(2)];
    list();
    await screen.findByRole("button", { name: "Trade stash, shared, 0 cards" });
    const row = document.querySelector('.m-stashrow[data-stash="2"]')!;
    const nameline = row.querySelector(".m-stashrow__nameline")!;
    expect([...nameline.children].map((c) => c.className)).toEqual([
      "m-stashrow__name",
      "m-stashrow__link",
    ]);
    expect(document.querySelector('.m-stashrow[data-stash="1"] .m-stashrow__link')).toBeNull();
    expect(document.querySelector(".m-stashes__shared")!.textContent).toBe("1 shared");
  });

  it("inside: the status row is printings · share · edit · delete · sort · view; share outlined with no link", async () => {
    inside();
    await waitFor(() => expect(document.querySelector(".m-stashline")).not.toBeNull());
    const status = document.querySelector(".m-stashctl__status")!;
    const parts = [...status.children].map(
      (c) => c.getAttribute("aria-label") ?? c.className.split(" ")[0]
    );
    expect(parts).toEqual([
      "m-count",
      "Share Red binder",
      "Edit stash",
      "Delete Red binder",
      expect.stringMatching(/^Sort/),
      "View",
    ]);
    const share = screen.getByRole("button", { name: "Share Red binder" });
    expect(share.className).toBe("m-stashctl__icon");
    expect(share.getAttribute("data-tour")).toBe("stash-share");
    expect(document.querySelector(".m-stashpanel .sp-linkon")).toBeNull();
  });

  it("inside: with a link on, Share is filled and 'Link on · <name>' sits under VALUE", async () => {
    shares = [stashLink(1, "Sam")];
    inside();
    const share = await screen.findByRole("button", { name: "Share Red binder: link on" });
    expect(share.className).toContain("m-stashctl__icon--on");
    const line = document.querySelector(".m-stashpanel .sp-linkon")!;
    expect(line.textContent).toBe("Link on · Sam");
    expect(line.closest(".m-metric")!.querySelector(".m-metric__label")!.textContent).toBe("Value");
  });

  it("inside: Share opens the sharing layer on this stash's link", async () => {
    inside();
    fireEvent.click(await screen.findByRole("button", { name: "Share Red binder" }));
    expect(window.location.hash).toBe("#/more/sharing?stash=1");
  });

  it("the delete sheet adds 'Its share link stops working.' only for a shared stash", async () => {
    shares = [stashLink(1)];
    const r = inside();
    await screen.findByRole("button", { name: "Share Red binder: link on" });
    fireEvent.click(screen.getByRole("button", { name: "Delete Red binder" }));
    const del = await screen.findByRole("dialog", { name: "Delete Red binder?" });
    expect(within(del).getByText("Its share link stops working.")).toBeInTheDocument();
    r.unmount();

    inside(2);
    await screen.findByRole("button", { name: "Share Trade stash" });
    fireEvent.click(screen.getByRole("button", { name: "Delete Trade stash" }));
    const del2 = await screen.findByRole("dialog", { name: "Delete Trade stash?" });
    expect(within(del2).queryByText("Its share link stops working.")).toBeNull();
  });
});
