import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CapStepper } from "./CapStepper";

// BL-182: CapStepper is new, so there's no prior suite to port/replace --
// this file is net-new coverage for the settings-local "-, value, +" cap
// editor (visual language borrowed from the card popup's owned-quantity
// plate, but a standalone component here).

describe("CapStepper", () => {
  it("renders the label, floor hint, and current value", () => {
    render(
      <CapStepper
        label="LEADERS & BASES"
        ariaName="Leaders & Bases"
        floorHint="min 1"
        value={1}
        floor={1}
        ceiling={999}
        disabled={false}
        onDecrement={() => {}}
        onIncrement={() => {}}
      />
    );

    expect(screen.getByText("LEADERS & BASES")).toBeInTheDocument();
    expect(screen.getByText("min 1")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("calls onDecrement / onIncrement when their buttons are clicked", () => {
    const onDecrement = vi.fn();
    const onIncrement = vi.fn();
    render(
      <CapStepper
        label="ALL OTHER CARDS"
        ariaName="All other cards"
        floorHint="min 3"
        value={5}
        floor={3}
        ceiling={999}
        disabled={false}
        onDecrement={onDecrement}
        onIncrement={onIncrement}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /decrease all other cards cap/i }));
    fireEvent.click(screen.getByRole("button", { name: /increase all other cards cap/i }));

    expect(onDecrement).toHaveBeenCalledTimes(1);
    expect(onIncrement).toHaveBeenCalledTimes(1);
  });

  it("disables the decrement button at the floor and the increment button at the ceiling", () => {
    const { rerender } = render(
      <CapStepper
        label="LEADERS & BASES"
        ariaName="Leaders & Bases"
        floorHint="min 1"
        value={1}
        floor={1}
        ceiling={999}
        disabled={false}
        onDecrement={() => {}}
        onIncrement={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /decrease leaders & bases cap/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /increase leaders & bases cap/i })
    ).not.toBeDisabled();

    rerender(
      <CapStepper
        label="LEADERS & BASES"
        ariaName="Leaders & Bases"
        floorHint="min 1"
        value={999}
        floor={1}
        ceiling={999}
        disabled={false}
        onDecrement={() => {}}
        onIncrement={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /increase leaders & bases cap/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /decrease leaders & bases cap/i })
    ).not.toBeDisabled();
  });

  it("disables both buttons when the disabled prop is set, regardless of value", () => {
    render(
      <CapStepper
        label="LEADERS & BASES"
        ariaName="Leaders & Bases"
        floorHint="min 1"
        value={5}
        floor={1}
        ceiling={999}
        disabled={true}
        onDecrement={() => {}}
        onIncrement={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /decrease leaders & bases cap/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /increase leaders & bases cap/i })).toBeDisabled();
  });
});
