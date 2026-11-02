import { describe, expect, it } from "vitest";
import { UsageError, parseArgs } from "./args.mjs";

const BACKEND = [
  "--backend",
  "https://be.run.app/",
  "--expect-sha",
  "abc",
  "--origin",
  "https://x/",
];

describe("generator command line", () => {
  it("parses the deploy form", () => {
    const o = parseArgs(
      [...BACKEND, "--allow-shrink", "false", "--images-bucket", "bk", "--summary", "s.md"],
      { PUBLIC_PAGES_NOINDEX: "true", GCS_ACCESS_TOKEN: "tok" }
    );
    expect(o).toMatchObject({
      mode: "backend",
      backend: "https://be.run.app",
      expectSha: "abc",
      origin: "https://x",
      allowShrink: false,
      images: "auto",
      imagesBucket: "bk",
      summary: "s.md",
      dist: "dist",
      noindex: true,
      token: "tok",
      overrideName: "--allow-shrink",
    });
  });

  it("parses the fixture form: no live reads, no image check", () => {
    const o = parseArgs(["--catalog", "f.json", "--origin", "https://www.hyperspacevault.com"]);
    expect(o).toMatchObject({ mode: "catalog", catalog: "f.json", images: "off", noindex: false });
  });

  it('reads --allow-shrink strictly: "false" is false, a bare flag is true', () => {
    expect(parseArgs([...BACKEND, "--allow-shrink", "false"]).allowShrink).toBe(false);
    expect(parseArgs([...BACKEND, "--allow-shrink", "true"]).allowShrink).toBe(true);
    expect(parseArgs([...BACKEND, "--allow-shrink"]).allowShrink).toBe(true);
    expect(parseArgs(["--allow-shrink", ...BACKEND]).allowShrink).toBe(true);
    expect(parseArgs(BACKEND).allowShrink).toBe(false);
    expect(() => parseArgs([...BACKEND, "--allow-shrink", "yes"])).toThrow(/true or false/);
  });

  it.each([
    [["--origin", "https://x"], /--catalog FILE or --backend URL/],
    [["--backend", "https://b", "--origin", "https://x"], /needs --expect-sha/],
    [["--catalog", "f", "--backend", "https://b", "--origin", "https://x"], /cannot be combined/],
    [["--catalog", "f"], /--origin is required/],
    [["--catalog", "f", "--origin", "ftp://x"], /http\(s\) URL/],
    [["--catalog", "f", "--origin", "x"], /not a URL/],
    [["--catalog", "f", "--origin", "https://x", "--images", "bucket"], /checks no images/],
    [[...BACKEND, "--images", "sometimes"], /--images must be one of/],
    [[...BACKEND, "--origin", "https://y"], /given twice/],
    [[...BACKEND, "--summary"], /--summary needs a value/],
    [[...BACKEND, "--sumary", "s"], /unknown argument: --sumary/],
  ])("refuses %j", (argv, msg) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(msg);
  });

  it("refuses a PUBLIC_PAGES_NOINDEX that is neither true nor false", () => {
    expect(() => parseArgs(BACKEND, { PUBLIC_PAGES_NOINDEX: "1" })).toThrow(/true or false/);
    expect(parseArgs(BACKEND, { PUBLIC_PAGES_NOINDEX: "false" }).noindex).toBe(false);
  });
});
