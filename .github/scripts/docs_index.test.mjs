// BL-271 Phase D: tests for docs_index.mjs. Run: node .github/scripts/docs_index.test.mjs
// Fixtures under fixtures/docs_index/<case>/ are minimal fake repo trees (one spec each).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec, banner, adrs, codePaths, quotes, generateBody, bodyOf } from "./docs_index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "docs_index", name);
const SCRIPT = join(here, "docs_index.mjs");
const cli = (root, ...extra) =>
  spawnSync(process.execPath, [SCRIPT, "--root", root, ...extra], { encoding: "utf-8" });
const DOC = "specification_documents/SWU_Application_Spec.md";
const rows = (text) => parseSpec(text, DOC);
const bl = (...texts) => texts.map((text, i) => ({ n: i + 1, text, fenced: false }));

test("fresh fixture: committed body equals generation, exit 0", () => {
  const r = cli(fx("fresh"));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /fresh/);
});

test("stale fixture: one byte count differs, exit 1, prints the regenerate command", () => {
  const r = cli(fx("stale"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /docs_index\.mjs --write/);
  assert.match(r.stdout, /STALE/);
});

test("missing fixture: no INDEX.md, exit 1", () => {
  const r = cli(fx("missing"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing/);
  assert.match(r.stdout, /docs_index\.mjs --write/);
});

test("bad arguments exit 2", () => {
  assert.equal(cli(fx("fresh"), "--nope").status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "--root"], { encoding: "utf-8" }).status, 2);
});

test("a heading inside a fenced block is not a section", () => {
  const r = rows("# T\n\n## A\n\n```\n## fake\n### fake\n```\n\n## B\n");
  assert.deepEqual(r.map((x) => x.heading).slice(1), ["A", "B"]);
});

test("### bytes nest inside their ## and preamble + sections sum to the file size", () => {
  const text = "# T\n\nintro é\n\n## A\nx\n### A1\nyy\n### A2\nzzz\n## B\nw\n";
  const r = rows(text);
  const total = Buffer.byteLength(text);
  const a = r.find((x) => x.heading === "A");
  const kids = r.filter((x) => x.heading.startsWith("A") && x.level === 3);
  assert.equal(a.bytes, Buffer.byteLength("## A\nx\n") + kids.reduce((s, k) => s + k.bytes, 0));
  assert.equal(
    r.filter((x) => x.level <= 2).reduce((s, x) => s + x.bytes, 0),
    total
  );
  assert.equal(r[0].level, 0);
});

test("CRLF and LF inputs produce identical rows and identical CLI output", () => {
  const lfText = readFileSync(join(fx("fresh"), DOC), "utf-8").replace(/\r\n/g, "\n");
  const crlf = lfText.replace(/\n/g, "\r\n");
  assert.deepEqual(rows(crlf), rows(lfText));
  const tmp = mkdtempSync(join(tmpdir(), "docs_index_"));
  try {
    const a = join(tmp, "lf");
    const b = join(tmp, "crlf");
    for (const [d, t] of [
      [a, lfText],
      [b, crlf],
    ]) {
      mkdirSync(join(d, "specification_documents"), { recursive: true });
      writeFileSync(join(d, DOC), t);
    }
    assert.equal(generateBody(a).body, generateBody(b).body);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("banner: Last updated, bold-lead with date, and none", () => {
  assert.equal(
    banner(bl("text", "> **Last updated:** 2026-10-19 (stuff)")),
    "2026-10-19 Last updated"
  );
  assert.equal(
    banner(bl("> **Review currency (2026-08-16, BL-232):** x")),
    "2026-08-16 Review currency"
  );
  assert.equal(banner(bl("**Decided 2026-07-12.** more")), "2026-07-12 Decided");
  assert.equal(banner(bl("> **Milestone:** shipped 2026-07-14", "plain 2026-01-01")), "");
  assert.equal(banner(bl("> **" + "Long ".repeat(20) + "2026-01-01**")).length <= 11 + 40, true);
});

test("ADRs: both forms, de-duplicated and sorted", () => {
  const t =
    "ADR-0020 and [x](../docs/decisions/0003-foo.md) and ADR-0020 again, ADR-0034, docs/decisions/0003-foo.md";
  assert.deepEqual(adrs(t), ["0003", "0020", "0034"]);
  assert.deepEqual(adrs("nothing"), []);
});

test("code paths: de-duplicated, line numbers dropped, ignore-listed removed", () => {
  const t =
    "`backend/app/a.py:12` and `backend/app/a.py` and `frontend/src/b.ts:3-9` and `backend/app/tests/test_card_domain_rules.py`";
  assert.deepEqual(codePaths(t, DOC), [
    "backend/app/a.py",
    "backend/app/tests/test_card_domain_rules.py",
    "frontend/src/b.ts",
  ]);
  assert.deepEqual(codePaths(t, "specification_documents/CARD_RULES.md"), [
    "backend/app/a.py",
    "frontend/src/b.ts",
  ]);
});

test("archive quotes: unique, in order", () => {
  const t =
    'see "Archived 2026-01-01 — a" and "Superseded 2026-02-02 — b" and "Archived 2026-01-01 — a" and "Other 2026-01-01"';
  assert.deepEqual(quotes(t), ["Archived 2026-01-01 — a", "Superseded 2026-02-02 — b"]);
});

test("pipes in headings are escaped in the table", () => {
  const tmp = mkdtempSync(join(tmpdir(), "docs_index_"));
  try {
    mkdirSync(join(tmp, "specification_documents"));
    writeFileSync(join(tmp, DOC), "# T\n\n## A | B\n");
    assert.match(generateBody(tmp).body, /\[§A \\\| B\]\(SWU_Application_Spec\.md#a--b\)/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("header line is excluded from the comparison; --write then --check is fresh", () => {
  const tmp = mkdtempSync(join(tmpdir(), "docs_index_"));
  try {
    cpSync(fx("missing"), tmp, { recursive: true });
    assert.equal(cli(tmp, "--write").status, 0);
    assert.equal(cli(tmp, "--check").status, 0);
    assert.equal(cli(tmp).status, 0);
    const p = join(tmp, "specification_documents", "INDEX.md");
    const text = readFileSync(p, "utf-8");
    writeFileSync(p, text.replace(/^[^\n]*/, "<!-- generated 1999-01-01 by someone else -->"));
    assert.equal(cli(tmp).status, 0);
    writeFileSync(p, text.replace(/\n/g, "\r\n"));
    assert.equal(cli(tmp).status, 0, "CRLF-checked-out index still fresh");
    assert.equal(bodyOf(text.replace(/\n/g, "\r\n")), bodyOf(text));
    writeFileSync(p, text.replace("| 17 |", "| 18 |"));
    assert.equal(cli(tmp).status, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
