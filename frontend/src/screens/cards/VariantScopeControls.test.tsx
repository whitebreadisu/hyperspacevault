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
    // Not a check-box row.
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

  // REPLACE (BL-259 fix run, owner decision 2026-10-12: whole scope picker
  // single-select chips): was "the expanded plain rows keep their check-box
  // rows (not restyled)" -- four `.ifp-multi__item[role=option]` rows and four
  // check glyphs. The four extra finishes are now the same one-chip row as
  // Showcase; same four values, same order, behind the same expander.
  const EXTRA = ["Convention Exclusive", "Event Exclusive", "Prerelease Promo", "Movie Promo"];

  it("fr4-02 the four extra finishes are one-chip rows; no check-box anywhere in the menu", () => {
    const { menu, items } = openMenu(null);
    // Hidden until expanded.
    expect(menu.querySelector('[data-scope="Convention Exclusive"]')).toBeNull();
    fireEvent.click(screen.getByText("Show all finishes…"));
    expect(screen.getByText("Hide extra finishes")).toBeTruthy();

    const children = [...items.children] as HTMLElement[];
    const expander = children.findIndex((el) => el.classList.contains("vs-scope-menu__expander"));
    const tail = children.slice(expander + 1);
    expect(tail.map((el) => el.dataset.row)).toEqual(EXTRA);
    for (const row of tail) {
      const raw = row.dataset.row!;
      expect(row.classList.contains("vs-scope-menu__row--single")).toBe(true);
      expect(row.querySelector(".vs-scope-menu__row-label")?.textContent).toBe(raw);
      const chips = row.querySelectorAll("button.ifp-finish-pair__chip");
      expect(chips).toHaveLength(1);
      // The chip repeats the row's label (the Showcase precedent).
      expect(chips[0].textContent).toBe(raw);
      expect((chips[0] as HTMLButtonElement).dataset.scope).toBe(raw);
      expect((chips[0] as HTMLButtonElement).type).toBe("button");
      expect(chips[0].getAttribute("aria-pressed")).toBe("false");
    }
    // No check-box element, check-box row or option-role row in the whole menu.
    expect(menu.querySelectorAll(".ifp-multi__check")).toHaveLength(0);
    expect(menu.querySelectorAll(".ifp-multi__item")).toHaveLength(0);
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(menu.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).toHaveLength(0);
    // 14 values, each offered by exactly one chip.
    const scopes = [...menu.querySelectorAll("[data-scope]")].map(
      (el) => (el as HTMLElement).dataset.scope
    );
    expect(scopes).toHaveLength(14);
    expect(new Set(scopes).size).toBe(14);
  });

  it.each(EXTRA)("fr4-02 %s selects via its chip with the unchanged raw value", (raw) => {
    const { menu, onScopeChange } = openMenu(null);
    fireEvent.click(screen.getByText("Show all finishes…"));
    fireEvent.click(menu.querySelector(`button[data-scope="${raw}"]`)!);
    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith(raw);
    expect(document.querySelector(".vs-scope-menu")).toBeNull();
  });

  it("fr4-02 a selected extra finish reads pressed on its chip alone", () => {
    const { menu } = openMenu("Prerelease Promo");
    fireEvent.click(screen.getByText("Show all finishes…"));
    const chip = menu.querySelector('[data-scope="Prerelease Promo"]')!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.classList.contains("ifp-finish-pair__chip--on")).toBe(true);
    expect(menu.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(screen.getByTitle("Scope pips + Value to a single variant").textContent).toContain(
      "PIPS · Prerelease"
    );
  });
});
