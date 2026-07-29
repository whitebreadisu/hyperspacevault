import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LimitsProvider, useLimits } from "./LimitsContext";
import { matrixKey } from "../utils/limits";
import type { CapMode, LimitCell, LimitsResponseBody } from "../api/settingsLimits";

// DISPOSITION (BL-25, CREATE): net-new provider -- fetches the effective
// keep-limit matrix once authenticated (the quantities-fetch pattern),
// exposes it as a lookup matrix + raw cells, and re-renders app-wide from
// the PUT response on save. No prior behavior to port.
//
// DISPOSITION (BL-35, PORT): getLimits/putLimits now resolve to the full
// { limits, cap_mode } response body instead of a bare LimitCell[] (the
// backend extended GET/PUT /api/settings/limits with cap_mode rather than
// adding new endpoints) -- every mock resolution and save() call-signature
// assertion below is re-expressed against the new shape. Behavior asserted
// (fetch-once, tenant-scoped lookup, failure degrades to code defaults,
// save re-renders from the response) is unchanged; capMode coverage is new.

const { getLimits, putLimits } = vi.hoisted(() => ({
  getLimits: vi.fn(),
  putLimits: vi.fn(),
}));
vi.mock("../api/settingsLimits", () => ({ getLimits, putLimits }));

function makeCell(overrides: Partial<LimitCell>): LimitCell {
  return {
    type_category: "standard",
    limit_bucket: "Standard",
    max_quantity: 3,
    is_default: true,
    ...overrides,
  };
}

function makeBody(cells: LimitCell[], capMode: CapMode = "hard"): LimitsResponseBody {
  return { limits: cells, cap_mode: capMode };
}

function Consumer() {
  const { limits, cells, capMode, save } = useLimits();
  return (
    <div>
      <p>{limits === null ? "no matrix" : "matrix fetched"}</p>
      <p>cells: {cells === null ? "none" : cells.length}</p>
      <p>cap mode: {capMode}</p>
      <p>
        standard/Standard:{" "}
        {limits === null ? "-" : String(limits[matrixKey("standard", "Standard")]?.max_quantity)}
      </p>
      <button onClick={() => void save([])}>save empty</button>
      <button onClick={() => void save([], "soft")}>save soft</button>
    </div>
  );
}

describe("LimitsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("provides the code-default fallback (null matrix, hard cap mode) without any provider", () => {
    render(<Consumer />);
    expect(screen.getByText("no matrix")).toBeInTheDocument();
    expect(screen.getByText("cells: none")).toBeInTheDocument();
    expect(screen.getByText("cap mode: hard")).toBeInTheDocument();
  });

  it("does not fetch and stays null/hard when anonymous", async () => {
    await act(async () => {
      render(
        <LimitsProvider isAuthenticated={false}>
          <Consumer />
        </LimitsProvider>
      );
    });
    expect(getLimits).not.toHaveBeenCalled();
    expect(screen.getByText("no matrix")).toBeInTheDocument();
    expect(screen.getByText("cap mode: hard")).toBeInTheDocument();
  });

  it("fetches the matrix when authenticated and exposes it as a lookup", async () => {
    getLimits.mockResolvedValue(
      makeBody([
        makeCell({ max_quantity: 5, is_default: false }),
        makeCell({ type_category: "singleton", max_quantity: 1 }),
      ])
    );
    await act(async () => {
      render(
        <LimitsProvider isAuthenticated={true}>
          <Consumer />
        </LimitsProvider>
      );
    });
    await waitFor(() => expect(screen.getByText("matrix fetched")).toBeInTheDocument());
    expect(getLimits).toHaveBeenCalledTimes(1);
    expect(screen.getByText("cells: 2")).toBeInTheDocument();
    expect(screen.getByText("standard/Standard: 5")).toBeInTheDocument();
  });

  it("exposes the fetched cap_mode", async () => {
    getLimits.mockResolvedValue(makeBody([makeCell({})], "soft"));
    await act(async () => {
      render(
        <LimitsProvider isAuthenticated={true}>
          <Consumer />
        </LimitsProvider>
      );
    });
    await waitFor(() => expect(screen.getByText("cap mode: soft")).toBeInTheDocument());
  });

  it("degrades to the null matrix and hard cap mode when the fetch fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getLimits.mockRejectedValue(new Error("boom"));
    await act(async () => {
      render(
        <LimitsProvider isAuthenticated={true}>
          <Consumer />
        </LimitsProvider>
      );
    });
    expect(screen.getByText("no matrix")).toBeInTheDocument();
    expect(screen.getByText("cap mode: hard")).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("save PUTs the overrides and re-renders from the response matrix", async () => {
    getLimits.mockResolvedValue(makeBody([makeCell({ max_quantity: 5, is_default: false })]));
    putLimits.mockResolvedValue(makeBody([makeCell({ max_quantity: 3, is_default: true })]));
    await act(async () => {
      render(
        <LimitsProvider isAuthenticated={true}>
          <Consumer />
        </LimitsProvider>
      );
    });
    await waitFor(() => expect(screen.getByText("standard/Standard: 5")).toBeInTheDocument());

    await act(async () => {
      screen.getByRole("button", { name: /save empty/i }).click();
    });

    expect(putLimits).toHaveBeenCalledWith([], undefined);
    expect(screen.getByText("standard/Standard: 3")).toBeInTheDocument();
  });

  it("save can pass a cap_mode change through to putLimits and re-renders it", async () => {
    getLimits.mockResolvedValue(makeBody([makeCell({})], "hard"));
    putLimits.mockResolvedValue(makeBody([makeCell({})], "soft"));
    await act(async () => {
      render(
        <LimitsProvider isAuthenticated={true}>
          <Consumer />
        </LimitsProvider>
      );
    });
    await waitFor(() => expect(screen.getByText("cap mode: hard")).toBeInTheDocument());

    await act(async () => {
      screen.getByRole("button", { name: /save soft/i }).click();
    });

    expect(putLimits).toHaveBeenCalledWith([], "soft");
    expect(screen.getByText("cap mode: soft")).toBeInTheDocument();
  });
});
