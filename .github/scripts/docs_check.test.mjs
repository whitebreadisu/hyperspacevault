// BL-271 Phase B: tests for docs_check.mjs. Run: node .github/scripts/docs_check.test.mjs
// Each fixture under fixtures/docs_check/<case>/ is a minimal fake repo tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks, parseLinks, slugify, newestReleaseDate, isPrivatePath, LEVELS } from "./docs_check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "docs_check", name);
const SCRIPT = join(here, "docs_check.mjs");

const run = (name, opts = {}) => runChecks({ root: fx(name), ...opts }).findings;
const only = (findings, check) => findings.filter((f) => f.check === check);
const exitCode = (name, extra = []) => spawnSync(process.execPath, [SCRIPT, "--root", fx(name), ...extra], { encoding: "utf-8" });

test("pass fixture: no findings, exit 0", () => {
  assert.deepEqual(run("pass"), []);
  const r = exitCode("pass");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /docs-check: 0 fail, 0 warn/);
});

test("links: broken relative link fails, exit 1", () => {
  const f = only(run("link_broken"), "links");
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "fail");
  assert.match(f[0].message, /missing\.md/);
  assert.equal(exitCode("link_broken").status, 1);
});

test("links: bad anchor is a warning, not a failure", () => {
  const f = run("pass", { levels: {} });
  assert.equal(only(f, "link-anchors").length, 0);
  const slugs = parseLinks("[a](x.md#nope)");
  assert.equal(slugs[0].target, "x.md#nope");
});

test("private allowlist: unmarked link warns, marked link passes, neither fails", () => {
  const unmarked = run("private_unmarked");
  assert.equal(only(unmarked, "links").length, 0);
  assert.equal(only(unmarked, "private-marker").length, 1);
  assert.equal(only(unmarked, "private-marker")[0].level, "warn");
  assert.equal(exitCode("private_unmarked").status, 0);
  assert.deepEqual(run("private_marked"), []);
});

test("adr-index: file without row, row without file, status mismatch", () => {
  assert.equal(only(run("adr_no_row"), "adr-index").length, 1);
  assert.match(only(run("adr_no_row"), "adr-index")[0].message, /no row/);
  assert.match(only(run("adr_row_no_file"), "adr-index")[0].message, /missing file/);
  assert.match(only(run("adr_status_mismatch"), "adr-index")[0].message, /status mismatch/);
  for (const c of ["adr_no_row", "adr_row_no_file", "adr_status_mismatch"]) assert.equal(exitCode(c).status, 1, c);
});

test("adr-index: private ADR row with no public file passes (pass fixture has 0017)", () => {
  assert.equal(only(run("pass"), "adr-index").length, 0);
});

test("spec-tombstones: quoted heading missing from archive fails", () => {
  const f = only(run("tomb_no_heading"), "spec-tombstones");
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "fail");
  assert.equal(exitCode("tomb_no_heading").status, 1);
});

test("spec-tombstones: archive heading with no tombstone fails when its date is not in the spec", () => {
  const f = only(run("tomb_heading_unquoted"), "spec-tombstones");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /not quoted/);
  assert.equal(exitCode("tomb_heading_unquoted").status, 1);
});

test("spec-tombstones: truncated quote is loose (warn), not a failure", () => {
  const f = run("tomb_truncated_quote");
  assert.equal(only(f, "spec-tombstones").length, 0);
  assert.equal(only(f, "spec-tombstones-loose").length, 1);
  assert.equal(exitCode("tomb_truncated_quote").status, 0);
});

test("history-current: HISTORY older than the newest release warns and does not fail", () => {
  const f = only(run("history_old"), "history-current");
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "warn");
  assert.equal(exitCode("history_old").status, 0);
  assert.equal(exitCode("history_old", ["--level", "history-current=fail"]).status, 1);
});

test("private mode: pass, orphan tombstone, duplicate/resolved entry, files absent", () => {
  assert.deepEqual(only(run("private_pass", { privateMode: true }), "private-mode"), []);
  assert.equal(exitCode("private_pass", ["--private"]).status, 0);
  const orphan = only(run("private_orphan", { privateMode: true }), "private-mode");
  assert.equal(orphan.length, 1);
  assert.match(orphan[0].message, /BL-3/);
  assert.equal(exitCode("private_orphan", ["--private"]).status, 1);
  const dup = only(run("private_duplicate", { privateMode: true }), "private-mode");
  assert.ok(dup.some((x) => /both/.test(x.message)));
  assert.ok(dup.some((x) => /Resolved/.test(x.message)));
  assert.equal(exitCode("private_duplicate", ["--private"]).status, 1);
  // not in private mode the ledger is not looked at
  assert.equal(only(run("private_orphan"), "private-mode").length, 0);
  const absent = exitCode("private_absent", ["--private"]);
  assert.equal(absent.status, 0);
  assert.match(absent.stdout, /backlog files absent/);
});

test("--json prints findings; --level overrides", () => {
  const r = exitCode("link_broken", ["--json"]);
  const j = JSON.parse(r.stdout);
  assert.equal(j.fails, 1);
  assert.equal(exitCode("link_broken", ["--level", "links=warn"]).status, 0);
  assert.equal(exitCode("pass", ["--level", "nonsense=fail"]).status, 2);
});

test("helpers: slug rules, release-date parse, private allowlist", () => {
  assert.equal(slugify("5.14 Variant scope + the Value column (BL-173)"), "514-variant-scope--the-value-column-bl-173");
  assert.equal(newestReleaseDate('{kind:"release", date:"2026-01-01"} {kind:"announcement", date:"2027-01-01"} {kind:"release", key:"x", date:"2026-05-05"}'), "2026-05-05");
  assert.ok(isPrivatePath("specification_documents/analysis/x.md"));
  assert.ok(isPrivatePath("docs/decisions/0017-risk-tiered-autonomy-rubric.md"));
  assert.ok(!isPrivatePath("docs/decisions/0018-x.md"));
  assert.ok(parseLinks("`[x](a.md)` and\n```\n[y](b.md)\n```\n[z](c.md) [w](https://e.com)").length === 1);
});

test("level table: initial levels per the brief", () => {
  assert.equal(LEVELS.links, "fail");
  assert.equal(LEVELS["private-marker"], "warn");
  assert.equal(LEVELS["history-current"], "warn");
  assert.equal(LEVELS["adr-index"], "fail");
});
