import { describe, it, expect, vi, beforeEach } from "vitest";
import { authedFetch } from "./authedFetch";

const { authState } = vi.hoisted(() => ({
  authState: { currentUser: null as { getIdToken: () => Promise<string> } | null },
}));

vi.mock("../firebase", () => ({
  auth: authState,
}));

describe("authedFetch", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("omits the Authorization header when signed out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/inventory");
    const headers = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
  });

  it("attaches a Bearer token when signed in", async () => {
    authState.currentUser = { getIdToken: vi.fn().mockResolvedValue("token123") };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/inventory");
    const headers = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token123");
  });
});
