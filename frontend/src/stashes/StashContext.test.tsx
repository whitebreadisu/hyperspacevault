import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StashData } from "./StashContext";

// BL-344: the stash data source. Own vault only: disabled (a share, signed
// out, no provider) fetches nothing and holds nothing; enabled reads the list
// and the sparse items once; a Done commit writes the split and re-reads; a
// switch to disabled drops what was held.
const {
  getStashes,
  getStashItems,
  putVariantAllocations,
  createStash,
  returnStashItems,
  deleteStash,
} = vi.hoisted(() => ({
  getStashes: vi.fn(),
  getStashItems: vi.fn(),
  putVariantAllocations: vi.fn(),
  createStash: vi.fn(),
  returnStashItems: vi.fn(),
  deleteStash: vi.fn(),
}));
vi.mock("../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../api/stashes")>()),
  getStashes,
  getStashItems,
  putVariantAllocations,
  createStash,
  returnStashItems,
  deleteStash,
}));

import { StashProvider, useStashes } from "./StashContext";
import { resetStashSaveStoreForTests, stashSaveStore } from "./stashSaveStore";

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
  resetStashSaveStoreForTests();
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

  // PORT (R1-11 round 4): the provider's saveVariant was a second PUT path
  // outside the save store's queue and is gone; the store's save lands here
  // the same way (the response at once, then a re-read).
  it("a card-detail save (the save store) shows the response, then re-reads", async () => {
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
      stashSaveStore.edit(7, { 1: 2, 2: 1 }, () => ({ 1: 3, 2: 0 }));
      stashSaveStore.flush(7);
    });
    await waitFor(() => expect(getStashes).toHaveBeenCalledTimes(2));
    expect(putVariantAllocations).toHaveBeenCalledWith(7, [{ stash_id: 1, quantity: 3 }], {
      expected: [
        { stash_id: 1, quantity: 2 },
        { stash_id: 2, quantity: 1 },
      ],
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(seen!.allocationsFor(7)).toEqual({ 1: 3 }));
  });

  // CREATE (R1-11 round 4): reads are sequenced -- an answer older than the
  // newest read started is ignored.
  it("an older re-read that answers last does not overwrite a newer one", async () => {
    render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    let resolveOlder!: (v: unknown) => void;
    const older = { promise: new Promise((r) => (resolveOlder = r)) };
    getStashItems.mockReturnValueOnce(older.promise);
    getStashItems.mockResolvedValueOnce([{ stash_id: 1, variant_id: 7, quantity: 1 }]);
    let first!: Promise<void>;
    await act(async () => {
      first = seen!.refresh();
      await seen!.refresh();
    });
    expect(seen!.allocationsFor(7)).toEqual({ 1: 1 });
    await act(async () => {
      resolveOlder([{ stash_id: 1, variant_id: 7, quantity: 3 }]);
      await first;
    });
    expect(seen!.allocationsFor(7)).toEqual({ 1: 1 });
  });

  // CREATE (R1-11 round 5): a direct user switch keeps `enabled` true; the
  // provider drops user A's data and ignores A's read that answers late.
  it("a direct user switch: A's late read is ignored and B sees only B's data", async () => {
    let resolveA!: (v: unknown) => void;
    getStashItems.mockReturnValueOnce(new Promise((r) => (resolveA = r)));
    const { rerender } = render(
      <StashProvider enabled uid="user-a">
        <Probe />
      </StashProvider>
    );
    getStashes.mockResolvedValue([{ ...STASH, id: 9, name: "B's binder" }]);
    getStashItems.mockResolvedValue([{ stash_id: 9, variant_id: 7, quantity: 1 }]);
    rerender(
      <StashProvider enabled uid="user-b">
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    await act(async () => {
      resolveA([{ stash_id: 1, variant_id: 7, quantity: 2 }]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(seen!.stashes.map((s) => s.name)).toEqual(["B's binder"]);
    expect(seen!.allocationsFor(7)).toEqual({ 9: 1 });
  });

  it("a direct user switch after A's data loaded: A's list goes, B's is read", async () => {
    const { rerender } = render(
      <StashProvider enabled uid="user-a">
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    expect(seen!.stashes.map((s) => s.name)).toEqual(["Red binder"]);
    let resolveB!: (v: unknown) => void;
    getStashes.mockResolvedValue([{ ...STASH, id: 9, name: "B's binder" }]);
    getStashItems.mockReturnValueOnce(new Promise((r) => (resolveB = r)));
    rerender(
      <StashProvider enabled uid="user-b">
        <Probe />
      </StashProvider>
    );
    // Before B's read lands, nothing of A's is shown.
    await waitFor(() => expect(seen!.stashes).toEqual([]));
    expect(seen!.allocationsFor(7)).toEqual({});
    await act(async () => {
      resolveB([{ stash_id: 9, variant_id: 7, quantity: 1 }]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(seen!.stashes.map((s) => s.name)).toEqual(["B's binder"]);
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

// The Stashes page's writes: an answer that lands after a sign-out (or in)
// is not applied; a delete drops the stash from every printing's split
// locally, so the totals are right even when the re-read fails.
describe("StashProvider writes across a session change and a failed re-read", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it("a return answered after a sign-out is not applied and nothing is re-read", async () => {
    const { rerender } = render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    const answer = deferred<unknown>();
    returnStashItems.mockReturnValue(answer.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = seen!.returnItems(1, [{ variant_id: 7, quantity: 2 }]);
    });
    // Sign out, then back in, while the POST is out.
    rerender(
      <StashProvider enabled={false}>
        <Probe />
      </StashProvider>
    );
    rerender(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    const reads = getStashItems.mock.calls.length;
    await act(async () => {
      answer.resolve({ stash_id: 1, copies: 0, items: [{ variant_id: 7, quantity: 0 }] });
      await pending;
    });
    // The fresh session's own read stands.
    expect(seen!.allocationsFor(7)).toEqual({ 1: 2, 2: 1 });
    expect(getStashItems.mock.calls.length).toBe(reads);
  });

  // PORT (R1-11 round 4): a save answered after the user changed is not
  // applied (the store's generation; the provider's own read stands).
  it("a save answered after a user change is not applied", async () => {
    const { rerender } = render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    const answer = deferred<unknown>();
    putVariantAllocations.mockReturnValue(answer.promise);
    act(() => {
      stashSaveStore.edit(7, { 1: 2, 2: 1 }, () => ({ 1: 0, 2: 0 }));
      stashSaveStore.flush(7);
    });
    await waitFor(() => expect(putVariantAllocations).toHaveBeenCalledTimes(1));
    stashSaveStore.setUser("someone-else");
    rerender(
      <StashProvider enabled={false}>
        <Probe />
      </StashProvider>
    );
    rerender(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    await act(async () => {
      answer.resolve({ variant_id: 7, owned: 3, allocations: [] });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(seen!.allocationsFor(7)).toEqual({ 1: 2, 2: 1 });
  });

  it("delete drops the stash from every printing's split even when the re-read fails", async () => {
    render(
      <StashProvider enabled>
        <Probe />
      </StashProvider>
    );
    await waitFor(() => expect(seen!.ready).toBe(true));
    expect(seen!.stashedTotal(7)).toBe(3);
    deleteStash.mockResolvedValue(undefined);
    getStashItems.mockRejectedValueOnce(new Error("offline"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      await seen!.remove(1);
    });
    expect(seen!.stashes).toEqual([]);
    expect(seen!.allocationsFor(7)).toEqual({ 2: 1 });
    expect(seen!.stashedTotal(7)).toBe(1);
    expect(seen!.stale).toBe(true);
    spy.mockRestore();
  });
});
