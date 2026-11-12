import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveShare,
  getSharedQuantities,
  getSharedLimits,
  getSharedStash,
  ShareResolveError,
  stashQuantities,
  stashShareLabel,
  stashShareUrl,
} from "./sharedView";
import { parseShareRoute } from "../utils/shareRoute";

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

// BL-209 slice (c): a stash link's read, its route and its quantities.
describe("stash links (getSharedStash, stashShareUrl, stashQuantities)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const VIEW = {
    share_name: "Rowan",
    stash: { name: "Trade binder", description: null },
    rows: [
      { variant_id: 11, quantity: 2, stashed_at: "2026-11-01T00:00:00Z", market: 1, low: 0.5 },
      { variant_id: 12, quantity: 0, stashed_at: "2026-11-02T00:00:00Z", market: null, low: null },
    ],
    totals: { printings: 2, copies: 2, value_market: 2, value_low: 1 },
  };

  it("GETs /api/shared/{token}/stash with no Authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(VIEW));
    expect(await getSharedStash("stok/1")).toEqual(VIEW);
    expect(fetchSpy).toHaveBeenCalledWith("/api/shared/stok%2F1/stash");
    expect(fetchSpy.mock.calls[0][1]).toBeUndefined();
  });

  it("maps 404 / 429 (with Retry-After) / other to the resolve error codes", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(jsonResponse({ detail: "Not found" }, 404));
    await expect(getSharedStash("x")).rejects.toMatchObject({ code: "not_found", status: 404 });
    spy.mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "30" }));
    await expect(getSharedStash("x")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 30,
    });
    spy.mockResolvedValueOnce(jsonResponse({}, 500));
    const err = await getSharedStash("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareResolveError);
    expect(err).toMatchObject({ code: "unknown" });
  });

  it("builds /shared/stash/{token} links that parse back to the same token", () => {
    for (const token of ["abc_DEF-123", "a/b c%"]) {
      const url = stashShareUrl(token, "https://www.example.test");
      expect(url.startsWith("https://www.example.test/shared/stash/")).toBe(true);
      expect(parseShareRoute(new URL(url).pathname)).toEqual({ kind: "stash", token });
    }
    // Default origin: this page's own.
    expect(stashShareUrl("t1")).toBe(`${window.location.origin}/shared/stash/t1`);
  });

  it("stashQuantities maps each printing to its in-stash count (zero rows dropped)", () => {
    expect(stashQuantities(VIEW)).toEqual({ 11: 2 });
  });

  it("stashShareLabel is '<share name> · <stash name>'", () => {
    expect(stashShareLabel(VIEW)).toBe("Rowan · Trade binder");
  });
});
