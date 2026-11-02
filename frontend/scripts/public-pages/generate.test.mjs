import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { inertSdks, staticTemplate } from "./generate.mjs";

// The public pages never bundle the Firebase SDK or the analytics SDK
// (design note §3, §6 C7): generate.mjs's inertSdks plugin swaps posthog-js
// and the app's src/firebase module for inert stand-ins in both builds, and
// fails the build on any other route to the Firebase SDK.

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const authedFetch = join(frontend, "src/api/authedFetch.ts");

function resolveWith(source, importer) {
  const plugin = inertSdks();
  const ctx = {
    error(msg) {
      throw new Error(msg);
    },
  };
  return plugin.resolveId.call(ctx, source, importer);
}

describe("inertSdks plugin", () => {
  it("resolves posthog-js and the app's firebase module to the inert stand-ins", () => {
    const plugin = inertSdks();
    expect(plugin.enforce).toBe("pre");
    expect(resolveWith("posthog-js", authedFetch)).toBe("\0virtual:pc-posthog");
    expect(resolveWith("../firebase", authedFetch)).toBe("\0virtual:pc-firebase");
    expect(resolveWith("../firebase.ts", authedFetch)).toBe("\0virtual:pc-firebase");
    expect(resolveWith("../../firebase", join(frontend, "src/screens/cards/X.tsx"))).toBe(
      "\0virtual:pc-firebase"
    );
    expect(plugin.load("\0virtual:pc-firebase")).toMatch(
      /export const auth = \{ currentUser: null \}/
    );
    expect(plugin.load("\0virtual:pc-posthog")).toBe("export default {};");
  });

  it("leaves every other module alone", () => {
    expect(resolveWith("react", authedFetch)).toBeNull();
    expect(resolveWith("./baseCards", authedFetch)).toBeNull();
    expect(resolveWith("../firebaseConfig", authedFetch)).toBeNull();
    expect(inertSdks().load(join(frontend, "src/main.tsx"))).toBeNull();
  });

  it.each(["firebase", "firebase/auth", "firebase/app"])("refuses %s", (source) => {
    expect(() => resolveWith(source, authedFetch)).toThrow(
      `public pages must not bundle the Firebase SDK: ${source} imported by ${authedFetch}`
    );
  });

  // The same refusal through a real Vite build: an entry that reaches the
  // Firebase SDK any other way fails the build.
  const tmp = mkdtempSync(join(tmpdir(), "cp-inert-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  async function buildEntry(code) {
    const dir = mkdtempSync(join(tmp, "b-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/entry.js"), code);
    return build({
      root: frontend,
      configFile: false,
      logLevel: "silent",
      plugins: [inertSdks()],
      build: {
        write: false,
        lib: { entry: join(dir, "src/entry.js"), formats: ["es"], fileName: "entry" },
      },
    });
  }

  it("fails a real build that imports firebase/auth", async () => {
    await expect(
      buildEntry('import { getAuth } from "firebase/auth"; export const a = getAuth;')
    ).rejects.toThrow(/must not bundle the Firebase SDK: firebase\/auth/);
  }, 30_000);

  it("builds posthog-js as the inert stand-in", async () => {
    const out = await buildEntry('import posthog from "posthog-js"; export const p = posthog;');
    const code = (Array.isArray(out) ? out[0] : out).output[0].code;
    expect(code).not.toMatch(/posthog\.com|capture_pageview/);
  }, 30_000);
});

describe("staticTemplate", () => {
  it("drops the page script and module preloads, keeps the stylesheet", () => {
    const tpl =
      '<link rel="stylesheet" href="/assets/card-x.css"><link rel="modulepreload" href="/assets/c.js">' +
      '<script type="module" crossorigin src="/assets/card-x.js"></script><!--pc-body-->';
    expect(staticTemplate(tpl)).toBe(
      '<link rel="stylesheet" href="/assets/card-x.css"><!--pc-body-->'
    );
  });
});
