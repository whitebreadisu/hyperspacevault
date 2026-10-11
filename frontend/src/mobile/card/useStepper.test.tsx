import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryVariant } from "../../utils/inventory";
import { ADJUST_DEBOUNCE_MS, GENERIC_ERROR, useStepper } from "./useStepper";

vi.mock("../../api/inventory", async (orig) => {
  const real = await orig<typeof import("../../api/inventory")>();
  return { ...real, adjustCard: vi.fn() };
});
import { adjustCard } from "../../api/inventory";
const adjust = vi.mocked(adjustCard);

const V: InventoryVariant = {
  variant_id: 17,
  variant_type: "Standard",
  finish: "Standard",
  channel: "Retail",
  source_set_code: "ASH",
  card_number: "112",
  front_image_url: null,
  back_image_url: null,
  quantity: 2,
};
const result = (quantity: number) => ({
  variant_id: 17,
  quantity,
  applied: 0,
  requested: 0,
  blocked: false,
  reason: null,
  over_limit: false,
  playset_complete: false,
});

describe("S2-05 stepper calls + optimistic refresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    adjust.mockReset();
  });

  it("moves the shown quantity at once and batches taps into one adjust call", async () => {
    adjust.mockResolvedValue(result(4));
    const patch = vi.fn();
    const { result: h } = renderHook(() => useStepper(patch));
    act(() => h.current.increment(V));
    act(() => h.current.increment(V));
    expect(h.current.qtyOf(V)).toBe(4);
    expect(adjust).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(ADJUST_DEBOUNCE_MS);
    });
    expect(adjust).toHaveBeenCalledTimes(1);
    expect(adjust).toHaveBeenCalledWith(17, 2);
    expect(patch).toHaveBeenCalledWith(17, 4);
    // The override is dropped: the shown value now comes from the shared data.
    expect(h.current.qtyOf({ ...V, quantity: 4 })).toBe(4);
    expect(h.current.qtyOf(V)).toBe(2);
  });

  it("the server's value is authoritative (a hard cap clamps)", async () => {
    adjust.mockResolvedValue(result(3));
    const patch = vi.fn();
    const { result: h } = renderHook(() => useStepper(patch));
    act(() => h.current.increment(V));
    act(() => h.current.increment(V));
    await act(async () => {
      vi.advanceTimersByTime(ADJUST_DEBOUNCE_MS);
    });
    expect(patch).toHaveBeenCalledWith(17, 3);
  });

  it("a failure snaps back to the server value with desktop's message", async () => {
    adjust.mockRejectedValue(new Error("500"));
    const patch = vi.fn();
    const { result: h } = renderHook(() => useStepper(patch));
    act(() => h.current.decrement(V));
    expect(h.current.qtyOf(V)).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(ADJUST_DEBOUNCE_MS);
    });
    expect(h.current.qtyOf(V)).toBe(2);
    expect(h.current.error).toBe(GENERIC_ERROR);
    expect(patch).not.toHaveBeenCalled();
  });

  it("leaving the screen flushes an open batch immediately", async () => {
    adjust.mockResolvedValue(result(3));
    const patch = vi.fn();
    const { result: h, unmount } = renderHook(() => useStepper(patch));
    act(() => h.current.increment(V));
    await act(async () => {
      unmount();
    });
    expect(adjust).toHaveBeenCalledWith(17, 1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(patch).toHaveBeenCalledWith(17, 3);
  });
});
