import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-247 S1-27: the phone's S1 surfaces capture desktop's events with
// desktop's property shapes, each carrying layout: "phone". The analytics
// seam's capture() is replaced by a spy (the real one no-ops off prod).
vi.mock("../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: null, loading: false, logout: vi.fn() }),
}));
vi.mock("../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/feedback", () => ({ submitFeedback: vi.fn().mockResolvedValue(undefined) }));

import { capture } from "../analytics/analytics";
import { FeedbackScreen } from "./FeedbackScreen";
import { MobileApp } from "./MobileApp";
import { resetRouterForTest } from "./router";
import { useVaultViewOver } from "./vault/useVaultView";

const spy = vi.mocked(capture);
const calls = (event: string) => spy.mock.calls.filter(([e]) => e === event).map(([, p]) => p);

describe("S1-27 phone analytics events", () => {
  beforeEach(() => {
    spy.mockClear();
    window.sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("view_mode_changed reports the new view + size pair, only on a real change", () => {
    const { result } = renderHook(() => useVaultViewOver([], {}));
    act(() => result.current.setView("gallery"));
    act(() => result.current.setGallerySize(3));
    act(() => result.current.setGallerySize(3));
    act(() => result.current.setView("rows"));
    act(() => result.current.setRowSize("none"));
    expect(calls("view_mode_changed")).toEqual([
      { mode: "gallery_2", layout: "phone" },
      { mode: "gallery_3", layout: "phone" },
      { mode: "rows_md", layout: "phone" },
      { mode: "rows_none", layout: "phone" },
    ]);
  });

  it("sort_changed follows nextSortState; scope and clear as desktop", () => {
    const { result } = renderHook(() => useVaultViewOver([], {}));
    act(() => result.current.pickSort("name"));
    act(() => result.current.pickSort("name"));
    act(() => result.current.setScope("Hyperspace"));
    act(() => result.current.setScope(null));
    act(() => result.current.clearAll());
    expect(calls("sort_changed")).toEqual([
      { column: "name", direction: "asc", layout: "phone" },
      { column: "name", direction: "desc", layout: "phone" },
    ]);
    expect(calls("finish_scope_changed")).toEqual([
      { finish: "Hyperspace", layout: "phone" },
      { finish: "all", layout: "phone" },
    ]);
    expect(calls("filters_cleared")).toEqual([{ layout: "phone" }]);
  });

  // REPLACE (owner decision 2026-10-12 after review, T2): Cards Owned's first
  // tap is descending and the event says so (was asc, then desc).
  it("FR5-05 sort_changed reports the applied column and direction: owned desc first; never set or variants", () => {
    const { result } = renderHook(() => useVaultViewOver([], {}));
    act(() => result.current.pickSort("owned"));
    act(() => result.current.pickSort("owned"));
    act(() => result.current.pickSort("set"));
    act(() => result.current.pickSort("name"));
    act(() => result.current.pickSort("variants"));
    act(() => result.current.pickSort("owned"));
    expect(calls("sort_changed")).toEqual([
      { column: "owned", direction: "desc", layout: "phone" },
      { column: "owned", direction: "asc", layout: "phone" },
      { column: "number", direction: "asc", layout: "phone" },
      { column: "name", direction: "asc", layout: "phone" },
      { column: "number", direction: "asc", layout: "phone" },
      { column: "owned", direction: "desc", layout: "phone" },
    ]);
  });

  it("search_performed fires 400 ms after typing, with length + count only", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVaultViewOver([], {}));
    act(() => result.current.setQuery("lu"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setQuery("luke"));
    act(() => vi.advanceTimersByTime(399));
    expect(calls("search_performed")).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(calls("search_performed")).toEqual([
      { query_length: 4, results_count: 0, layout: "phone" },
    ]);
    act(() => result.current.setQuery(""));
    act(() => vi.advanceTimersByTime(1000));
    expect(calls("search_performed")).toHaveLength(1);
  });

  it("screen_viewed from the router: vault, then feedback, once each", async () => {
    resetRouterForTest();
    window.location.hash = "#/vault";
    render(<MobileApp />);
    await act(async () => {});
    expect(calls("screen_viewed")).toEqual([{ screen: "vault", layout: "phone" }]);
    await act(async () => {
      window.location.hash = "#/more/feedback";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(calls("screen_viewed")).toEqual([
      { screen: "vault", layout: "phone" },
      { screen: "feedback", layout: "phone" },
    ]);
  });

  it("F6: a ?q= deep link does not emit search_performed; a keystroke does", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVaultViewOver([], {}, { q: "luke" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(calls("search_performed")).toEqual([]);
    act(() => result.current.setQuery("lukes"));
    act(() => vi.advanceTimersByTime(400));
    expect(calls("search_performed")).toHaveLength(1);
  });

  it("feedback_submitted after a successful submit", async () => {
    render(<FeedbackScreen onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Bug reports, ideas, anything on your mind..."), {
      target: { value: "Hello" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
    });
    expect(calls("feedback_submitted")).toEqual([{ layout: "phone" }]);
  });
});
