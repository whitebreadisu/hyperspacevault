import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryCard } from "../../utils/inventory";
import type { PriceMode } from "../../utils/variantScope";
import type { RowSize } from "./useVaultView";

const openFinishSheet = vi.fn();
vi.mock("../card/FinishSheet", () => ({
  openFinishSheet: (...args: unknown[]) => openFinishSheet(...args),
}));

import { CardRow } from "./CardRow";
import {
  baseCard,
  HYPERSPACE,
  leaderCard,
  phoneCard,
  unitCard,
  unpricedCard,
} from "./phoneCardFixtures";

function view(
  card: InventoryCard,
  opts: {
    size?: RowSize;
    scope?: string | null;
    priceKind?: PriceMode;
    isAuthenticated?: boolean;
  } = {}
) {
  const onOpen = vi.fn();
  const { container } = render(
    <CardRow
      card={card}
      size={opts.size ?? "sm"}
      scope={opts.scope ?? null}
      priceKind={opts.priceKind ?? "market"}
      isAuthenticated={opts.isAuthenticated ?? true}
      onOpen={onOpen}
    />
  );
  const text = (sel: string) => container.querySelector(sel)?.textContent ?? null;
  const filled = container.querySelectorAll(".playset__pip--filled").length;
  return { container, onOpen, text, filled };
}

beforeEach(() => openFinishSheet.mockReset());

describe("CardRow label, number and price, unscoped", () => {
  it("shows the base card's set and number, name, and the Standard price", () => {
    const v = view(unitCard(1, 0));
    expect(v.text(".m-row__num")).toBe("SOR 87");
    expect(v.text(".m-row__name")).toBe("Darth Vader");
    expect(v.text(".m-row__price")).toBe("$6.80");
    expect(v.container.querySelector(".m-row__num--scoped")).toBeNull();
    expect(
      screen.getByRole("button", { name: "SOR 87 Darth Vader, Commanding the First Wave" })
    ).toBeTruthy();
  });

  it("uses the low price when the price kind is low", () => {
    expect(view(unitCard(1, 0), { priceKind: "low" }).text(".m-row__price")).toBe("$3.40");
  });

  it("shows a dash, muted, when the card is unpriced", () => {
    const v = view(unpricedCard(1));
    expect(v.text(".m-row__price")).toBe("—");
    expect(v.container.querySelector(".m-row__price--none")).not.toBeNull();
  });

  it("rounds a price of $100 or more to whole dollars", () => {
    const card = phoneCard({
      id: 9,
      name: "Chase",
      variants: [{ id: 91, finish: "Standard", number: "1", market: 325.4 }],
    });
    expect(view(card).text(".m-row__price")).toBe("$325");
  });

  it("uses a base's first trait where it has no subtitle", () => {
    const v = view(baseCard(0), { size: "md" });
    expect(screen.getByRole("button", { name: "SOR 20 Echo Base, Rebel" })).toBeTruthy();
    expect(v.text(".m-row__sub")).toBe("Rebel");
  });
});

describe("CardRow scoped to a finish", () => {
  it("shows the scoped printing's own number, in the scoped style, and its own price", () => {
    const v = view(unitCard(2, 1), { scope: HYPERSPACE });
    expect(v.text(".m-row__num--scoped")).toBe("SOR 339");
    expect(v.text(".m-row__price")).toBe("$15.00");
    expect(v.container.querySelector(".m-row__own--scoped")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "SOR 339 Darth Vader, Commanding the First Wave" })
    ).toBeTruthy();
  });

  it("shows a dash instead of another printing's price when the card lacks the scoped finish", () => {
    const v = view(unitCard(2, 1), { scope: "Showcase" });
    expect(v.text(".m-row__price")).toBe("—");
    expect(v.text(".m-row__num")).toBe("SOR 87");
    expect(v.container.querySelector(".m-row__num--scoped")).toBeNull();
  });

  it("fills the pips from the scoped finish's count", () => {
    expect(view(unitCard(2, 1), { scope: HYPERSPACE }).filled).toBe(1);
  });

  it("fills the pips from the owned total when unscoped", () => {
    expect(view(unitCard(2, 1)).filled).toBe(3);
  });

  it("opens the card on the scoped printing", () => {
    const card = unitCard(2, 1);
    const v = view(card, { scope: HYPERSPACE });
    fireEvent.click(screen.getByRole("button", { name: /^SOR 339 Darth Vader/ }));
    expect(v.onOpen).toHaveBeenCalledWith(card, card.variants[1]);
  });
});

describe("CardRow owned cluster", () => {
  it("signed in, announces the owned total and opens Owned by finish", () => {
    const card = unitCard(2, 1);
    const v = view(card);
    fireEvent.click(
      screen.getByRole("button", { name: "Darth Vader: 3 owned. Show owned by finish" })
    );
    expect(openFinishSheet).toHaveBeenCalledTimes(1);
    expect(openFinishSheet.mock.calls[0][0]).toBe(1);
    expect(v.onOpen).not.toHaveBeenCalled();
    (openFinishSheet.mock.calls[0][1] as () => void)();
    expect(v.onOpen).toHaveBeenCalledWith(card, null);
  });

  it("signed out, opens the card directly and shows no owned count", () => {
    const card = unitCard(2, 1);
    const v = view(card, { isAuthenticated: false });
    expect(v.text(".playset-chip")).toBe("—");
    expect(v.filled).toBe(0);
    const buttons = screen.getAllByRole("button", {
      name: "SOR 87 Darth Vader, Commanding the First Wave",
    });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(openFinishSheet).not.toHaveBeenCalled();
    expect(v.onOpen).toHaveBeenCalledWith(card, null);
  });

  it("shows zero owned with empty pips", () => {
    const v = view(unitCard(0, 0));
    expect(v.text(".playset-chip")).toBe("0");
    expect(v.filled).toBe(0);
    expect(
      screen.getByRole("button", { name: "Darth Vader: 0 owned. Show owned by finish" })
    ).toBeTruthy();
  });

  it("completes a singleton leader at one copy", () => {
    const v = view(leaderCard(1, 0));
    expect(v.container.querySelectorAll(".playset__pip")).toHaveLength(1);
    expect(v.container.querySelector(".playset--complete")).not.toBeNull();
  });

  it("opens the card from the main part with no printing when unscoped", () => {
    const card = unitCard(1, 0);
    const v = view(card);
    fireEvent.click(screen.getByRole("button", { name: /^SOR 87 Darth Vader/ }));
    expect(v.onOpen).toHaveBeenCalledWith(card, null);
  });
});

describe("CardRow size tiers", () => {
  const card = () =>
    phoneCard({
      id: 5,
      name: "Boba Fett",
      subtitle: "Disintegrator",
      type: "Unit",
      aspects: ["Villainy"],
      cost: 4,
      power: 5,
      hp: 6,
      variants: [{ id: 51, finish: "Standard", number: "8", qty: 1, market: 1 }],
    });

  it("none is a single line with no thumbnail or metadata", () => {
    const v = view(card(), { size: "none" });
    expect(v.container.querySelector(".m-row--line")).not.toBeNull();
    expect(v.container.querySelector(".m-row__thumb")).toBeNull();
    expect(v.container.querySelector(".m-row__meta")).toBeNull();
    expect(v.text(".m-row__sub")).toBe("Disintegrator");
    expect(v.text(".m-row__name")).toBe("Boba Fett");
    expect(v.text(".m-row__price")).toBe("$1.00");
  });

  it("none omits the subtitle when the card has none", () => {
    const v = view(unpricedCard(0), { size: "none" });
    expect(v.container.querySelector(".m-row__sub")).toBeNull();
  });

  it("sm adds the thumbnail and metadata but not the subtitle or type", () => {
    const v = view(card(), { size: "sm" });
    expect(v.container.querySelector(".m-row__thumb")).not.toBeNull();
    expect(v.text(".m-row__num")).toBe("SOR 8");
    expect(v.container.querySelector(".m-row__sub")).toBeNull();
    expect(v.container.querySelector(".m-row__type")).toBeNull();
    expect(v.container.querySelector(".m-row__stats")).toBeNull();
  });

  it("md adds the subtitle and the type", () => {
    const v = view(card(), { size: "md" });
    expect(v.text(".m-row__sub")).toBe("Disintegrator");
    expect(v.text(".m-row__type")).toBe("Unit");
    expect(v.container.querySelector(".m-row__stats")).toBeNull();
  });

  it("lg adds the stat badges and the type", () => {
    const v = view(card(), { size: "lg" });
    expect(v.container.querySelector(".m-row__stats")).not.toBeNull();
    expect(v.text(".m-row__stats .m-row__type")).toBe("Unit");
    expect(v.text(".m-row__sub")).toBe("Disintegrator");
  });

  it("keeps the owned cluster in every tier", () => {
    for (const size of ["none", "sm", "md", "lg"] as RowSize[]) {
      const { container, unmount } = render(
        <CardRow
          card={unitCard(2, 0)}
          size={size}
          scope={null}
          priceKind="market"
          isAuthenticated
          onOpen={() => {}}
        />
      );
      expect(container.querySelector(".playset-chip")?.textContent).toBe("2");
      unmount();
    }
  });
});
