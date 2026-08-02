import { describe, expect, it } from "vitest";
import { formatVersionLabel } from "./version";

// BL-184: pure formatting coverage for the footer version label.

describe("formatVersionLabel", () => {
  it("strips a trailing .0 patch", () => {
    expect(formatVersionLabel("1.4.0")).toBe("v1.4");
  });

  it("keeps a non-zero patch", () => {
    expect(formatVersionLabel("1.4.2")).toBe("v1.4.2");
  });

  it("keeps a non-zero minor.patch combo intact", () => {
    expect(formatVersionLabel("2.0.1")).toBe("v2.0.1");
  });

  it("strips .0 regardless of major/minor size", () => {
    expect(formatVersionLabel("10.23.0")).toBe("v10.23");
  });

  it("degrades to a prefixed passthrough for a malformed version string", () => {
    expect(formatVersionLabel("not-a-version")).toBe("vnot-a-version");
  });
});
