import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveShare,
  getSharedQuantities,
  getSharedLimits,
  ShareResolveError,
} from "./sharedView";

// BL-205: this module intentionally uses plain `fetch`, never authedFetch --
// §19.1's whole point is that these three endpoints are the platform's first
// UNAUTHENTICATED read of tenant data. Coverage below asserts that directly
// (no Authorization header, regardless of whether the caller happens to be
// signed in -- see the "never attaches auth" test), plus the resolve
// endpoint's 404/429/2xx branches.

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

describe("resolveShare", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/shared/{token} with no Authorization header and returns the resolution", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ name: "Bobs big vault", scope: "inventory" }));

    const result = await resolveShare("tok-1");

    expect(fetchSpy).toHaveBeenCalledWith("/api/shared/tok-1");
    const headers = fetchSpy.mock.calls[0][1]?.headers;
    expect(headers).toBeUndefined();
    expect(result).toEqual({ name: "Bobs big vault", scope: "inventory" });
  });

  it("URL-encodes the token", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ name: "X", scope: "inventory" }));

    await resolveShare("a/b c");

    expect(fetchSpy).toHaveBeenCalledWith(`/api/shared/${encodeURIComponent("a/b c")}`);
  });

  it("throws a not_found ShareResolveError on 404 (invalid or revoked, indistinguishable)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    await expect(resolveShare("bad-token")).rejects.toMatchObject({
      name: "ShareResolveError",
      code: "not_found",
      status: 404,
    });
    await expect(resolveShare("bad-token")).rejects.toBeInstanceOf(ShareResolveError);
  });

  it("throws a rate_limited ShareResolveError on 429, carrying Retry-After when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "30" } })
    );

    await expect(resolveShare("tok-1")).rejects.toMatchObject({
      name: "ShareResolveError",
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it("a 429 with no Retry-After header leaves retryAfterSeconds undefined", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 429 }));

    await expect(resolveShare("tok-1")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: undefined,
    });
  });

  it("throws an unknown ShareResolveError on any other non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(resolveShare("tok-1")).rejects.toMatchObject({
      name: "ShareResolveError",
      code: "unknown",
      status: 500,
    });
  });
});

describe("getSharedQuantities", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/shared/{token}/quantities with no Authorization header", async () => {
    const rows = [{ variant_id: 1, quantity: 3 }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(rows));

    const result = await getSharedQuantities("tok-1");

    expect(fetchSpy).toHaveBeenCalledWith("/api/shared/tok-1/quantities");
    expect(fetchSpy.mock.calls[0][1]?.headers).toBeUndefined();
    expect(result).toEqual(rows);
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(getSharedQuantities("tok-1")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });
});

describe("getSharedLimits", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/shared/{token}/limits with no Authorization header", async () => {
    const body = { limits: [], cap_mode: "hard" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));

    const result = await getSharedLimits("tok-1");

    expect(fetchSpy).toHaveBeenCalledWith("/api/shared/tok-1/limits");
    expect(fetchSpy.mock.calls[0][1]?.headers).toBeUndefined();
    expect(result).toEqual(body);
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    await expect(getSharedLimits("tok-1")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });
});
