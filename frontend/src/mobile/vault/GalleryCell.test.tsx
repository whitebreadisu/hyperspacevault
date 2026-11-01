import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryCell } from "./GalleryCell";
import { baseCard, HYPERSPACE, leaderCard, unitCard, unpricedCard } from "./phoneCardFixtures";
import type { InventoryCard } from "../../utils/inventory";
import type { GallerySize } from "./useVaultView";

function view(
  card: InventoryCard,
  opts: {
    scope?: string | null;
    isAuthenticated?: boolean;
    finishes?: string[];
    gallerySize?: GallerySize;
  } = {}
) {
  const onOpen = vi.fn();
  const { container } = render(
    <GalleryCell
      card={card}
      finishes={new Set(opts.finishes ?? [])}
      scope={opts.scope ?? null}
      gallerySize={opts.gallerySize ?? 2}
      isAuthenticated={opts.isAuthenticated ?? true}
      onOpen={onOpen}
    />
  );
  const plate = container.querySelector(".gallery-plate") as HTMLElement;
  const pipEls = Array.from(container.querySelectorAll(".gallery-plate__pip"));
  const total = container.querySelector(".gallery-plate__total") as HTMLElement | null;
  return {
    container,
    onOpen,
    total,
    pipCount: pipEls.length,
    filled: pipEls.filter((p) => p.classList.contains("gallery-plate__pip--filled")).length,
    scopedFilled: pipEls.filter((p) => p.classList.contains("gallery-plate__pip--scoped")).length,
    complete: plate.classList.contains("gallery-plate--complete"),
  };
}

describe("GalleryCell plate, unscoped", () => {
  it("shows a muted zero and empty pips when nothing is owned", () => {
    const v = view(unitCard(0, 0));
    expect(v.total?.textContent).toBe("0");
    expect(v.total?.classList.contains("gallery-plate__total--empty")).toBe(true);
    expect(v.pipCount).toBe(3);
    expect(v.filled).toBe(0);
    expect(v.complete).toBe(false);
  });

  it("fills one pip per copy owned while short of a playset", () => {
    const v = view(unitCard(1, 1));
    expect(v.total?.textContent).toBe("2");
    expect(v.total?.className).toBe("gallery-plate__total");
    expect(v.filled).toBe(2);
    expect(v.scopedFilled).toBe(0);
    expect(v.complete).toBe(false);
  });

  it("turns the ring and total green at a playset made of two finishes", () => {
    const v = view(unitCard(2, 1));
    expect(v.total?.textContent).toBe("3");
    expect(v.total?.classList.contains("gallery-plate__total--complete")).toBe(true);
    expect(v.filled).toBe(3);
    expect(v.complete).toBe(true);
  });

  it("shows the whole owned number but at most three pips over the playset", () => {
    const v = view(unitCard(5, 2));
    expect(v.total?.textContent).toBe("7");
    expect(v.pipCount).toBe(3);
    expect(v.filled).toBe(3);
    expect(v.complete).toBe(true);
  });
});

describe("GalleryCell singleton cards", () => {
  it("has a single empty pip for a leader at zero owned", () => {
    const v = view(leaderCard(0, 0));
    expect(v.pipCount).toBe(1);
    expect(v.filled).toBe(0);
    expect(v.complete).toBe(false);
  });

  it("completes a leader at one copy", () => {
    const v = view(leaderCard(1, 0));
    expect(v.filled).toBe(1);
    expect(v.complete).toBe(true);
    expect(v.total?.classList.contains("gallery-plate__total--complete")).toBe(true);
  });

  it("completes a base at one copy", () => {
    const v = view(baseCard(1));
    expect(v.pipCount).toBe(1);
    expect(v.complete).toBe(true);
  });
});

describe("GalleryCell plate, scoped", () => {
  it("fills amber pips from the scoped finish while the total stays the owned number", () => {
    const v = view(unitCard(2, 1), { scope: HYPERSPACE });
    expect(v.total?.textContent).toBe("3");
    expect(v.total?.classList.contains("gallery-plate__total--complete")).toBe(true);
    expect(v.filled).toBe(1);
    expect(v.scopedFilled).toBe(1);
    expect(v.complete).toBe(false);
  });

  it("completes the ring when the scoped finish alone is a playset", () => {
    const v = view(unitCard(0, 3), { scope: HYPERSPACE });
    expect(v.filled).toBe(3);
    expect(v.scopedFilled).toBe(3);
    expect(v.complete).toBe(true);
  });

  it("keeps the ring open when the playset is whole only in another finish", () => {
    const v = view(unitCard(3, 0), { scope: HYPERSPACE });
    expect(v.total?.textContent).toBe("3");
    expect(v.total?.classList.contains("gallery-plate__total--complete")).toBe(true);
    expect(v.filled).toBe(0);
    expect(v.complete).toBe(false);
  });

  it("scopes a leader to the finish it holds", () => {
    const v = view(leaderCard(0, 1), { scope: "Showcase" });
    expect(v.filled).toBe(1);
    expect(v.scopedFilled).toBe(1);
    expect(v.complete).toBe(true);
  });

  it("shows empty pips for a finish the card lacks", () => {
    const v = view(unitCard(3, 0), { scope: "Showcase" });
    expect(v.filled).toBe(0);
    expect(v.complete).toBe(false);
  });
});

describe("GalleryCell signed out", () => {
  it("invites sign in instead of showing pips or a total", () => {
    const v = view(unitCard(3, 3), { isAuthenticated: false });
    expect(screen.getByText("SIGN IN TO TRACK")).toBeTruthy();
    expect(v.pipCount).toBe(0);
    expect(v.total).toBeNull();
    expect(v.complete).toBe(false);
  });

  it("ignores a scope", () => {
    const v = view(unitCard(0, 3), { isAuthenticated: false, scope: HYPERSPACE });
    expect(v.complete).toBe(false);
    expect(v.pipCount).toBe(0);
  });
});

describe("GalleryCell opening and representative printing", () => {
  it("opens the card with no printing when no finish filter is set", () => {
    const card = unitCard(1, 1);
    const v = view(card);
    const btn = screen.getByRole("button", { name: "Darth Vader" });
    expect(btn.getAttribute("data-card")).toBe("1");
    fireEvent.click(btn);
    expect(v.onOpen).toHaveBeenCalledWith(card, null);
  });

  it("names the filtered finish and opens that printing when a finish filter is set", () => {
    const card = unitCard(1, 1);
    const v = view(card, { finishes: [HYPERSPACE] });
    const btn = screen.getByRole("button", { name: "Darth Vader, Hyperspace" });
    expect(btn.getAttribute("data-shown")).toBe("12");
    fireEvent.click(btn);
    expect(v.onOpen).toHaveBeenCalledWith(card, card.variants[1]);
  });

  it("falls back to the Standard printing when the filtered finish is absent", () => {
    const card = unitCard(1, 1);
    const v = view(card, { finishes: ["Showcase"] });
    const btn = screen.getByRole("button", { name: "Darth Vader, Standard" });
    expect(btn.getAttribute("data-shown")).toBe("11");
    fireEvent.click(btn);
    expect(v.onOpen).toHaveBeenCalledWith(card, card.variants[0]);
  });
});

describe("GalleryCell art", () => {
  it("draws the printing art, rotated for a leader without a back", () => {
    const v = view(leaderCard(1, 0, false));
    const img = v.container.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.classList.contains("m-img--rotated")).toBe(true);
  });

  it("shows a leader's portrait back upright", () => {
    const v = view(leaderCard(1, 0, true));
    const img = v.container.querySelector("img") as HTMLImageElement;
    expect(img.classList.contains("m-img--rotated")).toBe(false);
    expect(img.getAttribute("src")).toContain("leader-back");
  });

  it("leaves the frame empty when the card has no art", () => {
    const v = view(unpricedCard(1));
    expect(v.container.querySelector("img")).toBeNull();
    expect(v.container.querySelector(".m-cell--empty")).not.toBeNull();
  });
});
