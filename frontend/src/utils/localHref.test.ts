import { describe, expect, it } from "vitest";
import { localHref } from "./localHref";

describe("localHref", () => {
  it.each(["/", "/cards/", "/cards/sor/005/", "/cards/sor/t01/", "/?card=sor-006"])(
    "keeps the same-origin path %s unchanged",
    (p) => {
      expect(localHref(p)).toBe(p);
    }
  );

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<b>x</b>",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/cards/<script>/",
    "/cards/a b/",
    "/cards/%2e%2e/",
    "cards/sor/005/",
    "",
    null,
    undefined,
  ])("turns %s into the app root", (p) => {
    expect(localHref(p)).toBe("/");
  });
});
