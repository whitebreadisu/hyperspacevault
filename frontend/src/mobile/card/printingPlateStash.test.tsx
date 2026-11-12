import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InventoryVariant } from "../../utils/inventory";
import { PrintingPlate } from "./PrintingPlate";

// A stash link's phone card detail (App Spec §19.1, §25.6): the plate is the
// selected printing's in-stash count alone -- no pips, no playset state, no
// "owned" wording, and it opens no Owned by finish. The vault's plate is
// unchanged (pips + "owned").

const variants = [
  { variant_id: 1, variant_type: "Standard", finish: "Standard", quantity: 2 },
  { variant_id: 2, variant_type: "Hyperspace", finish: "Hyperspace", quantity: 1 },
] as unknown as InventoryVariant[];

describe("phone printing plate on a stash link", () => {
  it("shows the selected printing's in-stash count, no pips, no owned wording, no button", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PrintingPlate
        name="Luke Skywalker"
        type="Unit"
        variants={variants}
        scope="Hyperspace"
        isAuthenticated
        onClick={onClick}
        stashCount
      />
    );
    const plate = container.querySelector(".m-plate-hit")!;
    expect(plate.getAttribute("aria-label")).toBe("Luke Skywalker: 1 in this stash");
    expect(container.querySelector(".gallery-plate__total")!.textContent).toBe("1");
    expect(container.querySelectorAll(".gallery-plate__pip")).toHaveLength(0);
    expect(container.querySelector(".gallery-plate--complete")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toMatch(/owned|playset/i);
  });

  it("the vault's plate keeps its pips and owned wording", () => {
    const { container } = render(
      <PrintingPlate
        name="Luke Skywalker"
        type="Unit"
        variants={variants}
        scope="Hyperspace"
        isAuthenticated
        onClick={vi.fn()}
      />
    );
    expect(container.querySelectorAll(".gallery-plate__pip")).toHaveLength(3);
    expect(container.querySelector("button")!.getAttribute("aria-label")).toMatch(/3 owned/);
  });
});
