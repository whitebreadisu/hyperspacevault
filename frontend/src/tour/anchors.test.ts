import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_TOURS } from "../content/featureTours";

// Controls Register (Platform Spec §2.8), "tour anchor drift": every enabled
// tip of every feature tour must have its target in the source, as a
// `data-tour="<anchor>"` attribute (or `data-tour={... "<anchor>" ...}` when
// the attribute is conditional) in a non-test .tsx file under frontend/src. A
// UI change that drops or renames a target fails here instead of silently
// leaving the tip with nothing to point at.

// Run from frontend/ (vitest's root), as mobile/docs.test.ts reads its files.
const SRC = "src";

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (/\.tsx$/.test(entry.name) && !/\.(test|spec)\.tsx$/.test(entry.name)) out.push(path);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `data-tour` names the anchor, as files relative to src. */
function anchorSites(anchor: string, sources: [string, string][]): string[] {
  const a = escape(anchor);
  const re = new RegExp(`data-tour=(?:"${a}"|\\{[^}]*"${a}"[^}]*\\})`);
  return sources.filter(([, text]) => re.test(text)).map(([path]) => relative(SRC, path));
}

describe("feature tour anchors", () => {
  const sources = tsxFiles(SRC).map((p) => [p, readFileSync(p, "utf8")] as [string, string]);

  it("scans the app source", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  for (const tour of FEATURE_TOURS) {
    for (const tip of tour.tips.filter((t) => t.enabled)) {
      it(`v${tour.version} ${tip.id}: data-tour="${tip.anchor}" exists`, () => {
        expect(anchorSites(tip.anchor, sources)).not.toEqual([]);
      });
    }
  }

  it("the matcher misses an anchor no file carries", () => {
    expect(anchorSites("no-such-anchor-ever", sources)).toEqual([]);
  });
});
