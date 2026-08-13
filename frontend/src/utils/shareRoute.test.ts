import { describe, expect, it } from "vitest";
import { parseShareRouteToken } from "./shareRoute";

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
