import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, shareOrCopy } from "./shareLink";

// Copy and share for card links (App Spec §5.3, §25.2).

function setNav(name: "clipboard" | "share", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

afterEach(() => {
  setNav("clipboard", undefined);
  setNav("share", undefined);
  Object.defineProperty(document, "execCommand", { value: undefined, configurable: true });
});

describe("copyText", () => {
  it("uses the async clipboard when it is there", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav("clipboard", { writeText });
    expect(await copyText("u")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("u");
  });

  it("falls back to a hidden textarea, removes it and gives focus back", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    let seen = "";
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => {
        seen = (document.querySelector("textarea") as HTMLTextAreaElement).value;
        return true;
      }),
      configurable: true,
    });
    expect(await copyText("link")).toBe(true);
    expect(seen).toBe("link");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("reports false when neither way copies", async () => {
    setNav("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    expect(await copyText("x")).toBe(false);
  });
});

describe("shareOrCopy", () => {
  it("opens the share sheet with the title and url", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNav("share", share);
    expect(await shareOrCopy("Luke", "https://x/")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Luke", url: "https://x/" });
  });

  it("a cancelled sheet is cancelled, not an error, and copies nothing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav("clipboard", { writeText });
    setNav("share", vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")));
    expect(await shareOrCopy("Luke", "https://x/")).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when there is no share sheet, or the sheet fails another way", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav("clipboard", { writeText });
    expect(await shareOrCopy("Luke", "https://x/")).toBe("copied");
    setNav("share", vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")));
    expect(await shareOrCopy("Luke", "https://y/")).toBe("copied");
    expect(writeText).toHaveBeenLastCalledWith("https://y/");
  });

  it("is failed when the fallback copy fails too", async () => {
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    expect(await shareOrCopy("Luke", "https://x/")).toBe("failed");
  });
});
