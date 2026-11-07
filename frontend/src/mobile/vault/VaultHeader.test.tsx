import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultHeader } from "./VaultHeader";
import { MoreScreen } from "../more/MoreScreen";
import { SharedStatus } from "../shared/SharedStatus";

// DISPOSITION (CREATE): the phone brand mark is the initials logo (App Spec
// §25.1); the unread-Updates cue rides on the tag line under it, and the
// collapsed strip keeps its "[HSV]" text badge with its own cue.

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
    expect(container.querySelector(".m-vh__logo.m-cue")).toBeNull();
    // The collapsed strip's text badge keeps its own cue.
    expect(container.querySelector(".m-vh__hsv.m-cue")).not.toBeNull();
  });

  it("carries no cue anywhere once the update is read", () => {
    const { container } = renderHeader(false);
    expect(container.querySelector(".m-cue")).toBeNull();
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
