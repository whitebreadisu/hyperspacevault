import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RELEASE_NOTES } from "../content/releaseNotes";
import { latestEntryKey } from "../utils/releaseNotesSeen";
import { AccountSlot } from "./AccountSlot";
import { MobileNav } from "./MobileNav";
import { parseHash } from "./router";
import { TitleChooser } from "./TitleChooser";
import { useReleaseCue } from "./useReleaseCue";

const SEEN = "swu.releaseNotes.lastSeen";

describe("S1-04 shell + bottom bar", () => {
  const current = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "page")
      .map((b) => b.textContent);

  it("the active tab follows the route", () => {
    const { rerender } = render(<MobileNav route={parseHash("#/vault")} />);
    expect(current()).toEqual(["Vault"]);
    rerender(<MobileNav route={parseHash("#/more")} />);
    expect(current()).toEqual(["More"]);
    rerender(<MobileNav route={parseHash("#/more/settings")} />);
    expect(current()).toEqual(["More"]);
    rerender(<MobileNav route={parseHash("#/pad")} />);
    expect(current()).toEqual([]);
    rerender(<MobileNav route={parseHash("#/card/12")} />);
    expect(current()).toEqual([]);
  });

  it("the centre button is the keypad alone while the camera flag is off", () => {
    render(<MobileNav route={parseHash("#/vault")} />);
    const pad = screen.getByRole("button", { name: "Keypad" });
    expect(pad.querySelectorAll(".m-nav__tool")).toHaveLength(1);
    expect(pad.querySelector(".m-nav__tooldiv")).toBeNull();
    fireEvent.click(pad);
    expect(window.location.hash).toBe("#/pad");
  });
});

describe("S1-07 title chooser + unread cue", () => {
  beforeEach(() => localStorage.removeItem(SEEN));
  afterEach(() => localStorage.removeItem(SEEN));

  it("unread -> chooser open keeps it -> Updates navigation clears it", () => {
    // BL-250 S4-04 PORT: the hook no longer takes the route path.
    const { result } = renderHook(() => useReleaseCue());
    expect(result.current.unread).toBe(true);

    // Opening the chooser alone does not clear; its Updates button pulses.
    const onUpdates = () => result.current.clear();
    const { unmount } = render(
      <TitleChooser
        unread={result.current.unread}
        onClose={() => {}}
        onAbout={() => {}}
        onUpdates={onUpdates}
      />
    );
    expect(result.current.unread).toBe(true);
    expect(localStorage.getItem(SEEN)).toBeNull();
    const updates = screen.getByRole("button", { name: "[HSV] Updates" });
    expect(updates.querySelector(".m-cue")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "About & Legal" }).querySelector(".m-cue")
    ).toBeNull();

    act(() => fireEvent.click(updates));
    expect(result.current.unread).toBe(false);
    expect(localStorage.getItem(SEEN)).toBe(latestEntryKey(RELEASE_NOTES));
    unmount();

    // Fresh open with the newest key stored: no cue.
    const again = renderHook(() => useReleaseCue());
    expect(again.result.current.unread).toBe(false);
  });

  // BL-250 S4-04 REPLACED "arriving at #/more/updates by any path clears
  // it": the route alone no longer clears (S1 review F7); the real Updates
  // screen clears on mount -- see more/more.test.tsx "S4-04".

  it("the More tab never gets the cue class", () => {
    render(<MobileNav route={parseHash("#/more")} />);
    const more = screen.getByRole("button", { name: "More" });
    expect(more.className).not.toMatch(/cue/);
    expect(more.querySelector("[class*=cue]")).toBeNull();
  });
});

describe("S1-08 account slot + menu", () => {
  const items = () => screen.getAllByRole("menuitem").map((b) => b.textContent);

  it("signed out shows the Sign in control and no bubble", () => {
    let asked = 0;
    render(
      <AccountSlot email={null} hasPasswordProvider onSignIn={() => asked++} onLogout={() => {}} />
    );
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(asked).toBe(1);
  });

  it("a password account gets four items incl. Change Password", () => {
    render(
      <AccountSlot email="a@b.c" hasPasswordProvider onSignIn={() => {}} onLogout={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(items()).toEqual(["Settings", "Change Password", "About & Legal", "Log Out"]);
  });

  it("a Google-only account has no Change Password (hasPasswordProvider false)", () => {
    render(
      <AccountSlot
        email="g@b.c"
        hasPasswordProvider={false}
        onSignIn={() => {}}
        onLogout={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(items()).toEqual(["Settings", "About & Legal", "Log Out"]);
  });

  it("Log Out calls logout and closes; Escape closes", () => {
    let out = 0;
    render(
      <AccountSlot email="a@b.c" hasPasswordProvider onSignIn={() => {}} onLogout={() => out++} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Log Out" }));
    expect(out).toBe(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
