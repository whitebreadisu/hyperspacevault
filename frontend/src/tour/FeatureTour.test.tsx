import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureTour, TourPage } from "../content/featureTours";
import { FeatureTourProvider, TOUR_RESUME_MS, TOUR_SETTLE_MS, useTourPage } from "./FeatureTour";
import { TOUR_SEEN_KEY, TOUR_SKIPPED_KEY } from "./tourModel";

// The feature tour's runtime (App Spec §20): settle timing, the page list,
// Next / Done / Skip tour, using the target, an empty-page click, Escape,
// reduced motion and the gates, against a small tour mirroring v2.5's card
// page. tourModel.test.ts covers the pure rules.

const auth = vi.hoisted(() => ({
  user: { uid: "u1", metadata: { creationTime: "Mon, 01 Jun 2026 10:00:00 GMT" } } as {
    uid: string;
    metadata: { creationTime?: string };
  } | null,
}));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));

const phone = vi.hoisted(() => ({ on: false }));
vi.mock("../mobile/useIsPhone", () => ({ useIsPhone: () => phone.on }));

const banner = vi.hoisted(() => ({ newer: false }));
vi.mock("../components/UpdateBanner", () => ({
  isNewerBuildKnown: () => banner.newer,
  subscribeNewerBuild: () => () => {},
}));

const captured = vi.hoisted(() => [] as [string, Record<string, unknown>][]);
vi.mock("../analytics/analytics", () => ({
  capture: (e: string, p: Record<string, unknown>) => captured.push([e, p]),
}));

const TOUR: FeatureTour = {
  version: "2.5",
  since: "2026-11-12",
  tips: [
    {
      id: "nav",
      page: "collection",
      anchor: "nav",
      title: "Stashes",
      body: "Nav body",
      enabled: true,
    },
    {
      id: "copies",
      page: "card",
      anchor: "copies",
      title: "Stash copies",
      body: "Copies body",
      enabled: true,
    },
    {
      id: "list",
      page: "card",
      anchor: "list",
      title: "Your stashed copies",
      body: "List body",
      insteadOf: "copies",
      enabled: true,
    },
    {
      id: "share",
      page: "card",
      anchor: "share",
      title: "Share this card",
      body: "Desk share",
      bodyPhone: "Phone share",
      enabled: true,
    },
    { id: "later", page: "stashes", anchor: "later", title: "Later", body: "x", enabled: false },
  ],
};

function memoryStore() {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
  };
}

function Page({
  page,
  shared = false,
  children,
}: {
  page: TourPage;
  shared?: boolean;
  children: ReactNode;
}) {
  useTourPage(page, shared);
  return <>{children}</>;
}

let store = memoryStore();

function renderTour(
  ui: ReactNode,
  opts: { storage?: () => Pick<Storage, "getItem" | "setItem"> | null } = {}
) {
  return render(
    <FeatureTourProvider tours={[TOUR]} storage={opts.storage ?? (() => store)}>
      {ui}
      <div data-testid="empty">empty page</div>
    </FeatureTourProvider>
  );
}

const cardPage = (
  <Page page="card">
    <button type="button" data-tour="copies">
      Stash copies
    </button>
    <button type="button" data-tour="share" aria-label="Copy link">
      L
    </button>
  </Page>
);

const settle = () => act(() => void vi.advanceTimersByTime(TOUR_SETTLE_MS + 50));
const tip = () => screen.queryByRole("dialog");
const seen = () => JSON.parse(store.data[TOUR_SEEN_KEY] ?? "{}") as Record<string, string[]>;

beforeEach(() => {
  vi.useFakeTimers();
  store = memoryStore();
  captured.length = 0;
  auth.user = { uid: "u1", metadata: { creationTime: "Mon, 01 Jun 2026 10:00:00 GMT" } };
  phone.on = false;
  banner.newer = false;
  window.__hsvTour = { on: true };
  // jsdom has no layout: every anchor gets a box in view, nothing else does.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-tour") ? new DOMRect(100, 100, 80, 30) : new DOMRect(0, 0, 0, 0);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.__hsvTour;
});

describe("FeatureTour", () => {
  it("starts about a second after the page settles, counted per page, Next then Done", () => {
    renderTour(cardPage);
    act(() => void vi.advanceTimersByTime(TOUR_SETTLE_MS - 100));
    expect(tip()).toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    const d = screen.getByRole("dialog", { name: "Stash copies" });
    expect(d).toHaveTextContent("New in v2.5");
    expect(d).toHaveTextContent("1 of 2");
    expect(d).toHaveTextContent("Copies body");
    // Non-modal, labelled by its title, and focus stays where it was.
    expect(d).not.toHaveAttribute("aria-modal");
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const d2 = screen.getByRole("dialog", { name: "Share this card" });
    expect(d2).toHaveTextContent("2 of 2");
    expect(seen()).toEqual({ "2.5": ["copies"] });
    expect(document.documentElement.dataset.tourPhase).toBe("card:show");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(tip()).toBeNull();
    expect(document.documentElement.dataset.tourPhase).toBe("card:done");
    expect(seen()).toEqual({ "2.5": ["copies", "share"] });
    expect(captured).toEqual([
      ["feature_tour", { action: "shown", tip: "copies", version: "2.5", page: "card" }],
      ["feature_tour", { action: "next", tip: "copies", version: "2.5", page: "card" }],
      ["feature_tour", { action: "shown", tip: "share", version: "2.5", page: "card" }],
      ["feature_tour", { action: "done", tip: "share", version: "2.5", page: "card" }],
    ]);
  });

  it("the page settles only once nothing has been added or removed for the settle time", async () => {
    renderTour(cardPage);
    for (let i = 0; i < 3; i++) {
      act(() => void vi.advanceTimersByTime(TOUR_SETTLE_MS - 200));
      // The observer's callback is a microtask: let it run.
      await act(async () => void document.body.append(document.createElement("i")));
    }
    expect(tip()).toBeNull();
    settle();
    expect(tip()).not.toBeNull();
  });

  it("a page with one tip shows no count; a missing target is left out", () => {
    renderTour(
      <Page page="card">
        <button type="button" data-tour="share">
          L
        </button>
      </Page>
    );
    settle();
    const d = screen.getByRole("dialog", { name: "Share this card" });
    expect(d).not.toHaveTextContent(/of \d/);
    // The missing Stash copies tip stays pending: nothing marked.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(seen()).toEqual({ "2.5": ["share"] });
  });

  it("2b shows instead of 2 when copies are already stashed", () => {
    renderTour(
      <Page page="card">
        <div data-tour="list">Stashes Edit</div>
        <button type="button" data-tour="share">
          L
        </button>
      </Page>
    );
    settle();
    expect(screen.getByRole("dialog", { name: "Your stashed copies" })).toHaveTextContent("1 of 2");
  });

  it("Skip tour ends the release everywhere", () => {
    const { rerender } = renderTour(cardPage);
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(tip()).toBeNull();
    expect(JSON.parse(store.data[TOUR_SKIPPED_KEY])).toEqual({ "2.5": true });
    expect(captured[captured.length - 1]).toEqual([
      "feature_tour",
      { action: "skip", tip: "copies", version: "2.5", page: "card" },
    ]);
    // Another page's pending tip never starts.
    rerender(
      <FeatureTourProvider tours={[TOUR]} storage={() => store}>
        <Page page="collection">
          <button type="button" data-tour="nav">
            Stashes
          </button>
        </Page>
      </FeatureTourProvider>
    );
    settle();
    expect(tip()).toBeNull();
  });

  it("using the target marks it seen; the next tip waits for the opened menu to close", () => {
    renderTour(cardPage);
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Stash copies" }));
    expect(tip()).toBeNull();
    expect(seen()).toEqual({ "2.5": ["copies"] });
    expect(captured[captured.length - 1]?.[1]).toMatchObject({
      action: "target_used",
      tip: "copies",
    });
    // A menu or sheet opened by the control holds the next tip back.
    const busy = document.createElement("div");
    busy.setAttribute("data-tour-busy", "");
    act(() => void document.body.append(busy));
    act(() => void vi.advanceTimersByTime(2000));
    expect(tip()).toBeNull();
    act(() => busy.remove());
    act(() => void vi.advanceTimersByTime(TOUR_RESUME_MS + 200));
    expect(screen.getByRole("dialog", { name: "Share this card" })).toHaveTextContent("2 of 2");
  });

  it("a control that opens a menu is used when it opens on focus", () => {
    renderTour(
      <Page page="collection">
        <button type="button" data-tour="nav" aria-haspopup="true">
          Stashes
        </button>
      </Page>
    );
    settle();
    expect(screen.getByRole("dialog", { name: "Stashes" })).toBeInTheDocument();
    fireEvent.focusIn(screen.getByRole("button", { name: "Stashes" }));
    expect(tip()).toBeNull();
    expect(seen()).toEqual({ "2.5": ["nav"] });
  });

  it("an empty-page click closes the tip without marking it seen", () => {
    renderTour(cardPage);
    settle();
    fireEvent.pointerDown(screen.getByTestId("empty"));
    expect(tip()).toBeNull();
    expect(seen()).toEqual({});
    expect(captured[captured.length - 1]?.[1]).toMatchObject({
      action: "dismissed",
      tip: "copies",
    });
    // ...and no further tip starts on this visit.
    act(() => void vi.advanceTimersByTime(5000));
    expect(tip()).toBeNull();
  });

  it("Escape closes the tip like an empty-page click, and only the tip", () => {
    const underneath = vi.fn();
    document.addEventListener("keydown", underneath);
    renderTour(cardPage);
    settle();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(tip()).toBeNull();
    expect(seen()).toEqual({});
    expect(underneath).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(underneath).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", underneath);
  });

  it("Next, Done and Skip tour are keyboard-reachable buttons", () => {
    renderTour(cardPage);
    settle();
    for (const name of ["Next", "Skip tour"]) {
      const b = screen.getByRole("button", { name });
      expect(b.tagName).toBe("BUTTON");
      expect(b).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("reduced motion: no fade and a steady glow", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({ matches: q.includes("prefers-reduced-motion"), media: q }) as unknown as MediaQueryList
    );
    renderTour(cardPage);
    settle();
    expect(tip()).toHaveClass("tour-tip--still");
    expect(document.querySelector(".tour-glow")).toHaveClass("tour-glow--still");
  });

  it("the target glows while its tip is open", () => {
    renderTour(cardPage);
    settle();
    const glow = document.querySelector<HTMLElement>(".tour-glow")!;
    expect(glow.style.left).toBe("100px");
    expect(glow.style.width).toBe("80px");
    expect(tip()).not.toHaveClass("tour-tip--still");
  });

  it("the phone uses its own wording", () => {
    phone.on = true;
    renderTour(
      <Page page="card">
        <button type="button" data-tour="share">
          L
        </button>
      </Page>
    );
    settle();
    expect(screen.getByRole("dialog")).toHaveTextContent("Phone share");
  });

  it("the card window over the Vault wins", () => {
    renderTour(
      <>
        <Page page="collection">
          <button type="button" data-tour="nav">
            Stashes
          </button>
        </Page>
        {cardPage}
      </>
    );
    settle();
    expect(screen.getByRole("dialog", { name: "Stash copies" })).toBeInTheDocument();
  });

  describe("no tips", () => {
    it("signed out", () => {
      auth.user = null;
      renderTour(cardPage);
      settle();
      expect(tip()).toBeNull();
      expect(document.documentElement.dataset.tourPhase).toBe("off");
    });

    it("a new account (created on or after the tour's date)", () => {
      auth.user = { uid: "u2", metadata: { creationTime: "Thu, 12 Nov 2026 09:00:00 GMT" } };
      renderTour(cardPage);
      settle();
      expect(tip()).toBeNull();
    });

    it("a shared-vault view", () => {
      renderTour(
        <Page page="card" shared>
          <button type="button" data-tour="copies">
            Stash copies
          </button>
        </Page>
      );
      settle();
      expect(tip()).toBeNull();
    });

    it("while the update banner is up (a newer build is known)", () => {
      banner.newer = true;
      renderTour(cardPage);
      act(() => void vi.advanceTimersByTime(5000));
      expect(tip()).toBeNull();
    });

    it("storage that throws", () => {
      const throwing = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
      };
      renderTour(cardPage, { storage: () => throwing });
      settle();
      expect(tip()).toBeNull();
    });

    it("an unflagged release (the switch off: no tour)", () => {
      window.__hsvTour = { on: false };
      renderTour(cardPage);
      settle();
      expect(tip()).toBeNull();
    });

    it("a test run without the switch", () => {
      delete window.__hsvTour;
      renderTour(cardPage);
      settle();
      expect(tip()).toBeNull();
    });

    it("a disabled tip, even with its target rendered", () => {
      renderTour(
        <Page page="stashes">
          <h1 data-tour="later">Stashes</h1>
        </Page>
      );
      act(() => void vi.advanceTimersByTime(5000));
      expect(tip()).toBeNull();
    });

    it("already seen", () => {
      store.data[TOUR_SEEN_KEY] = JSON.stringify({ "2.5": ["copies", "share"] });
      renderTour(cardPage);
      settle();
      expect(tip()).toBeNull();
      // Settled with nothing to show (the e2e specs wait on this).
      expect(document.documentElement.dataset.tourPhase).toBe("card:empty");
    });
  });
});
