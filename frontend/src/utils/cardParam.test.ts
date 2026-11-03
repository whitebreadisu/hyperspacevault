import { afterEach, describe, expect, it } from "vitest";
import {
  bootSignupParam,
  cardAppHref,
  clearCardParam,
  clearSignupParam,
  formatCardParam,
  parseCardParam,
  parseSignupParam,
  resolveCardParam,
  withSignup,
} from "./cardParam";

describe("?card= boot parameter", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("formats the set code lower-case and the number padded to 3", () => {
    expect(formatCardParam("SOR", "6")).toBe("sor-006");
    expect(formatCardParam("TWI", "272")).toBe("twi-272");
    expect(cardAppHref("SOR", "6")).toBe("/?card=sor-006");
  });

  it("URI-encodes both parts; real codes and numbers are unchanged", () => {
    expect(formatCardParam("TS26", "12")).toBe("ts26-012");
    expect(formatCardParam("SOR", "T01")).toBe("sor-T01");
    expect(formatCardParam("S&R", "1#2")).toBe("s%26r-1%232");
    expect(cardAppHref("a b", "5")).toBe("/?card=a%20b-005");
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

describe("?signup=1 boot parameter", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("is set only by signup=1", () => {
    expect(parseSignupParam("?signup=1")).toBe(true);
    expect(parseSignupParam("?card=sor-005&signup=1")).toBe(true);
    for (const bad of ["", "?signup", "?signup=0", "?signup=true", "?signups=1"]) {
      expect(parseSignupParam(bad)).toBe(false);
    }
  });

  it("is read on / only", () => {
    window.history.replaceState(null, "", "/?signup=1");
    expect(bootSignupParam()).toBe(true);
    window.history.replaceState(null, "", "/shared/abc?signup=1");
    expect(bootSignupParam()).toBe(false);
  });

  it("adds to an app link and clears like card, keeping everything else", () => {
    expect(withSignup("/?card=sor-005")).toBe("/?card=sor-005&signup=1");
    expect(withSignup("/")).toBe("/?signup=1");
    window.history.replaceState(null, "", "/?card=sor-005&signup=1#/vault");
    clearSignupParam();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/?card=sor-005#/vault"
    );
  });
});
