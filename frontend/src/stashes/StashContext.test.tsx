import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StashData } from "./StashContext";

// BL-344: the stash data source. Own vault only: disabled (a share, signed
// out, no provider) fetches nothing and holds nothing; enabled reads the list
// and the sparse items once; a Done commit writes the split and re-reads; a
// switch to disabled drops what was held.
const { getStashes, getStashItems, putVariantAllocations, createStash } = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  putVariantAllocations: vi.fn(),
  createStash: vi.fn(),
}));
vi.mock("../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../api/stashes")>()),
  getStashes,
  getStashItems,
  putVariantAllocations,
  createStash,
}));

import { StashProvider, useStashes } from "./StashContext";

let seen: StashData | null = null;
function Probe() {
  const data = useStashes();
  useEffect(() => {
    seen = data;
  });
  return null;
}

const STASH = { id: 1, name: "Red binder", description: null, created_at: "x", copies: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  seen = null;
  getStashes.mockResolvedValue([STASH]);
  getStashItems.mockResolvedValue([
    { stash_id: 1, variant_id: 7, quantity: 2 },
    { stash_id: 2, variant_id: 7, quantity: 1 },
  ]);
});

describe("BL-344 StashProvider", () => {
  it("no provider reads as disabled", () => {
    render(<Probe />);
    expect(seen!.enabled).toBe(false);
    expect(seen!.stashedTotal(7)).toBe(0);
  });

  it("disabled fetches nothing", async () => {
    render(
      <StashProvider enabled={false}>
        <Probe />
      </StashProvider>
    );
    await act(async () => {});
    expect(getStashes).not.toHaveBeenCalled();
    expect(getStashItems).not.toHaveBeenCalled();
    expect(seen!.stashes).toEqual([]);
  });

  it("enabled reads the list and the items; totals per printing", async () => {
    render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    expect(seen!.stashes).toEqual([STASH]);
    expect(seen!.allocationsFor(7)).toEqual({ 1: 2, 2: 1 });
    expect(seen!.stashedTotal(7)).toBe(3);
    expect(seen!.stashedTotal(8)).toBe(0);
  });

  it("saveVariant PUTs the non-zero split, shows the response, then re-reads", async () => {
    putVariantAllocations.mockResolvedValue({
      variant_id: 7,
      owned: 3,
      allocations: [{ stash_id: 1, quantity: 3 }],
    });
    render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    getStashItems.mockResolvedValue([{ stash_id: 1, variant_id: 7, quantity: 3 }]);
    await act(async () => {
      await seen!.saveVariant(7, { 1: 3, 2: 0 });
    });
    expect(putVariantAllocations).toHaveBeenCalledWith(7, [{ stash_id: 1, quantity: 3 }]);
    expect(getStashes).toHaveBeenCalledTimes(2);
    expect(seen!.allocationsFor(7)).toEqual({ 1: 3 });
  });

  it("turning off drops what was held (a switch into a share, a sign-out)", async () => {
    const { rerender } = render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    rerender(
      <StashProvider enabled={false}>
        <Probe />
      </StashProvider>
    );
    expect(seen!.enabled).toBe(false);
    expect(seen!.stashes).toEqual([]);
    expect(seen!.stashedTotal(7)).toBe(0);
  });

  it("refresh while disabled fetches nothing", async () => {
    render(
      <StashProvider enabled={false}>
        <Probe />
      </StashProvider>
    );
    await act(async () => {
      await seen!.refresh();
    });
    expect(getStashes).not.toHaveBeenCalled();
  });
});

// Fold-in round 1 (F6): a share shown pauses the provider -- nothing fetched
// or exposed, the cache kept -- instead of dropping and refetching.
describe("BL-344 StashProvider paused", () => {
  it("paused exposes nothing; back on the own vault the cache returns with no refetch", async () => {
    const { rerender } = render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    rerender(
      <StashProvider enabled paused>
        <Probe />
      </StashProvider>
    );
    expect(seen!.enabled).toBe(false);
    expect(seen!.stashes).toEqual([]);
    rerender(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    expect(seen!.ready).toBe(true);
    expect(seen!.stashes).toEqual([STASH]);
    expect(getStashes).toHaveBeenCalledTimes(1);
  });

  it("booting paused (a share link) fetches nothing until the own vault shows", async () => {
    const { rerender } = render(
      <StashProvider enabled paused>
        <Probe />
      </StashProvider>
    );
    await act(async () => {});
    expect(getStashes).not.toHaveBeenCalled();
    rerender(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    expect(seen!.loading).toBe(true);
    await waitFor(() => expect(seen!.ready).toBe(true));
    expect(seen!.loading).toBe(false);
    expect(getStashes).toHaveBeenCalledTimes(1);
  });

  it("a failed first read ends loading (no room held forever)", async () => {
    getStashes.mockRejectedValue(new Error("offline"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.loading).toBe(false));
    expect(seen!.ready).toBe(false);
    spy.mockRestore();
  });
});
