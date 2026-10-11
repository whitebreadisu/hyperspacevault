import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet, SheetHost } from "./Sheet";

// BL-249 S3 F1: while `locked` (a commit in flight) Escape and the scrim do
// not close the sheet; unlocked, they do.
describe("Sheet locked", () => {
  const mount = (locked: boolean, onClose: () => void) =>
    render(
      <SheetHost>
        <Sheet title="T" labelId="t" onClose={onClose} locked={locked}>
          body
        </Sheet>
      </SheetHost>
    );

  it("ignores Escape and the scrim while locked", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mount(true, onClose);
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      document.querySelector<HTMLElement>(".m-sheet-scrim")!.click();
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".m-sheet-layer--leaving")).toBeNull();
    vi.useRealTimers();
  });

  it("closes on Escape when not locked", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mount(false, onClose);
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
