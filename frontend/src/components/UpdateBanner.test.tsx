import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";
import { FOCUS_THROTTLE_MS, INTERVAL_MS, chunkReloadKey } from "../utils/buildCheck";
import type { GuardStorage } from "../utils/buildCheck";

// App Spec §20: the banner's triggers, dismissal and the chunk guard.

const TEXT = "A new version of HyperspaceVault is ready.";

function fetcherFor(build: () => string | Error) {
  return vi.fn(async () => {
    const b = build();
    if (b instanceof Error) throw b;
    return { ok: true, json: async () => ({ build: b, version: "2.5.0" }) } as Response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function memoryStorage(): GuardStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function focus() {
  fireEvent.focus(window);
  await flush();
}

afterEach(() => vi.useRealTimers());

describe("UpdateBanner", () => {
  it("shows nothing until a check finds a different build", async () => {
    let t = 0;
    let published = "old";
    const fetcher = fetcherFor(() => published);
    render(<UpdateBanner bakedBuild="old" fetcher={fetcher} now={() => t} />);
    expect(screen.queryByText(TEXT)).toBeNull();
    await focus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXT)).toBeNull();
    published = "new";
    // A focus inside the throttle window does not check again.
    await focus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXT)).toBeNull();
    // Past it, the next focus checks and finds the new build.
    t += FOCUS_THROTTLE_MS;
    await focus();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("never checks while the document is hidden (visibilitychange or interval)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const fetcher = fetcherFor(() => "new");
      render(<UpdateBanner bakedBuild="old" fetcher={fetcher} />);
      fireEvent(document, new Event("visibilitychange"));
      await act(async () => {
        vi.advanceTimersByTime(INTERVAL_MS * 2);
      });
      await focus();
      await flush();
      expect(fetcher).not.toHaveBeenCalled();
      expect(screen.queryByText(TEXT)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("unmount clears the interval and the listeners", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetcher = fetcherFor(() => "new");
    const reload = vi.fn();
    const { unmount } = render(
      <UpdateBanner bakedBuild="old" fetcher={fetcher} reload={reload} storage={memoryStorage} />
    );
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS * 2);
    });
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("overlapping focus and interval make one request; the newest answer wins", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let t = 0;
    const pending: ((build: string) => void)[] = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push((b) =>
            resolve({ ok: true, json: async () => ({ build: b, version: "2.5.0" }) } as Response)
          );
        })
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    render(<UpdateBanner bakedBuild="b1" fetcher={fetcher} now={() => t} />);
    // A focus check starts; the interval fires while it is still running.
    fireEvent.focus(window);
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => pending[0]("b2"));
    await flush();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(TEXT)).toBeNull();
    // Later checks: the interval asks again and b3 is published; a slow
    // repeat answer of b2 can never come back to undo the dismissal or
    // replace b3, because no second request runs while one is in flight.
    t += FOCUS_THROTTLE_MS;
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    fireEvent.focus(window);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => pending[1]("b2"));
    await flush();
    expect(screen.queryByText(TEXT)).toBeNull();
    t += FOCUS_THROTTLE_MS;
    fireEvent.focus(window);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => pending[2]("b3"));
    await flush();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("checks on focus, throttled, and shows the banner for a newer build", async () => {
    let t = 1_000_000;
    const fetcher = fetcherFor(() => "new");
    const reload = vi.fn();
    render(<UpdateBanner bakedBuild="old" fetcher={fetcher} reload={reload} now={() => t} />);
    await focus();
    expect(screen.getByRole("status")).toHaveTextContent(TEXT);
    t += FOCUS_THROTTLE_MS - 1;
    await focus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    t += 1;
    await focus();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks when the document becomes visible", async () => {
    const fetcher = fetcherFor(() => "new");
    render(<UpdateBanner bakedBuild="old" fetcher={fetcher} />);
    fireEvent(document, new Event("visibilitychange"));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("checks on the interval while visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetcher = fetcherFor(() => "new");
    render(<UpdateBanner bakedBuild="old" fetcher={fetcher} />);
    await act(async () => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("is silent when the check fails", async () => {
    const fetcher = fetcherFor(() => new TypeError("Failed to fetch"));
    render(<UpdateBanner bakedBuild="old" fetcher={fetcher} />);
    await focus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it("dismiss hides it for that build only", async () => {
    let t = 0;
    let published = "b2";
    const fetcher = fetcherFor(() => published);
    render(<UpdateBanner bakedBuild="b1" fetcher={fetcher} now={() => t} />);
    await focus();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(TEXT)).toBeNull();
    t += FOCUS_THROTTLE_MS;
    await focus();
    expect(screen.queryByText(TEXT)).toBeNull();
    published = "b3";
    t += FOCUS_THROTTLE_MS;
    await focus();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("a chunk failure reloads once, then shows the banner", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const fetcher = fetcherFor(() => "b1");
    render(
      <UpdateBanner bakedBuild="b1" fetcher={fetcher} reload={reload} storage={() => storage} />
    );
    const first = new Event("vite:preloadError", { cancelable: true });
    act(() => void window.dispatchEvent(first));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    expect(storage.getItem(chunkReloadKey("b1"))).toBe("1");
    expect(screen.queryByText(TEXT)).toBeNull();
    // The reload landed on the same build (guard still set): no second reload.
    const second = new Event("vite:preloadError", { cancelable: true });
    act(() => void window.dispatchEvent(second));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it("treats a failed dynamic import rejection as a chunk failure", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    render(<UpdateBanner bakedBuild="b1" reload={reload} storage={() => storage} />);
    const ev = new Event("unhandledrejection", { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(ev, "reason", {
      value: new TypeError("Failed to fetch dynamically imported module: /assets/x.js"),
    });
    act(() => void window.dispatchEvent(ev));
    expect(reload).toHaveBeenCalledTimes(1);
    const other = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(other, "reason", { value: new Error("boom") });
    act(() => void window.dispatchEvent(other));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
