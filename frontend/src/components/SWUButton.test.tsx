import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SWUButton } from "./SWUButton";

// DISPOSITION (BL-252 S6b review F5, CREATE): SWUButton had no unit test of
// its own; the BL-254 fold-back of the phone's MSWUButton added optional
// props. These pin that the desktop defaults are unchanged and that the
// `touch` size is the 44 px tap floor.

describe("SWUButton default markup (desktop callers unchanged)", () => {
  it("default props: class swu-btn only, no aria-label, 40 px tall, 13 px label, three-piece body", () => {
    render(<SWUButton>Save</SWUButton>);
    const btn = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(btn.className).toBe("swu-btn");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.hasAttribute("aria-label")).toBe(false);
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
    expect(btn.style.height).toBe("40px");
    const label = btn.querySelector(".swu-btn__label") as HTMLElement;
    expect(label.style.fontSize).toBe("13px");
    // left cap + centre stripe (svg + label) + right cap, caps scaled to the height
    const caps = btn.querySelectorAll("svg.swu-btn__cap");
    expect(caps).toHaveLength(2);
    caps.forEach((c) => expect(c.getAttribute("height")).toBe("40"));
    expect(btn.querySelectorAll("svg.swu-btn__center-bg")).toHaveLength(1);
    // active fill + white label
    expect(btn.querySelector("polygon")!.getAttribute("fill")).toBe("var(--color-primary)");
    expect(label.style.color).toBe("rgb(255, 255, 255)");
  });

  it("the other sizes keep their heights and label sizes (md 52 / 15, lg 64 / 18)", () => {
    const { rerender } = render(<SWUButton size="md">B</SWUButton>);
    let btn = screen.getByRole("button");
    expect(btn.style.height).toBe("52px");
    expect((btn.querySelector(".swu-btn__label") as HTMLElement).style.fontSize).toBe("15px");
    rerender(<SWUButton size="lg">B</SWUButton>);
    btn = screen.getByRole("button");
    expect(btn.style.height).toBe("64px");
    expect((btn.querySelector(".swu-btn__label") as HTMLElement).style.fontSize).toBe("18px");
  });

  it('size="touch" is the 44 px tap floor with a 14 px label', () => {
    render(<SWUButton size="touch">Go</SWUButton>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn.style.height).toBe("44px");
    expect((btn.querySelector(".swu-btn__label") as HTMLElement).style.fontSize).toBe("14px");
    btn
      .querySelectorAll("svg.swu-btn__cap")
      .forEach((c) => expect(c.getAttribute("height")).toBe("44"));
  });

  it("className / ariaLabel / ariaDisabled are additive; click still fires when aria-disabled", () => {
    const onClick = vi.fn();
    render(
      <SWUButton className="x" ariaLabel="y" ariaDisabled onClick={onClick}>
        z
      </SWUButton>
    );
    const btn = screen.getByRole("button", { name: "y" });
    expect(btn.className).toBe("swu-btn x");
    expect(btn.getAttribute("aria-label")).toBe("y");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("inactive (active=false) uses the off fill", () => {
    render(<SWUButton active={false}>Off</SWUButton>);
    expect(screen.getByRole("button").querySelector("polygon")!.getAttribute("fill")).toBe(
      "var(--color-btn-off)"
    );
  });
});
