import { afterEach, describe, expect, it } from "vitest";
import {
  cardAppHref,
  clearCardParam,
  formatCardParam,
  parseCardParam,
  resolveCardParam,
} from "./cardParam";

describe("?card= boot parameter", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("formats the set code lower-case and the number padded to 3", () => {
    expect(formatCardParam("SOR", "6")).toBe("sor-006");
    expect(formatCardParam("TWI", "272")).toBe("twi-272");
    expect(cardAppHref("SOR", "6")).toBe("/?card=sor-006");
  });

  it("parses the formatted value back, and rejects malformed ones", () => {
    expect(parseCardParam("?card=sor-006")).toEqual({ setCode: "SOR", number: "6" });
    expect(parseCardParam("?x=1&card=TS26-12")).toEqual({ setCode: "TS26", number: "12" });
    for (const bad of [
      "",
      "?card=",
      "?card=sor",
      "?card=sor-",
      "?card=s-1",
      "?card=sor-1a",
      "?card=<x>-1",
    ]) {
      expect(parseCardParam(bad)).toBeNull();
    }
  });

  it("resolves set + number to the non-token card", () => {
    const cards = [
      { id: 9, set_code: "TWI", base_card_number: "1", is_token: true },
      { id: 10, set_code: "TWI", base_card_number: "1", is_token: false },
      { id: 11, set_code: "SOR", base_card_number: "6", is_token: false },
    ];
    expect(resolveCardParam(cards, { setCode: "TWI", number: "1" })?.id).toBe(10);
    expect(resolveCardParam(cards, { setCode: "SOR", number: "6" })?.id).toBe(11);
    expect(resolveCardParam(cards, { setCode: "SOR", number: "7" })).toBeNull();
  });

  it("clears only the parameter, keeping the path, the rest of the query and the hash", () => {
    window.history.replaceState(null, "", "/?a=1&card=sor-006&b=2#/vault");
    clearCardParam();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/?a=1&b=2#/vault"
    );
  });
});
