import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BL-250 S4-01 / S4-04 / S4-06: More's rows per auth state, the unread-cue
// rule (incl. the S1 review F7 regression), and the screens' screen_viewed.
vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));
vi.mock("../../context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: null, loading: false, logout: vi.fn(), emailVerified: false }),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardsList: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/sets", () => ({ getSets: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/inventory", () => ({ getQuantities: vi.fn().mockResolvedValue([]) }));

import { capture } from "../../analytics/analytics";
import { RELEASE_NOTES } from "../../content/releaseNotes";
import { latestEntryKey } from "../../utils/releaseNotesSeen";
import { MobileApp } from "../MobileApp";
import { resetRouterForTest } from "../router";
import { cueStep, moreRowPulses } from "../useReleaseCue";
import type { CueState } from "../useReleaseCue";
import { IE_UNVERIFIED_NUDGE, MoreScreen } from "./MoreScreen";
import type { MoreScreenProps } from "./MoreScreen";
import { ShellHead } from "./ShellHead";

const SEEN = "swu.releaseNotes.lastSeen";

function renderMore(p: Partial<MoreScreenProps>) {
  const props: MoreScreenProps = {
    signedIn: false,
    emailVerified: false,
    hasPasswordProvider: false,
    updatesCue: false,
    account: null,
    onSignIn: vi.fn(),
    onLogout: vi.fn(),
    ...p,
  };
  render(<MoreScreen {...props} />);
  return props;
}

const groups = () =>
  [...document.querySelectorAll<HTMLElement>(".m-moregroup")].map((g) => ({
    label: g.getAttribute("aria-label"),
    rows: [...g.querySelectorAll(".m-morerow__title")].map((t) => t.textContent),
  }));

async function goHash(h: string) {
  await act(async () => {
    window.location.hash = h;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("S4-01 More rows per auth state", () => {
  beforeEach(() => {
    resetRouterForTest();
    window.location.hash = "#/more";
  });

  it("signed out: no Account group, Sign in instead of Log Out, teasers open sign-in", () => {
    const p = renderMore({});
    expect(groups()).toEqual([
      { label: "Collection", rows: ["Import & Export", "Sharing"] },
      { label: "Hyperspace Vault", rows: ["About & Legal", "[HSV] Updates", "Leave Feedback"] },
      { label: "Session", rows: ["Sign in"] },
    ]);
    const ie = document.querySelector('[data-more="importexport"]')!;
    expect(ie.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(ie);
    fireEvent.click(document.querySelector('[data-more="sharing"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(p.onSignIn).toHaveBeenCalledTimes(3);
    expect(window.location.hash).toBe("#/more");
  });

  it("signed in, verified, password account: every row, Log Out last", () => {
    const p = renderMore({ signedIn: true, emailVerified: true, hasPasswordProvider: true });
    expect(groups()).toEqual([
      { label: "Collection", rows: ["Import & Export", "Sharing"] },
      { label: "Account", rows: ["Settings", "Change Password"] },
      { label: "Hyperspace Vault", rows: ["About & Legal", "[HSV] Updates", "Leave Feedback"] },
      { label: "Session", rows: ["Log Out"] },
    ]);
    expect(
      document.querySelector('[data-more="importexport"]')!.hasAttribute("aria-disabled")
    ).toBe(false);
    for (const [id, hash] of [
      ["importexport", "#/more/importexport"],
      ["sharing", "#/more/sharing"],
      ["settings", "#/more/settings"],
      ["password", "#/more/password"],
      ["about", "#/more/about"],
      ["updates", "#/more/updates"],
      ["feedback", "#/more/feedback"],
    ]) {
      fireEvent.click(document.querySelector(`[data-more="${id}"]`)!);
      expect(window.location.hash).toBe(hash);
    }
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    expect(p.onLogout).toHaveBeenCalledTimes(1);
  });

  it("Google-only account: no Change Password", () => {
    renderMore({ signedIn: true, emailVerified: true, hasPasswordProvider: false });
    expect(groups()[1]).toEqual({ label: "Account", rows: ["Settings"] });
  });

  it("signed in, unverified: Import & Export is inert and explains itself", () => {
    const p = renderMore({ signedIn: true, emailVerified: false, hasPasswordProvider: true });
    const ie = document.querySelector('[data-more="importexport"]')!;
    expect(ie.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(IE_UNVERIFIED_NUDGE)).toBeNull();
    fireEvent.click(ie);
    expect(screen.getByText(IE_UNVERIFIED_NUDGE)).toBeTruthy();
    expect(window.location.hash).toBe("#/more");
    expect(p.onSignIn).not.toHaveBeenCalled();
  });

  it("Deck Check is one sentence under Collection, never an entry; no Prototype group", () => {
    renderMore({ signedIn: true, emailVerified: true });
    const note = document.querySelector(".m-more__deckcheck")!;
    expect(note.textContent).toBe("Deck Check is on the desktop site.");
    expect(document.querySelector('[aria-label="Collection"]')!.contains(note)).toBe(true);
    const titles = [...document.querySelectorAll(".m-morerow")].map((r) => r.textContent);
    expect(titles.some((t) => /deck/i.test(t ?? ""))).toBe(false);
    expect(document.querySelector('[aria-label="Prototype"]')).toBeNull();
  });
});

describe("S4-04 unread cue rule", () => {
  const unread: CueState = { unread: true, first: null };

  it("state machine: the first of More / title decides the More-row pulse; seen clears", () => {
    // Opening More before the title was ever tapped: the row pulses.
    expect(moreRowPulses(unread)).toBe(true);
    const more = cueStep(unread, "more");
    expect(more).toEqual({ unread: true, first: "more" });
    expect(moreRowPulses(cueStep(more, "title"))).toBe(true);
    // The title tapped first (chooser alone does not clear): no More pulse.
    const title = cueStep(unread, "title");
    expect(title).toEqual({ unread: true, first: "title" });
    expect(moreRowPulses(cueStep(title, "more"))).toBe(false);
    // Seen clears every cue.
    expect(cueStep(more, "seen")).toEqual({ unread: false, first: "more" });
    expect(moreRowPulses(cueStep(more, "seen"))).toBe(false);
    expect(moreRowPulses({ unread: false, first: null })).toBe(false);
  });

  describe("in the app", () => {
    beforeEach(() => {
      resetRouterForTest();
      localStorage.removeItem(SEEN);
    });
    afterEach(() => localStorage.removeItem(SEEN));

    it("More opened first pulses the Updates row; the real Updates screen clears (F7)", async () => {
      window.location.hash = "#/more";
      const { container } = render(<MobileApp />);
      await act(async () => {});
      const row = () => container.querySelector('[data-more="updates"]')!;
      expect(row().classList.contains("m-morerow--cue")).toBe(true);
      expect(row().querySelector(".m-cue")!.getAttribute("data-cue")).toBe("[HSV] Updates");
      // The More tab never glows.
      const moreTab = container.querySelector(".m-nav .m-tab:last-child")!;
      expect(moreTab.querySelector("[class*=cue]")).toBeNull();
      expect(localStorage.getItem(SEEN)).toBeNull();

      await act(async () => {
        fireEvent.click(row());
        await new Promise((r) => setTimeout(r, 0)); // jsdom fires hashchange async
      });
      // F7: the ComingSoon placeholder for #/more/updates no longer exists;
      // the real screen renders and its mount marks the newest entry seen.
      expect(window.location.hash).toBe("#/more/updates");
      expect(container.querySelector(".m-soon")).toBeNull();
      expect(container.querySelector(".m-updates")).not.toBeNull();
      expect(localStorage.getItem(SEEN)).toBe(latestEntryKey(RELEASE_NOTES));

      await goHash("#/more");
      expect(container.querySelector(".m-morerow--cue")).toBeNull();
      expect(container.querySelector(".m-cue")).toBeNull();
    });

    it("title first: the chooser does not clear, and More's row then stays still", async () => {
      window.location.hash = "#/vault";
      const { container } = render(<MobileApp />);
      await act(async () => {});
      await act(async () => fireEvent.click(container.querySelector(".m-vh__brandtext")!));
      expect(container.querySelector(".m-chooser__btn--cue .m-cue")).not.toBeNull();
      await act(async () => fireEvent.click(container.querySelector(".m-chooser__x")!));
      expect(container.querySelector(".m-vh__word.m-cue")).not.toBeNull();
      expect(localStorage.getItem(SEEN)).toBeNull();
      await goHash("#/more");
      expect(container.querySelector('[data-more="updates"]')).not.toBeNull();
      expect(container.querySelector(".m-morerow--cue")).toBeNull();
    });

    it("the chooser's Updates button navigates; the screen's mount clears", async () => {
      window.location.hash = "#/vault";
      const { container } = render(<MobileApp />);
      await act(async () => {});
      await act(async () => fireEvent.click(container.querySelector(".m-vh__brandtext")!));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "[HSV] Updates" })));
      expect(window.location.hash).toBe("#/more/updates");
      expect(container.querySelector(".m-updates")).not.toBeNull();
      expect(localStorage.getItem(SEEN)).toBe(latestEntryKey(RELEASE_NOTES));
    });
  });
});

describe("S4-06 screen_viewed for More, About, Updates", () => {
  const spy = vi.mocked(capture);
  const views = () => spy.mock.calls.filter(([e]) => e === "screen_viewed").map(([, p]) => p);

  beforeEach(() => {
    spy.mockClear();
    resetRouterForTest();
  });

  it("once per screen, desktop's new_arrivals for Updates, layout phone", async () => {
    window.location.hash = "#/more";
    render(<MobileApp />);
    await act(async () => {});
    await goHash("#/more/about");
    await goHash("#/more/updates");
    await goHash("#/about");
    await goHash("#/more/sharing"); // ComingSoon until S5-07: nothing yet
    expect(views()).toEqual([
      { screen: "more", layout: "phone" },
      { screen: "about", layout: "phone" },
      { screen: "new_arrivals", layout: "phone" },
      { screen: "about", layout: "phone" },
    ]);
  });
});

describe("S4-F1 ShellHead Escape", () => {
  beforeEach(() => {
    resetRouterForTest();
    window.location.hash = "#/more/about";
  });
  afterEach(() => {
    document.querySelectorAll(".m-tool").forEach((n) => n.remove());
  });
  const esc = () => fireEvent.keyDown(document, { key: "Escape" });

  it("exits when it is the top-most layer", () => {
    render(<ShellHead title="T" titleId="t" fromMore={false} />);
    esc();
    expect(window.location.hash).toBe("#/vault");
  });

  it("is ignored while locked (Escape, X and chevron do nothing)", () => {
    render(<ShellHead title="T" titleId="t" fromMore={false} locked />);
    esc();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(window.location.hash).toBe("#/more/about");
  });

  it("is ignored while the tool layer is open (only the tool closes)", () => {
    const tool = document.createElement("div");
    tool.className = "m-tool";
    document.body.appendChild(tool);
    render(<ShellHead title="T" titleId="t" fromMore={false} />);
    esc();
    expect(window.location.hash).toBe("#/more/about");
  });
});
