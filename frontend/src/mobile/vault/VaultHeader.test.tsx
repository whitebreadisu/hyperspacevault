import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultHeader } from "./VaultHeader";
import { MoreScreen } from "../more/MoreScreen";
import { SharedStatus } from "../shared/SharedStatus";
import { TitleChooser } from "../TitleChooser";

// DISPOSITION (CREATE): the phone brand mark is the initials logo (App Spec
// §25.1); the unread-Updates cue rides on the tag line under it.
// REPLACE: the collapsed strip's "[HSV]" text badge is the initials logo too,
// its cue an amber glow class on the logo box; the vacuous "no cue on the
// logo" check (an img never carries the text cue) became an exact count of
// text cues plus the badge's glow class.

function renderHeader(unread: boolean, onOpenChooser = vi.fn()) {
  return render(
    <VaultHeader
      hdrRef={createRef<HTMLElement>()}
      topRef={createRef<HTMLDivElement>()}
      collapsed={false}
      onExpand={vi.fn()}
      summary={{ pct: 40, copies: 120, value: 99.5, narrowed: false }}
      unread={unread}
      onOpenChooser={onOpenChooser}
      onOpenFeedback={vi.fn()}
      account={null}
      panel={null}
    />
  );
}

describe("phone Vault header brand", () => {
  it("shows the initials logo with its alt text in place of the text wordmark", () => {
    const { container } = renderHeader(false);
    const logo = screen.getByRole("img", { name: "Hyperspace Vault" });
    expect(logo.className).toBe("m-vh__logo");
    expect(logo.getAttribute("srcset")).toMatch(/ 2x, .* 3x$/);
    expect(container.querySelector(".m-vh__brandtext")!.contains(logo)).toBe(true);
    expect(container.querySelector(".m-vh__word")).toBeNull();
    expect(container.querySelector(".m-vh__tag")!.textContent).toMatch(
      /^Unofficial Fan Project \[v\d+\.\d+(\.\d+)?\]$/
    );
  });

  it("opens the title chooser from the logo's brand stack", () => {
    const onOpenChooser = vi.fn();
    const { container } = renderHeader(false, onOpenChooser);
    fireEvent.click(container.querySelector(".m-vh__brandtext")!);
    expect(onOpenChooser).toHaveBeenCalledTimes(1);
  });

  it("puts the unread cue on the tag line, in its displayed casing", () => {
    const { container } = renderHeader(true);
    const tag = container.querySelector(".m-vh__tag")!;
    expect(tag.classList.contains("m-cue")).toBe(true);
    expect(tag.getAttribute("data-cue")).toMatch(/^UNOFFICIAL FAN PROJECT \[v\d+\.\d+(\.\d+)?\]$/);
    // The tag line is the only text cue; the collapsed badge glows instead.
    expect(container.querySelectorAll(".m-cue")).toHaveLength(1);
    expect(container.querySelector(".m-vh__hsv")!.classList.contains("m-vh__hsv--cue")).toBe(true);
  });

  it("carries no cue anywhere once the update is read", () => {
    const { container } = renderHeader(false);
    expect(container.querySelector(".m-cue")).toBeNull();
    expect(container.querySelector(".m-vh__hsv--cue")).toBeNull();
  });

  it("the collapsed badge is the initials logo, no [HSV] text, and opens the chooser", () => {
    const onOpenChooser = vi.fn();
    const { container } = renderHeader(false, onOpenChooser);
    const badge = container.querySelector(".m-vh__hsv")!;
    expect(badge.textContent).toBe("");
    const img = badge.querySelector(".m-vh__logobox img.m-vh__badgelogo")!;
    expect(img.getAttribute("alt")).toBe("Hyperspace Vault");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["64", "24"]);
    expect(badge.getAttribute("aria-label")).toBe("Hyperspace Vault: About & Legal, Updates");
    fireEvent.click(badge);
    expect(onOpenChooser).toHaveBeenCalledTimes(1);
  });
});

describe("phone title chooser heading", () => {
  it("is the initials logo, not the [HSV] text", () => {
    render(<TitleChooser unread={false} onClose={vi.fn()} onAbout={vi.fn()} onUpdates={vi.fn()} />);
    const dlg = screen.getByRole("dialog", { name: "Hyperspace Vault" });
    expect(dlg.querySelector("h2 img.m-chooser__logo")).not.toBeNull();
    expect(dlg.textContent).not.toMatch(/\[HSV\] Hyperspace Vault/);
  });
});

describe("phone More and shared-status brand", () => {
  it("More's About button shows the initials logo", () => {
    const { container } = render(
      <MoreScreen
        signedIn={false}
        emailVerified={false}
        hasPasswordProvider={false}
        updatesCue={false}
        account={null}
        onSignIn={vi.fn()}
        onLogout={vi.fn()}
      />
    );
    const about = container.querySelector(".m-more__brand")!;
    expect(about.getAttribute("aria-label")).toBe("About & Legal");
    expect(about.querySelector("img.m-vh__logo")!.getAttribute("alt")).toBe("Hyperspace Vault");
    expect(about.querySelector(".m-vh__word")).toBeNull();
  });

  it("the shared-vault status header shows the initials logo", () => {
    const { container } = render(<SharedStatus status="loading" account={null} />);
    expect(container.querySelector(".m-more__brand img.m-vh__logo")!.getAttribute("alt")).toBe(
      "Hyperspace Vault"
    );
    expect(container.querySelector(".m-vh__word")).toBeNull();
  });
});
