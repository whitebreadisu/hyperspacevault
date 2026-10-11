import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { back, go, parseHash, resetRouterForTest } from "./router";

describe("S1-03 router", () => {
  beforeEach(() => {
    resetRouterForTest();
    window.history.replaceState(null, "", "#/more");
  });
  afterEach(() => vi.restoreAllMocks());

  it("parses and round-trips a canonical hash", () => {
    for (const h of [
      "#/vault",
      "#/card/12",
      "#/more/feedback",
      "#/vault?finish=Hyperspace&set=SOR",
    ]) {
      expect(parseHash(h).hash).toBe(h);
    }
    const r = parseHash("#/card/12/extra");
    expect(r.segs).toEqual(["card", "12", "extra"]);
  });

  it("decodes params", () => {
    const r = parseHash("#/vault?finish=Serialized%20Prestige&set=LAW");
    expect(r.params).toEqual({ finish: "Serialized Prestige", set: "LAW" });
    expect(r.path).toBe("vault");
  });

  it("normalises empty, retired and unknown hashes", () => {
    expect(parseHash("").hash).toBe("#/vault");
    expect(parseHash("#").hash).toBe("#/vault");
    expect(parseHash("#/new").hash).toBe("#/vault");
    expect(parseHash("#/home").hash).toBe("#/vault");
    expect(parseHash("#/decks").hash).toBe("#/more");
    expect(parseHash("#/nonsense/path?x=1")).toMatchObject({
      path: "vault",
      params: {},
      hash: "#/vault",
    });
  });

  it("back() at depth 0 goes to the vault", () => {
    const spy = vi.spyOn(window.history, "back");
    back();
    expect(spy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/vault");
  });

  it("back() after a go() walks history", () => {
    const spy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    go("#/card/3");
    expect(window.location.hash).toBe("#/card/3");
    back();
    expect(spy).toHaveBeenCalledTimes(1);
    back(); // depth exhausted again -> vault
    expect(window.location.hash).toBe("#/vault");
  });
});
