import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VariantAllocationResult } from "../api/stashes";

// The card detail's save store (stashSaveStore.ts) against a small fake
// server: the PUT replaces a printing's split, or answers 409 split_changed
// when `expected` is not the stored split. Covers the round-4 review
// findings: the user boundary, optimistic concurrency (rebase + one retry),
// external writes, the timeout, the snapshot after the owned wait, listener
// isolation, and the three lines the r3 mutation run left unpinned (the
// owned clamp, the entry drop, the user reset).
const { putVariantAllocations } = vi.hoisted(() => ({ putVariantAllocations: vi.fn() }));
vi.mock("../api/stashes", async (orig) => ({
  ...(await orig<typeof import("../api/stashes")>()),
  putVariantAllocations,
}));

import { SplitChangedError } from "../api/stashes";
import { resetOwnedSettleForTests, trackOwnedRequest } from "../utils/ownedSettle";
import { resetStashSaveStoreForTests, stashSaveStore } from "./stashSaveStore";
import type { Split } from "./stashSaveStore";

type Alloc = { stash_id: number; quantity: number }[];
const toSplit = (a: Alloc): Split => Object.fromEntries(a.map((x) => [x.stash_id, x.quantity]));
const toAlloc = (s: Split): Alloc =>
  Object.entries(s)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => ({ stash_id: Number(id), quantity: q }));
const same = (a: Split, b: Split) => JSON.stringify(toAlloc(a)) === JSON.stringify(toAlloc(b));

/** The stored splits per printing, and the PUT's semantics. */
let server: Map<number, Split>;
function fakeServer() {
  putVariantAllocations.mockImplementation(
    async (v: number, alloc: Alloc, opts: { expected?: Alloc } = {}) => {
      const now = server.get(v) ?? {};
      const result: VariantAllocationResult = {
        variant_id: v,
        owned: 3,
        allocations: toAlloc(now),
      };
      if (opts.expected && !same(toSplit(opts.expected), now)) throw new SplitChangedError(result);
      server.set(v, toSplit(alloc));
      return { variant_id: v, owned: 3, allocations: alloc };
    }
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const bodies = () => putVariantAllocations.mock.calls.map((c) => [c[0], c[1]]);

beforeEach(() => {
  vi.clearAllMocks();
  resetStashSaveStoreForTests();
  resetOwnedSettleForTests();
  server = new Map();
  fakeServer();
  stashSaveStore.setUser("user-1");
  stashSaveStore.setOwned(1, 3);
  stashSaveStore.setOwned(2, 3);
});

describe("the user boundary", () => {
  it("cross-user repro: user 1's queued job is never sent once user 2 signs in", async () => {
    const hung = deferred<VariantAllocationResult>();
    putVariantAllocations.mockReturnValueOnce(hung.promise);
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    await tick();
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    stashSaveStore.edit(2, { 10: 2 }, () => ({ 10: 0 }));
    stashSaveStore.flush(2); // queued behind the hung PUT
    stashSaveStore.setUser(null); // sign-out
    stashSaveStore.setUser("user-2"); // sign-in as someone else
    hung.reject(new Error("503"));
    await tick(10);
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
  });

  it("a direct user A -> user B switch drops open windows and entries", async () => {
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    expect(stashSaveStore.desired(1)).toEqual({ 10: 1 });
    stashSaveStore.setUser("user-2");
    expect(stashSaveStore.desired(1)).toBeUndefined();
    expect(stashSaveStore.busy(1)).toBe(false);
    await tick(500); // past the window
    expect(putVariantAllocations).not.toHaveBeenCalled();
  });

  it("a 409 answered after a user switch is not retried under the new user", async () => {
    const first = deferred<VariantAllocationResult>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    await tick();
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    stashSaveStore.setUser("user-2");
    first.reject(
      new SplitChangedError({
        variant_id: 1,
        owned: 3,
        allocations: [{ stash_id: 20, quantity: 1 }],
      })
    );
    await tick(10);
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
  });

  it("the uid source is read at queue and send time", async () => {
    let uid: string | null = "user-1";
    stashSaveStore.setUidSource(() => uid);
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    uid = "user-2"; // Firebase switched before the app heard of it
    stashSaveStore.flush(1);
    await tick();
    expect(putVariantAllocations).not.toHaveBeenCalled();
  });
});

describe("optimistic concurrency", () => {
  it("409 split_changed: the clicks are rebased onto the stored split and sent once more", async () => {
    server.set(1, {}); // a return elsewhere emptied it; the client still thinks {10: 1}
    stashSaveStore.edit(1, { 10: 1 }, (d) => ({ ...d, 20: 1 }));
    stashSaveStore.flush(1);
    await tick(10);
    expect(bodies()).toEqual([
      [
        1,
        [
          { stash_id: 10, quantity: 1 },
          { stash_id: 20, quantity: 1 },
        ],
      ],
      [1, [{ stash_id: 20, quantity: 1 }]],
    ]);
    expect(putVariantAllocations.mock.calls[1][2].expected).toEqual([]);
    expect(server.get(1)).toEqual({ 20: 1 });
    expect(stashSaveStore.desired(1)).toBeUndefined();
  });

  it("an external return during a queued save is not undone", async () => {
    server.set(1, { 10: 2 });
    stashSaveStore.edit(1, { 10: 2 }, (d) => ({ ...d, 20: 1 }));
    // Before the job runs, the Stashes page returns both copies of stash 10.
    server.set(1, {});
    stashSaveStore.flush(1);
    await tick(10);
    expect(server.get(1)).toEqual({ 20: 1 });
  });

  it("over owned after a 409, the user's own increments give way, not the other device's write", async () => {
    server.set(1, { 20: 3 }); // another device stashed all 3 owned copies
    stashSaveStore.edit(1, {}, () => ({ 10: 1 })); // this client still saw nothing
    stashSaveStore.flush(1);
    await tick(10);
    expect(server.get(1)).toEqual({ 20: 3 });
    expect(putVariantAllocations).toHaveBeenCalledTimes(1); // nothing left to send
    expect(stashSaveStore.desired(1)).toBeUndefined();
  });

  it("a second 409 rolls back to the stored split and reports the failure", async () => {
    const failures: unknown[] = [];
    const off = stashSaveStore.onFailure((v, err) => failures.push([v, err]));
    let n = 0;
    putVariantAllocations.mockImplementation(async (v: number) => {
      n += 1;
      throw new SplitChangedError({
        variant_id: v,
        owned: 3,
        allocations: [{ stash_id: 30, quantity: n }],
      });
    });
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    await tick(10);
    off();
    expect(putVariantAllocations).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(1);
    expect((failures[0] as unknown[])[1]).toBeInstanceOf(SplitChangedError);
    expect(stashSaveStore.desired(1)).toBeUndefined(); // back on the stored split
  });
});

describe("the queue", () => {
  it("one PUT on the wire: a second printing waits for the first", async () => {
    const first = deferred<VariantAllocationResult>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    stashSaveStore.edit(2, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(2);
    await tick(10);
    expect(putVariantAllocations).toHaveBeenCalledTimes(1);
    first.resolve({ variant_id: 1, owned: 3, allocations: [{ stash_id: 10, quantity: 1 }] });
    await tick(10);
    expect(putVariantAllocations).toHaveBeenCalledTimes(2);
  });

  it("a PUT that never answers times out: rollback, failure, and the queue goes on", async () => {
    resetStashSaveStoreForTests({ timeoutMs: 40 });
    stashSaveStore.setUser("user-1");
    stashSaveStore.setOwned(1, 3);
    const failures: number[] = [];
    const off = stashSaveStore.onFailure((v) => failures.push(v));
    putVariantAllocations.mockReturnValueOnce(new Promise(() => {}));
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    stashSaveStore.edit(2, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(2);
    await tick(120);
    off();
    expect(failures).toEqual([1]);
    expect(stashSaveStore.desired(1)).toBeUndefined();
    expect(putVariantAllocations.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(putVariantAllocations.mock.calls[0][2].signal.aborted).toBe(true);
  });

  it("the owned wait is capped by the same timeout", async () => {
    resetStashSaveStoreForTests({ timeoutMs: 40 });
    stashSaveStore.setUser("user-1");
    const failures: number[] = [];
    const off = stashSaveStore.onFailure((v) => failures.push(v));
    void trackOwnedRequest(1, new Promise(() => {}));
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    await tick(120);
    off();
    expect(failures).toEqual([1]);
    expect(putVariantAllocations).not.toHaveBeenCalled();
  });

  it("the split is snapshotted after the owned wait: clicks made meanwhile are sent", async () => {
    const owned = deferred<void>();
    void trackOwnedRequest(1, owned.promise);
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    await tick();
    stashSaveStore.edit(1, {}, (d) => ({ ...d, 20: 1 })); // while the owned request is out
    owned.resolve();
    await tick(10);
    expect(bodies()[0]).toEqual([
      1,
      [
        { stash_id: 10, quantity: 1 },
        { stash_id: 20, quantity: 1 },
      ],
    ]);
  });

  it("a listener that throws neither fails the save nor stops the queue", async () => {
    const failures: number[] = [];
    const offF = stashSaveStore.onFailure((v) => failures.push(v));
    const offS = stashSaveStore.onSaved(() => {
      throw new Error("listener bug");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    stashSaveStore.edit(2, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(2);
    await tick(10);
    offF();
    offS();
    err.mockRestore();
    expect(failures).toEqual([]);
    expect(putVariantAllocations).toHaveBeenCalledTimes(2);
    expect(stashSaveStore.desired(1)).toBeUndefined();
  });
});

describe("pinned lines (r3 mutation survivors)", () => {
  it("entry drop: once confirmed and idle, views fall back to the server split", async () => {
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    expect(stashSaveStore.desired(1)).toEqual({ 10: 1 });
    stashSaveStore.flush(1);
    await tick(10);
    expect(stashSaveStore.desired(1)).toBeUndefined();
    expect(stashSaveStore.busy(1)).toBe(false);
  });

  it("owned clamp: a rollback keeps later clicks only within the printing's owned count now", async () => {
    const first = deferred<VariantAllocationResult>();
    putVariantAllocations.mockReturnValueOnce(first.promise);
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.flush(1);
    await tick();
    stashSaveStore.edit(1, {}, (d) => ({ ...d, 20: 2 })); // later clicks: 2 more
    stashSaveStore.setOwned(1, 1); // owned dropped meanwhile
    first.reject(new Error("500"));
    await tick(10);
    const after = stashSaveStore.desired(1) ?? {};
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
  });

  it("user reset: a new user starts with no entries (setUser)", () => {
    stashSaveStore.edit(1, {}, () => ({ 10: 1 }));
    stashSaveStore.edit(2, {}, () => ({ 10: 1 }));
    stashSaveStore.setUser("user-2");
    expect(stashSaveStore.desired(1)).toBeUndefined();
    expect(stashSaveStore.desired(2)).toBeUndefined();
    expect(stashSaveStore.desiredTotal(1)).toBeUndefined();
  });
});
