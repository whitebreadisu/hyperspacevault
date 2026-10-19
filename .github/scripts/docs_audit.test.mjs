// BL-271 Phase E: tests for docs_audit.mjs. Run: node .github/scripts/docs_audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexRows, changedSinceBanner, audit } from "./docs_audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "docs_check", name);
const SCRIPT = join(here, "docs_audit.mjs");

const INDEX = `<!-- generated 2026-10-19 ... -->
# Documentation index (generated)

Paragraph.

## SWU_Application_Spec.md

Total 1 B (LF) · 1 h2 · 1 h3

| § | Section | Line | Bytes (LF) | Dated banner | ADRs | Code paths cited | Archive headings quoted |
|---|---|---|---|---|---|---|---|
| — | (preamble: title and front matter) | 1 | 3,407 | 2026-10-19 Last updated | 0032 | \`docs/decisions\` |  |
| h2 | [§5. UX](SWU_Application_Spec.md#5-ux) | 142 | 100 |  |  | \`frontend/src/App.tsx\` |  |
| h3 | [§5.3 Popup (S6)](SWU_Application_Spec.md#53-popup-s6) | 156 | 100 | 2026-07-13 Decided | 0001 | \`frontend/src/screens/cards/CardPopup.tsx\`, \`backend/app/routers\` | "Archived 2026-10-18 — x" |
| h3 | [§5.4 No paths](SWU_Application_Spec.md#54-no-paths) | 170 | 10 | 2026-07-13 Decided |  |  |  |

## SWU_Platform_Spec.md

| § | Section | Line | Bytes (LF) | Dated banner | ADRs | Code paths cited | Archive headings quoted |
|---|---|---|---|---|---|---|---|
| h3 | [§3.6 Cloud SQL](SWU_Platform_Spec.md#36-cloud-sql) | 360 | 50 | 2026-07-24 Decided | | \`backend/app/database.py\` |  |
`;

test("indexRows: only rows with a banner date AND cited paths; spec and section parsed; header/separator skipped", () => {
  const rows = indexRows(INDEX);
  assert.deepEqual(
    rows.map((r) => [r.spec, r.section, r.line, r.banner, r.paths]),
    [
      [
        "SWU_Application_Spec.md",
        "(preamble: title and front matter)",
        1,
        "2026-10-19",
        ["docs/decisions"],
      ],
      [
        "SWU_Application_Spec.md",
        "5.3 Popup (S6)",
        156,
        "2026-07-13",
        ["frontend/src/screens/cards/CardPopup.tsx", "backend/app/routers"],
      ],
      ["SWU_Platform_Spec.md", "3.6 Cloud SQL", 360, "2026-07-24", ["backend/app/database.py"]],
    ]
  );
});

test("changedSinceBanner: a path changed after the banner lists the row; same-day or older or unknown does not", () => {
  const dates = {
    "docs/decisions": "2026-10-19", // same day as the banner -> not newer
    "frontend/src/screens/cards/CardPopup.tsx": "2026-10-02",
    "backend/app/routers": "2026-07-01",
    "backend/app/database.py": "", // no history -> ignored
  };
  const out = changedSinceBanner(indexRows(INDEX), (p) => dates[p] ?? "");
  assert.deepEqual(
    out.map((r) => [r.section, r.changed]),
    [["5.3 Popup (S6)", [{ path: "frontend/src/screens/cards/CardPopup.tsx", date: "2026-10-02" }]]]
  );
});

test("audit on the pass fixture: no docs-check findings; artefact freshness reported; gate would pass; exit 0", () => {
  const { findings, markdown } = audit(fx("pass"));
  assert.match(markdown, /docs-check, every check at fail — 0 finding\(s\)/);
  assert.match(markdown, /HISTORY\.md Releases block: fresh/);
  assert.match(
    markdown,
    /INDEX\.md: \*\*STALE or missing\*\*/,
    "the fixture has no INDEX.md, so that artefact counts as a finding"
  );
  assert.match(markdown, /Would pass\./);
  assert.equal(findings, 1);
  const r = spawnSync(process.execPath, [SCRIPT, "--root", fx("pass")], { encoding: "utf-8" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /docs-audit: 1 finding\(s\)/);
  assert.match(r.stdout, /^## Documentation audit — \d{4}-\d{2}-\d{2} at `/);
});

test("audit on a fixture with warns: strict mode counts them and the gate section names the blocker", () => {
  const { findings, markdown } = audit(fx("arch_asof_old"));
  assert.match(markdown, /docs-check, every check at fail — 2 finding\(s\)/);
  assert.match(markdown, /would \*\*block the next prod promote\*\*/);
  assert.ok(findings >= 3, `${findings}`); // 2 strict + 1 index + 2 gate
});
