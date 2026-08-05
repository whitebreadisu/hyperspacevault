import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runImport,
  exportInventory,
  downloadCatalogReference,
  downloadBlob,
  ImportApiError,
} from "./inventoryImportExport";

// Same mocking shape as deckCheck.test.ts/authedFetch.test.ts -- authedFetch
// itself is real (unmocked), only the underlying global fetch + firebase
// auth state are stubbed, since this file's contract is "what does
// authedFetch get called with, and how are non-2xx responses turned into a
// typed error / how is a Content-Disposition filename read".
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

describe("runImport (BL-54 S3)", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("posts multipart/form-data (not JSON) with the file + mode/cap_handling/stage fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        stage: "dry_run",
        mode: "merge_add",
        cap_handling: "add_above",
        committed: false,
        totals: {
          rows: 0,
          resolved: 0,
          matched_by_fallback: 0,
          unresolved: 0,
          ambiguous: 0,
          trimmed: 0,
          ceiling_clamped: 0,
          duplicate_rows_merged: 0,
          unrecognized_columns: [],
          removed_by_replace_all: 0,
        },
        rows: [],
        removed: [],
      })
    );
    const file = new File(["quantity\n"], "cards.csv", { type: "text/csv" });

    await runImport(file, "merge_add", "add_above", "dry_run");

    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("/api/inventory/import");
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBe(file);
    expect(body.get("mode")).toBe("merge_add");
    expect(body.get("cap_handling")).toBe("add_above");
    expect(body.get("stage")).toBe("dry_run");
    // No explicit Content-Type header -- fetch derives the multipart
    // boundary itself from the FormData body (see the client's own doc
    // comment for why setting one by hand would break parsing).
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("returns the parsed report on success", async () => {
    const report = {
      stage: "commit" as const,
      mode: "replace" as const,
      cap_handling: "trim" as const,
      committed: true,
      totals: {
        rows: 1,
        resolved: 1,
        matched_by_fallback: 0,
        unresolved: 0,
        ambiguous: 0,
        trimmed: 0,
        ceiling_clamped: 0,
        duplicate_rows_merged: 0,
        unrecognized_columns: [],
        removed_by_replace_all: 0,
      },
      rows: [],
      removed: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(report));
    const result = await runImport(
      new File(["x"], "cards.json", { type: "application/json" }),
      "replace",
      "trim",
      "commit"
    );
    expect(result).toEqual(report);
  });

  it.each([
    ["file_too_large", /10 MB/],
    ["too_many_rows", /20,000 rows/],
    ["unparseable_file", /couldn't read/i],
    ["unsupported_format_version", /format version/],
  ])(
    "throws an ImportApiError with code %s for a matching 422 detail",
    async (code, expectedMessage) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ detail: code }, 422));
      await expect(
        runImport(new File(["x"], "cards.csv"), "merge_add", "add_above", "dry_run")
      ).rejects.toMatchObject({ name: "ImportApiError", code, status: 422 });
      // A fresh Response per assertion (a body can only be read once).
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ detail: code }, 422));
      await expect(
        runImport(new File(["x"], "cards.csv"), "merge_add", "add_above", "dry_run")
      ).rejects.toThrow(expectedMessage);
    }
  );

  it("classifies a 403 email_not_verified detail distinctly from the file-shape codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: "email_not_verified" }, 403)
    );
    await expect(
      runImport(new File(["x"], "cards.csv"), "merge_add", "add_above", "dry_run")
    ).rejects.toMatchObject({ code: "email_not_verified", status: 403 });
  });

  it("falls back to code 'unknown' for a response with no recognized detail shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(
      runImport(new File(["x"], "cards.csv"), "merge_add", "add_above", "dry_run")
    ).rejects.toMatchObject({ code: "unknown", status: 401 });
  });

  // BL-200 (census A5, CREATE): the backend's 429 detail is an OBJECT
  // ({error: "rate_limited", message: "..."}), not a bare string like every
  // other code -- before this fix, toImportApiError's `typeof detail ===
  // "string"` check silently discarded it and every 429 rendered the
  // generic "Something went wrong" text instead of the backend's actual
  // friendly message.
  it("recognizes the 429 rate_limited object-shaped detail and surfaces a friendly message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          detail: {
            error: "rate_limited",
            message: "Too many import requests -- please try again later",
          },
        },
        429
      )
    );
    await expect(
      runImport(new File(["x"], "cards.csv"), "merge_add", "add_above", "dry_run")
    ).rejects.toMatchObject({ name: "ImportApiError", code: "rate_limited", status: 429 });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          detail: {
            error: "rate_limited",
            message: "Too many import requests -- please try again later",
          },
        },
        429
      )
    );
    await expect(
      runImport(new File(["x"], "cards.csv"), "merge_add", "add_above", "dry_run")
    ).rejects.toThrow(/import limit/i);
  });
});

describe("exportInventory (BL-54 S3)", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("requests the given format and reads the filename from Content-Disposition", async () => {
    // A plain string body (not a jsdom Blob) -- Response's own .blob()
    // constructs the Blob internally via the fetch implementation, which is
    // what's actually under test here (the client never receives a Blob
    // from the caller).
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="hyperspacevault-inventory_2026-07-22.json"',
        },
      })
    );
    const result = await exportInventory("json");

    expect(fetchSpy.mock.calls[0][0]).toBe("/api/inventory/export?format=json");
    expect(result.filename).toBe("hyperspacevault-inventory_2026-07-22.json");
    // Not asserted via `instanceof Blob` -- fetch's own Blob (undici) and
    // jsdom's global Blob are two distinct classes in this test environment,
    // so `instanceof` is a false negative here even though it's a real Blob.
    expect(typeof result.blob.size).toBe("number");
  });

  it("falls back to a generic filename when Content-Disposition is missing (defensive)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("a", { status: 200 }));
    const result = await exportInventory("csv");
    expect(result.filename).toBe("hyperspacevault-inventory.csv");
  });

  it("throws an ImportApiError on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: "email_not_verified" }, 403)
    );
    await expect(exportInventory("json")).rejects.toBeInstanceOf(ImportApiError);
  });
});

describe("downloadCatalogReference (BL-54 S3)", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("requests the public reference endpoint and reads its filename", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("a,b", {
        status: 200,
        headers: {
          "Content-Disposition":
            'attachment; filename="hyperspacevault-catalog-reference_2026-07-22.csv"',
        },
      })
    );
    const result = await downloadCatalogReference();

    expect(fetchSpy.mock.calls[0][0]).toBe("/api/catalog/reference.csv");
    expect(result.filename).toBe("hyperspacevault-catalog-reference_2026-07-22.csv");
  });
});

describe("downloadBlob (BL-54 S3)", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    // jsdom implements neither -- stubbed so the DOM-manipulation path
    // (append synthetic anchor, click, clean up) can run under test.
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("creates an object URL, clicks a synthetic download anchor, and revokes the URL", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const blob = new Blob(["x"], { type: "text/csv" });

    downloadBlob(blob, "test-file.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });
});
