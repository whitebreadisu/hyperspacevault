import { beforeEach, describe, expect, it, vi } from "vitest";

// BL-344: the stashes client against the slice 1 contract -- routes, bodies,
// and the error codes the UI branches on.
const { authedFetch } = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock("./authedFetch", () => ({ authedFetch }));

import {
  createStash,
  deleteStash,
  getStashes,
  getStashItems,
  putVariantAllocations,
  StashApiError,
  updateStash,
} from "./stashes";
import { EmailNotVerifiedError } from "./inventory";

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => authedFetch.mockReset());

describe("BL-344 api/stashes", () => {
  it("GET /api/stashes and /api/stashes/items", async () => {
    authedFetch.mockResolvedValueOnce(res(200, [{ id: 1 }]));
    expect(await getStashes()).toEqual([{ id: 1 }]);
    expect(authedFetch).toHaveBeenLastCalledWith("/api/stashes");
    authedFetch.mockResolvedValueOnce(res(200, []));
    expect(await getStashItems()).toEqual([]);
    expect(authedFetch).toHaveBeenLastCalledWith("/api/stashes/items");
  });

  it("POST /api/stashes sends the name, and the description only when given", async () => {
    authedFetch.mockResolvedValue(res(201, { id: 3 }));
    await createStash("Red binder", null);
    expect(JSON.parse(authedFetch.mock.calls[0][1].body)).toEqual({ name: "Red binder" });
    authedFetch.mockResolvedValue(res(201, { id: 4 }));
    await createStash("Trade", "Shelf");
    expect(authedFetch.mock.calls[1][0]).toBe("/api/stashes");
    expect(authedFetch.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(authedFetch.mock.calls[1][1].body)).toEqual({
      name: "Trade",
      description: "Shelf",
    });
  });

  it("PUT /api/stashes/variants/{id} sends the full split", async () => {
    authedFetch.mockResolvedValue(res(200, { variant_id: 9, owned: 3, allocations: [] }));
    await putVariantAllocations(9, [{ stash_id: 1, quantity: 2 }]);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe("/api/stashes/variants/9");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ allocations: [{ stash_id: 1, quantity: 2 }] });
  });

  it("PATCH and DELETE /api/stashes/{id}", async () => {
    authedFetch.mockResolvedValueOnce(res(200, { id: 2, name: "New" }));
    await updateStash(2, { name: "New" });
    expect(authedFetch.mock.calls[0][0]).toBe("/api/stashes/2");
    expect(authedFetch.mock.calls[0][1].method).toBe("PATCH");
    authedFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteStash(2);
    expect(authedFetch.mock.calls[1][1].method).toBe("DELETE");
  });

  it.each([
    [409, "duplicate_name", "duplicate_name"],
    [409, "stash_limit", "stash_limit"],
    [409, "exceeds_owned", "exceeds_owned"],
    [404, "Not found", "not_found"],
    [422, [{ msg: "too long" }], "invalid"],
    [500, "boom", "unknown"],
  ])("a %i %j is StashApiError(%s)", async (status, detail, code) => {
    authedFetch.mockResolvedValue(res(status, { detail }));
    const err = await createStash("x", null).catch((e) => e);
    expect(err).toBeInstanceOf(StashApiError);
    expect((err as StashApiError).code).toBe(code);
  });

  it("403 email_not_verified is the shared EmailNotVerifiedError", async () => {
    authedFetch.mockResolvedValue(res(403, { detail: "email_not_verified" }));
    await expect(putVariantAllocations(1, [])).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });
});
