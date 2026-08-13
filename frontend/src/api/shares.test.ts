import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listShares,
  createShare,
  renameShare,
  rotateShare,
  revokeShare,
  ShareApiError,
} from "./shares";

// Same mocking shape as inventoryImportExport.test.ts/deckCheck.test.ts --
// authedFetch itself is real, only global fetch + firebase auth state are
// stubbed.
const { authState } = vi.hoisted(() => ({
  authState: { currentUser: null as { getIdToken: () => Promise<string> } | null },
}));

vi.mock("../firebase", () => ({
  auth: authState,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RECORD = {
  id: 1,
  name: "Bobs big vault",
  scope: "inventory" as const,
  token: "tok-1",
  created_at: "2026-08-11T00:00:00Z",
  revoked: false,
};

describe("listShares", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("GETs /api/shares and returns the parsed array", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([RECORD]));

    const result = await listShares();

    expect(fetchSpy.mock.calls[0][0]).toBe("/api/shares");
    expect(result).toEqual([RECORD]);
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    await expect(listShares()).rejects.toMatchObject({ name: "ApiError", status: 401 });
  });
});

describe("createShare", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("POSTs the name and returns the created record", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(RECORD, 201));

    const result = await createShare("Bobs big vault");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/shares");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Bobs big vault" });
    expect(result).toEqual(RECORD);
  });

  it("throws a coded active_share_exists ShareApiError on 409 -- one active share per scope target", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    await expect(createShare("Another vault")).rejects.toMatchObject({
      name: "ShareApiError",
      code: "active_share_exists",
      status: 409,
    });
    await expect(createShare("Another vault")).rejects.toBeInstanceOf(ShareApiError);
  });

  it("throws a generic-coded ShareApiError on any other non-2xx status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(createShare("X")).rejects.toMatchObject({
      name: "ShareApiError",
      code: "unknown",
      status: 500,
    });
  });
});

describe("renameShare", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("PATCHes the name and returns the updated record (token unchanged)", async () => {
    const renamed = { ...RECORD, name: "New name" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(renamed));

    const result = await renameShare(1, "New name");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/shares/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "New name" });
    expect(result.token).toBe(RECORD.token);
    expect(result.name).toBe("New name");
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    await expect(renameShare(1, "")).rejects.toMatchObject({ name: "ApiError", status: 422 });
  });
});

describe("rotateShare", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("POSTs to /api/shares/{id}/rotate and returns the record with a new token", async () => {
    const rotated = { ...RECORD, token: "tok-2" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(rotated));

    const result = await rotateShare(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/shares/1/rotate");
    expect(init?.method).toBe("POST");
    expect(result.token).toBe("tok-2");
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    await expect(rotateShare(1)).rejects.toMatchObject({ name: "ApiError", status: 404 });
  });
});

describe("revokeShare", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("DELETEs /api/shares/{id} and resolves with no body on 204", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(revokeShare(1)).resolves.toBeUndefined();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/shares/1");
    expect(init?.method).toBe("DELETE");
  });

  it("throws ApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    await expect(revokeShare(1)).rejects.toMatchObject({ name: "ApiError", status: 404 });
  });
});
