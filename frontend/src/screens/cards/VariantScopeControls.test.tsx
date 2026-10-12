import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardsScopeTrigger } from "./VariantScopeControls";

// BL-259 (owner decision 2026-10-12): Showcase is the last pinned row of the
// Playset header's scope menu, drawn as a one-chip row -- the menu's own
// single-select idiom -- and never as a check-box row. The menu's other
// behaviour (pairs, Prestige, expander, Escape, outside click) is covered in
// CardsTable.test.tsx; the page-level Finish-facet wiring in CardsPage.test.tsx.

function openMenu(scope: string | null, onScopeChange = vi.fn()) {
  render(<CardsScopeTrigger scope={scope} onScopeChange={onScopeChange} />);
  fireEvent.click(screen.getByTitle("Scope pips + Value to a single variant"));
  const menu = document.querySelector(".vs-scope-menu") as HTMLElement;
  const items = menu.querySelector(".vs-scope-menu__items") as HTMLElement;
  return { menu, items, onScopeChange };
}

describe("FR4-02 Showcase row in the desktop scope menu", () => {
  it("fr4-02 renders last in the pinned section, with one chip and no check-box", () => {
    const { items } = openMenu(null);
    const children = [...items.children] as HTMLElement[];
    const divider = children.findIndex((el) => el.classList.contains("ifp-multi__pin-divider"));
    const pinned = children.slice(0, divider);
    expect(pinned.map((el) => el.dataset.row)).toEqual([
      "Standard",
      "Hyperspace",
      "Prestige",
      "Weekly Play",
      "Showcase",
    ]);
    // Visible without expanding: the expander follows the divider, still closed.
    expect(children[divider + 1].getAttribute("aria-expanded")).toBe("false");

    const row = pinned[pinned.length - 1];
    expect(row.classList.contains("vs-scope-menu__row--single")).toBe(true);
    expect(row.querySelector(".vs-scope-menu__row-label")?.textContent).toBe("Showcase");
    // Not the check-box row the expanded plain rows use.
    expect(row.querySelector(".ifp-multi__check")).toBeNull();
    expect(row.classList.contains("ifp-multi__item")).toBe(false);
    expect(row.querySelector('[role="option"]')).toBeNull();
    const chips = row.querySelectorAll("button.ifp-finish-pair__chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("Showcase");
    // A native button: Tab reaches it, Enter / Space pick it, like every other chip.
    expect((chips[0] as HTMLButtonElement).type).toBe("button");
    expect((chips[0] as HTMLButtonElement).disabled).toBe(false);
    expect(chips[0].getAttribute("aria-pressed")).toBe("false");
    expect(chips[0].classList.contains("ifp-finish-pair__chip--on")).toBe(false);
  });

  it("fr4-02 selecting it calls onPick('Showcase') and closes the menu", () => {
    const { menu, onScopeChange } = openMenu(null);
    fireEvent.click(menu.querySelector('[data-scope="Showcase"]')!);
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith("Showcase");
    expect(document.querySelector(".vs-scope-menu")).toBeNull();
  });

  it("fr4-02 selected state is exposed to assistive tech; the trigger reads PIPS · Showcase, amber", () => {
    const { menu } = openMenu("Showcase");
    const chip = menu.querySelector('[data-scope="Showcase"]')!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.classList.contains("ifp-finish-pair__chip--on")).toBe(true);
    // Single-select: no other value reads selected.
    expect(menu.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    const trigger = screen.getByTitle("Scope pips + Value to a single variant");
    expect(trigger.textContent).toContain("PIPS · Showcase");
    expect(trigger.className).toContain("vs-header-scope__trigger--on");
    // "All finishes" is live while scoped (it is this menu's Clear).
    expect((screen.getByText("All finishes") as HTMLButtonElement).disabled).toBe(false);
  });

  it("fr4-02 the expanded plain rows keep their check-box rows (not restyled)", () => {
    const { menu } = openMenu(null);
    fireEvent.click(screen.getByText("Show all finishes…"));
    const plain = menu.querySelectorAll('.ifp-multi__item[role="option"]');
    expect([...plain].map((el) => el.textContent)).toEqual([
      "Convention Exclusive",
      "Event Exclusive",
      "Prerelease Promo",
      "Movie Promo",
    ]);
    expect(menu.querySelectorAll(".ifp-multi__check")).toHaveLength(4);
  });
});
