import { describe, expect, it } from "vitest";
import { parseShareRoute, parseShareRouteToken } from "./shareRoute";

describe("parseShareRouteToken", () => {
  it("extracts the token from a /shared/{token} pathname", () => {
    expect(parseShareRouteToken("/shared/abc123")).toBe("abc123");
  });

  it("tolerates a trailing slash", () => {
    expect(parseShareRouteToken("/shared/abc123/")).toBe("abc123");
  });

  it("decodes a percent-encoded token", () => {
    expect(parseShareRouteToken("/shared/abc%2Fdef")).toBe("abc/def");
  });

  it("returns null for the root path", () => {
    expect(parseShareRouteToken("/")).toBeNull();
  });

  it("returns null for an unrelated path", () => {
    expect(parseShareRouteToken("/settings")).toBeNull();
  });

  it("returns null for /shared with no token segment", () => {
    expect(parseShareRouteToken("/shared/")).toBeNull();
    expect(parseShareRouteToken("/shared")).toBeNull();
  });

  it("returns null for a path with extra segments after the token", () => {
    expect(parseShareRouteToken("/shared/abc123/extra")).toBeNull();
  });

  it("returns null for a malformed percent-escape rather than throwing", () => {
    expect(parseShareRouteToken("/shared/%")).toBeNull();
  });
});

// BL-209 slice (c): stash links have their own route, `/shared/stash/{token}`.
describe("parseShareRoute", () => {
  it("reads a vault link as kind vault", () => {
    expect(parseShareRoute("/shared/abc123")).toEqual({ kind: "vault", token: "abc123" });
  });

  it("reads a stash link as kind stash, with or without a trailing slash", () => {
    expect(parseShareRoute("/shared/stash/abc123")).toEqual({ kind: "stash", token: "abc123" });
    expect(parseShareRoute("/shared/stash/abc%2Fdef/")).toEqual({
      kind: "stash",
      token: "abc/def",
    });
  });

  it("a stash link is never read as a vault link", () => {
    expect(parseShareRouteToken("/shared/stash/abc123")).toBeNull();
  });

  it("returns null for other paths, an empty stash token and malformed escapes", () => {
    expect(parseShareRoute("/")).toBeNull();
    expect(parseShareRoute("/shared/stash/")).toBeNull();
    expect(parseShareRoute("/shared/stash/abc/extra")).toBeNull();
    expect(parseShareRoute("/shared/stash/%")).toBeNull();
  });
});
