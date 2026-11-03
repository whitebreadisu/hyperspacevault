import { describe, expect, it, vi } from "vitest";
import { hydrateTreesOnReveal } from "./treeHydration";

// Each layout tree is hydrated once, the first time the width shows it.

function fakeQuery(matches: boolean, legacy = false) {
  let fn: (() => void) | null = null;
  const q = {
    matches,
    addListener: vi.fn((f: () => void) => {
      fn = f;
    }),
    ...(legacy
      ? {}
      : {
          addEventListener: vi.fn((_: string, f: () => void) => {
            fn = f;
          }),
        }),
  };
  const flip = (m: boolean) => {
    q.matches = m;
    fn?.();
  };
  return { query: q as unknown as MediaQueryList, flip, raw: q };
}

describe("tree hydration on reveal", () => {
  it("hydrates the visible tree, then the other once, however often it re-crosses", () => {
    const { query, flip } = fakeQuery(false);
    const hydrate = vi.fn();
    hydrateTreesOnReveal(query, hydrate);
    expect(hydrate.mock.calls).toEqual([[false]]);
    flip(true);
    flip(false);
    flip(true);
    flip(false);
    expect(hydrate.mock.calls).toEqual([[false], [true]]);
  });

  it("uses the legacy addListener where addEventListener is missing (Safari < 14)", () => {
    const { query, flip, raw } = fakeQuery(true, true);
    const hydrate = vi.fn();
    hydrateTreesOnReveal(query, hydrate);
    expect(raw.addListener).toHaveBeenCalledTimes(1);
    flip(false);
    expect(hydrate.mock.calls).toEqual([[true], [false]]);
  });

  it("a listener that throws still leaves the first tree hydrated and returns", () => {
    const query = {
      matches: false,
      addEventListener: () => {
        throw new Error("no");
      },
    } as unknown as MediaQueryList;
    const hydrate = vi.fn();
    expect(() => hydrateTreesOnReveal(query, hydrate)).not.toThrow();
    expect(hydrate).toHaveBeenCalledTimes(1);
  });
});
