import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Playset } from "./Playset";
import { baseCard, HYPERSPACE, leaderCard, unitCard } from "./phoneCardFixtures";
import type { InventoryCard } from "../../utils/inventory";

function view(card: InventoryCard, scope: string | null, isAuthenticated = true) {
  const { container } = render(
    <Playset card={card} scope={scope} isAuthenticated={isAuthenticated} />
  );
  const root = container.querySelector(".playset") as HTMLElement;
  const chip = container.querySelector(".playset-chip") as HTMLElement;
  const pips = container.querySelector(".playset__pips") as HTMLElement;
  const pipEls = Array.from(container.querySelectorAll(".playset__pip"));
  return {
    root,
    chip,
    pips,
    total: pipEls.length,
    filled: pipEls.filter((p) => p.classList.contains("playset__pip--filled")).length,
    scopedFilled: pipEls.filter((p) => p.classList.contains("playset__pip--scoped")).length,
  };
}

describe("Playset chip and pips, unscoped", () => {
  it("shows a muted zero and three empty pips when nothing is owned", () => {
    const v = view(unitCard(0, 0), null);
    expect(v.chip.textContent).toBe("0");
    expect(v.chip.classList.contains("playset-chip--empty")).toBe(true);
    expect(v.root.classList.contains("playset--empty")).toBe(true);
    expect(v.root.classList.contains("playset--complete")).toBe(false);
    expect(v.total).toBe(3);
    expect(v.filled).toBe(0);
  });

  it("fills as many pips as copies owned while short of a playset", () => {
    const v = view(unitCard(2, 0), null);
    expect(v.chip.textContent).toBe("2");
    expect(v.chip.className).toBe("playset-chip");
    expect(v.root.classList.contains("playset--complete")).toBe(false);
    expect(v.filled).toBe(2);
    expect(v.scopedFilled).toBe(0);
  });

  it("counts copies across every finish toward the playset", () => {
    const v = view(unitCard(2, 1), null);
    expect(v.chip.textContent).toBe("3");
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
    expect(v.root.classList.contains("playset--complete")).toBe(true);
    expect(v.filled).toBe(3);
  });

  it("shows the true total but never more than three pips when over the playset", () => {
    const v = view(unitCard(4, 2), null);
    expect(v.chip.textContent).toBe("6");
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
    expect(v.total).toBe(3);
    expect(v.filled).toBe(3);
  });

  it("has no scoped treatment on the pips block", () => {
    const v = view(unitCard(3, 0), null);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(false);
  });
});

describe("Playset singleton cards", () => {
  it("has one pip for a leader, empty at zero owned", () => {
    const v = view(leaderCard(0, 0), null);
    expect(v.total).toBe(1);
    expect(v.filled).toBe(0);
    expect(v.chip.classList.contains("playset-chip--empty")).toBe(true);
  });

  it("is complete at one copy of a leader", () => {
    const v = view(leaderCard(1, 0), null);
    expect(v.total).toBe(1);
    expect(v.filled).toBe(1);
    expect(v.root.classList.contains("playset--complete")).toBe(true);
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
  });

  it("has one pip for a base and counts a second copy as over the playset", () => {
    const v = view(baseCard(2), null);
    expect(v.total).toBe(1);
    expect(v.filled).toBe(1);
    expect(v.chip.textContent).toBe("2");
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
  });
});

describe("Playset scoped to a finish", () => {
  it("fills the pips from the scoped finish only, in the scoped colour, while the chip keeps the owned total", () => {
    const v = view(unitCard(2, 1), HYPERSPACE);
    expect(v.chip.textContent).toBe("3");
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
    expect(v.filled).toBe(1);
    expect(v.scopedFilled).toBe(1);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(false);
  });

  it("marks the pips block scoped-complete when the scoped finish alone is a playset", () => {
    const v = view(unitCard(0, 3), HYPERSPACE);
    expect(v.filled).toBe(3);
    expect(v.scopedFilled).toBe(3);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(true);
    expect(v.root.classList.contains("playset--complete")).toBe(true);
  });

  it("leaves the pips empty when the playset is whole in another finish", () => {
    const v = view(unitCard(3, 0), HYPERSPACE);
    expect(v.chip.textContent).toBe("3");
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
    expect(v.filled).toBe(0);
    expect(v.scopedFilled).toBe(0);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(false);
  });

  it("caps the scoped pips at the playset size", () => {
    const v = view(unitCard(0, 5), HYPERSPACE);
    expect(v.total).toBe(3);
    expect(v.filled).toBe(3);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(true);
  });

  it("shows no filled pips for a finish the card does not have", () => {
    const v = view(unitCard(3, 0), "Showcase");
    expect(v.filled).toBe(0);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(false);
  });

  it("scopes a leader to a finish it does not hold", () => {
    const v = view(leaderCard(1, 0), "Showcase");
    expect(v.filled).toBe(0);
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(true);
  });

  it("keeps the zero state when nothing is owned in any finish", () => {
    const v = view(unitCard(0, 0), HYPERSPACE);
    expect(v.chip.textContent).toBe("0");
    expect(v.chip.classList.contains("playset-chip--empty")).toBe(true);
    expect(v.filled).toBe(0);
  });
});

describe("Playset signed out", () => {
  it("shows a dash and empty pips whatever the card holds", () => {
    const v = view(unitCard(3, 1), null, false);
    expect(v.chip.textContent).toBe("—");
    expect(v.chip.classList.contains("playset-chip--signed-out")).toBe(true);
    expect(v.chip.classList.contains("playset-chip--complete")).toBe(false);
    expect(v.root.classList.contains("playset--empty")).toBe(true);
    expect(v.root.classList.contains("playset--complete")).toBe(false);
    expect(v.total).toBe(3);
    expect(v.filled).toBe(0);
  });

  it("ignores a scope", () => {
    const v = view(unitCard(0, 3), HYPERSPACE, false);
    expect(v.chip.textContent).toBe("—");
    expect(v.filled).toBe(0);
    expect(v.scopedFilled).toBe(0);
    expect(v.pips.classList.contains("playset__pips--scoped-complete")).toBe(false);
  });
});
