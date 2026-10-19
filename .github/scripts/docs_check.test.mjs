// BL-271 Phase B: tests for docs_check.mjs. Run: node .github/scripts/docs_check.test.mjs
// Each fixture under fixtures/docs_check/<case>/ is a minimal fake repo tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runChecks,
  runGate,
  parseLinks,
  slugify,
  newestReleaseDate,
  isPrivatePath,
  daysLate,
  codeSpans,
  listDocFiles,
  parseCitations,
  jobMentions,
  inlineAdrStatuses,
  undatedCounts,
  parseReleaseEntries,
  renderReleasesBlock,
  spliceReleasesBlock,
  minorOf,
  HISTORY_BLOCK_START,
  HISTORY_BLOCK_END,
  GATE_CHECKS,
  LEVELS,
} from "./docs_check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "docs_check", name);
const SCRIPT = join(here, "docs_check.mjs");

const run = (name, opts = {}) => runChecks({ root: fx(name), ...opts }).findings;
const only = (findings, check) => findings.filter((f) => f.check === check);
const exitCode = (name, extra = []) =>
  spawnSync(process.execPath, [SCRIPT, "--root", fx(name), ...extra], { encoding: "utf-8" });

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

test("private allowlist: unmarked link fails (Phase C), marked link passes", () => {
  const unmarked = run("private_unmarked");
  assert.equal(only(unmarked, "links").length, 0);
  assert.equal(only(unmarked, "private-marker").length, 1);
  assert.equal(only(unmarked, "private-marker")[0].level, "fail");
  assert.equal(exitCode("private_unmarked").status, 1);
  assert.deepEqual(run("private_marked"), []);
});

test("private-marker: links inside a verbatim spec archive are exempt (Phase C)", () => {
  assert.equal(only(run("private_archive_exempt"), "private-marker").length, 0);
  assert.equal(exitCode("private_archive_exempt").status, 0);
});

test("adr-index: file without row, row without file, status mismatch", () => {
  assert.equal(only(run("adr_no_row"), "adr-index").length, 1);
  assert.match(only(run("adr_no_row"), "adr-index")[0].message, /no row/);
  assert.match(only(run("adr_row_no_file"), "adr-index")[0].message, /missing file/);
  assert.match(only(run("adr_status_mismatch"), "adr-index")[0].message, /status mismatch/);
  for (const c of ["adr_no_row", "adr_row_no_file", "adr_status_mismatch"])
    assert.equal(exitCode(c).status, 1, c);
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

// Disposition (BL-271 Phase E, 2026-10-19): the `history-current` test is REPLACED. The behaviour it guarded
// ("HISTORY must not lag the release notes") survives as `history-releases`: the Releases table is now generated
// from releaseNotes.ts and HISTORY must carry the fresh block — a stricter, deterministic form of the same intent.
test("history-releases: stale or missing generated block fails; fresh block passes", () => {
  const stale = only(run("history_stale"), "history-releases");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].level, "fail");
  assert.match(stale[0].message, /docs_history\.mjs --write/);
  assert.equal(exitCode("history_stale").status, 1);
  const missing = only(run("history_missing"), "history-releases");
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /markers missing/);
  assert.equal(only(run("pass"), "history-releases").length, 0);
});

test("release entries: regex parse ignores comments, keeps file order, falls back version->key, skips announcements in the table", () => {
  const ts = `
    // kind: "release", key: "9.9" — a comment, not an entry
    export const RELEASE_NOTES = [
      { kind: "release", key: "2.1", version: "2.1", /* date: "1999-01-01" */ date: "2026-10-18", title: "A \\"quoted\\" title" },
      { kind: "announcement", key: "a-2026-10-30", date: "2026-10-30", title: "Hello" },
      { kind: "release", key: "2.0.1", date: "2026-10-17", title: "Pipes | here" },
    ];`;
  const e = parseReleaseEntries(ts);
  assert.deepEqual(
    e.map((x) => [x.kind, x.key, x.version, x.date, x.title]),
    [
      ["release", "2.1", "2.1", "2026-10-18", 'A "quoted" title'],
      ["announcement", "a-2026-10-30", undefined, "2026-10-30", "Hello"],
      ["release", "2.0.1", "2.0.1", "2026-10-17", "Pipes | here"],
    ]
  );
  const block = renderReleasesBlock(e);
  assert.match(
    block,
    /\| 2026-10-18 \| v2\.1 \| A "quoted" title \|\n\| 2026-10-17 \| v2\.0\.1 \| Pipes \\\| here \|/
  );
  assert.ok(block.startsWith(HISTORY_BLOCK_START) && block.endsWith(HISTORY_BLOCK_END));
  const spliced = spliceReleasesBlock(
    `# H\r\n${HISTORY_BLOCK_START}\r\nold\r\n${HISTORY_BLOCK_END}\r\ntail\r\n`,
    block
  );
  assert.equal(spliced.had, true);
  assert.equal(spliced.text, `# H\n${block}\ntail\n`);
  assert.equal(spliceReleasesBlock("# H\nno markers\n", block).had, false);
});

test("release entries: a URL in a title survives, a trailing inline comment is harmless, and a reordered entry throws instead of vanishing", () => {
  const ok = parseReleaseEntries(`[
    { kind: "release", key: "2.2", version: "2.2", date: "2026-11-01", // placeholder date
      title: "See https://example.com/notes", sections: [{ items: [{ title: "nested", body: "b" }] }] },
  ]`);
  assert.deepEqual(
    ok.map((e) => [e.version, e.date, e.title]),
    [["2.2", "2026-11-01", "See https://example.com/notes"]]
  );
  assert.throws(
    () =>
      parseReleaseEntries(
        `[{ key: "2.9", date: "2026-11-01", title: "t", kind: "release", }, { kind: "release", key: "2.8", date: "2026-10-01", title: "u" }]`
      ),
    /entry 1 .*missing key\/date\/title/
  );
  assert.throws(
    () =>
      parseReleaseEntries(
        `[{ kind: "release", key: "2.9", date: "2026-11-01", sections: [{ items: [{ title: "nested" }] }], title: "top" }]`
      ),
    /title after `sections:`/
  );
  // kind last with no trailing comma: matched by nothing, so the count guard must catch it; the TS union type's
  // `kind: "release";` must not count as an entry
  assert.throws(
    () =>
      parseReleaseEntries(
        `type T = { kind: "release"; key: string }; export const X = [{ kind: "release", key: "1", date: "2026-01-01", title: "a" }, { key: "2", date: "2026-01-02", title: "b", kind: "release" }]`
      ),
    /2 entries declare a kind but 1 parsed/
  );
  assert.equal(
    renderReleasesBlock([
      { kind: "release", version: "1", date: "2026-01-01", title: "a\\b|c" },
    ]).split("\n")[4],
    "| 2026-01-01 | v1 | a\\\\b\\|c |"
  );
});

test("arch-as-of: a view behind the newest minor warns, a missing banner warns, current or newer passes", () => {
  const f = only(run("arch_asof_old"), "arch-as-of");
  assert.deepEqual(
    f.map((x) => [x.file.split("/").pop(), x.level]),
    [
      ["Architecture_Logical.md", "warn"],
      ["Architecture_Physical.md", "warn"],
    ]
  );
  assert.match(f[0].message, /v2\.0\.1 .* v2\.1/);
  assert.match(f[1].message, /no "as of release/);
  assert.equal(exitCode("arch_asof_old").status, 0);
  assert.equal(only(run("arch_asof_pass"), "arch-as-of").length, 0);
  assert.deepEqual(minorOf("v2.0.1"), [2, 0]);
  assert.deepEqual(minorOf("2.1"), [2, 1]);
  assert.equal(minorOf("nope"), null);
});

test("app-milestone: banner naming only the previous release warns (v2.1 vs v2.1.1 is a word match); naming the newest passes", () => {
  const f = only(run("app_milestone_missing"), "app-milestone");
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "warn");
  assert.match(f[0].message, /does not name v2\.1 /);
  assert.equal(only(run("app_milestone_pass"), "app-milestone").length, 0);
  assert.equal(
    only(run("pass"), "app-milestone").length,
    0,
    "no banner line at all -> nothing to check"
  );
});

test("repo-relative citations resolve against backend/, frontend/, frontend/src when a root is given", () => {
  const root = fx("cite_relative");
  const text =
    "See `app/auth.py`, `utils/googleAuth.ts:9`, `app/gone.py` and `backend/app/auth.py`.";
  assert.deepEqual(
    parseCitations(text).map((c) => c.path),
    ["backend/app/auth.py"],
    "no root: rooted paths only (Phase D behaviour)"
  );
  assert.deepEqual(
    parseCitations(text, root).map((c) => [c.path, c.relative ?? null, c.lines ?? null]),
    [
      ["backend/app/auth.py", "app/auth.py", null],
      ["frontend/src/utils/googleAuth.ts", "utils/googleAuth.ts", 9],
      ["backend/app/auth.py", null, null],
    ]
  );
  const f = run("cite_relative");
  assert.equal(only(f, "cite-path").length, 0, "unresolvable `app/gone.py` stays ignored");
  assert.equal(
    only(f, "cite-line-range").length,
    1,
    "the resolved citation's line number is range-checked"
  );
});

test("--gate: only the release-event checks, at fail; --waive demotes them; content failures are not the gate's business", () => {
  assert.deepEqual(GATE_CHECKS, [
    "history-releases",
    "last-updated",
    "arch-as-of",
    "app-milestone",
  ]);
  const g = runGate({ root: fx("arch_asof_old") });
  assert.deepEqual(
    [...new Set(g.findings.map((f) => [f.check, f.level].join(":")))],
    ["arch-as-of:fail"]
  );
  const w = runGate({ root: fx("arch_asof_old"), waive: true });
  assert.ok(w.findings.every((f) => f.level === "warn") && w.notes[0].includes("waived"));
  assert.equal(
    runGate({ root: fx("link_broken") }).findings.length,
    0,
    "a broken link is a PR-job failure, not a promote blocker"
  );
  assert.equal(runGate({ root: fx("pass") }).findings.length, 0);
  assert.equal(exitCode("history_stale", ["--gate"]).status, 1);
  assert.equal(exitCode("history_stale", ["--gate", "--waive"]).status, 0);
  assert.equal(exitCode("link_broken", ["--gate"]).status, 0);
  // last-updated inside the gate: fail with a late banner (git injected), nothing on a shallow checkout
  const git = (date) => (_r, a) => (a[0] === "rev-parse" ? "false" : date);
  const late = runGate({ root: fx("banner_late"), git: git("2026-12-31") });
  assert.deepEqual(
    late.findings.map((f) => [f.check, f.level]),
    [["last-updated", "fail"]]
  );
  assert.equal(runGate({ root: fx("banner_late"), git: () => "true" }).findings.length, 0);
});

test("parseLinks: one level of balanced brackets inside the link text", () => {
  const l = parseLinks("- [§25.4 More about · [HSV] Updates](X.md#a) and [plain](Y.md)");
  assert.deepEqual(
    l.map((x) => [x.text, x.target]),
    [
      ["§25.4 More about · [HSV] Updates", "X.md#a"],
      ["plain", "Y.md"],
    ]
  );
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
  assert.equal(
    slugify("5.14 Variant scope + the Value column (BL-173)"),
    "514-variant-scope--the-value-column-bl-173"
  );
  assert.equal(
    newestReleaseDate(
      '{kind:"release", date:"2026-01-01"} {kind:"announcement", date:"2027-01-01"} {kind:"release", key:"x", date:"2026-05-05"}'
    ),
    "2026-05-05"
  );
  assert.ok(isPrivatePath("specification_documents/analysis/x.md"));
  assert.ok(isPrivatePath("docs/decisions/0017-risk-tiered-autonomy-rubric.md"));
  assert.ok(!isPrivatePath("docs/decisions/0018-x.md"));
  assert.ok(
    parseLinks("`[x](a.md)` and\n```\n[y](b.md)\n```\n[z](c.md) [w](https://e.com)").length === 1
  );
});

test("level table: initial levels per the brief", () => {
  assert.equal(LEVELS.links, "fail");
  assert.equal(LEVELS["private-marker"], "fail");
  assert.equal(LEVELS["history-releases"], "fail"); // Phase E: replaced history-current (warn)
  assert.equal(LEVELS["arch-as-of"], "warn");
  assert.equal(LEVELS["app-milestone"], "warn");
  assert.equal("history-current" in LEVELS, false);
  assert.equal(LEVELS["adr-index"], "fail");
});

test("link-anchors: a missing heading is a warning, exit 0", () => {
  const f = run("anchor_missing");
  assert.equal(only(f, "link-anchors").length, 1);
  assert.equal(only(f, "link-anchors")[0].level, "warn");
  assert.equal(only(f, "links").length, 0);
  assert.equal(exitCode("anchor_missing").status, 0);
});

test("spec-tombstones-loose: bare archive pointer warns, exit 0", () => {
  const f = only(run("tomb_bare_pointer"), "spec-tombstones-loose");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /bare archive pointer/);
  assert.equal(exitCode("tomb_bare_pointer").status, 0);
});

test("private mode: stray tombstone-style line in the archive fails", () => {
  const f = only(run("private_stray", { privateMode: true }), "private-mode");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /stray/);
  assert.equal(exitCode("private_stray", ["--private"]).status, 1);
});

test("last-updated: skipped on a shallow checkout, flags a late banner otherwise", () => {
  const shallow = runChecks({ root: fx("pass"), git: () => "true" });
  assert.ok(shallow.notes.includes("last-updated: skipped (shallow checkout)"));
  assert.equal(only(shallow.findings, "last-updated").length, 0);
  const unavailable = runChecks({
    root: fx("pass"),
    git: () => {
      throw new Error("no git");
    },
  });
  assert.ok(unavailable.notes.includes("last-updated: skipped (shallow checkout)"));
  const full = runChecks({
    root: fx("pass"),
    git: (_r, a) => (a[0] === "rev-parse" ? "false" : "2026-12-31"),
  });
  assert.ok(!full.notes.includes("last-updated: skipped (shallow checkout)"));
  const git = (date) => (_r, a) => (a[0] === "rev-parse" ? "false" : date);
  assert.equal(
    only(runChecks({ root: fx("banner_late"), git: git("2026-10-17") }).findings, "last-updated")
      .length,
    1
  );
  assert.equal(
    only(runChecks({ root: fx("banner_late"), git: git("2026-10-16") }).findings, "last-updated")
      .length,
    0
  );
  assert.equal(
    only(runChecks({ root: fx("banner_late"), git: () => "true" }).findings, "last-updated").length,
    0
  );
  assert.equal(daysLate("2026-10-02", "2026-10-17"), 15);
  assert.equal(daysLate("2026-10-02", "2026-10-16"), 14);
});

// ── round 2 (BL-271 Phase B ext) ───────────────────────────────────────────
test("cite-path: a missing repo path fails; real, extensionless, runtime, private and non-path tokens pass", () => {
  const f = only(run("cite_path_fail", { levels: { "cite-path": "fail" } }), "cite-path");
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "fail");
  assert.match(f[0].message, /missing\.py/);
  assert.equal(exitCode("cite_path_fail", ["--level", "cite-path=fail"]).status, 1);
  assert.equal(exitCode("cite_path_fail").status, 1, "fail since Phase C (2026-10-19)");
  assert.deepEqual(run("cite_path_pass"), []);
  assert.equal(exitCode("cite_path_pass").status, 0);
});

test("cite-line: missing file fails; line beyond EOF warns; in-range passes", () => {
  const f = run("cite_line_fail");
  assert.equal(only(f, "cite-line").length, 1);
  assert.equal(only(f, "cite-line")[0].level, "fail");
  assert.equal(only(f, "cite-line-range").length, 1);
  assert.equal(exitCode("cite_line_fail").status, 1);
  const r = run("cite_line_range");
  assert.equal(only(r, "cite-line-range").length, 1);
  assert.equal(only(r, "cite-line-range")[0].level, "warn");
  assert.equal(exitCode("cite_line_range").status, 0);
  assert.deepEqual(run("cite_line_pass"), []);
  const c = parseCitations("`backend/x.py:3-9` `frontend/a.ts:2,14` `docs/x/` `foo/bar.py`");
  assert.deepEqual(
    c.map((x) => [x.path, x.lines]),
    [
      ["backend/x.py", 9],
      ["frontend/a.ts", 14],
      ["docs/x", undefined],
    ]
  );
});

test("ci-job-name: phantom job in the diagram or in prose fails; real names and other sections pass", () => {
  assert.deepEqual(run("ci_job_pass"), []);
  const FAIL = { levels: { "ci-job-name": "fail" } };
  const d = only(run("ci_job_fail_diagram", FAIL), "ci-job-name");
  assert.equal(d.length, 1);
  assert.match(d[0].message, /phantom-gate/);
  assert.equal(d[0].level, "fail");
  assert.equal(exitCode("ci_job_fail_diagram", ["--level", "ci-job-name=fail"]).status, 1);
  assert.equal(exitCode("ci_job_fail_diagram").status, 1, "fail since Phase C (2026-10-19)");
  const p = only(run("ci_job_fail_prose"), "ci-job-name").map((x) => x.message);
  assert.equal(p.length, 2);
  assert.ok(p.some((m) => /ghost-deploy/.test(m)) && p.some((m) => /deploy-ghost/.test(m)));
  // `ghost-job` sits in section 1 and is never looked at
  assert.ok(!p.some((m) => /ghost-job/.test(m)));
  const mentions = jobMentions([
    { n: 1, text: "terraform-fmt — independent; see below", fenced: true },
  ]);
  assert.deepEqual(
    mentions.map((m) => m.name),
    ["terraform-fmt"]
  );
});

test("adr-status-inline: contradicting status word fails; matching, 'Superseded by', and other-sentence words pass", () => {
  assert.deepEqual(run("adr_inline_pass"), []);
  const f = only(run("adr_inline_fail"), "adr-status-inline");
  assert.equal(f.length, 2);
  assert.equal(f[0].level, "fail");
  assert.equal(exitCode("adr_inline_fail").status, 1);
  assert.equal(inlineAdrStatuses("## Status\nADR-0001 Superseded\n").length, 0);
  // subject-before-word: "ADR-N: Superseded (date, ...)" IS a claim about ADR-N (S1) ...
  assert.deepEqual(
    inlineAdrStatuses("ADR-0003: Superseded (2026-10-08, BL-1). Accepted by nobody; see ADR-0004."),
    [{ line: 1, adr: "0003", word: "Superseded" }]
  );
  assert.deepEqual(
    inlineAdrStatuses("ADR-0010 (Superseded by ADR-0020)").map((x) => x.adr),
    ["0010"]
  );
  // ... but a banner whose only ADR mention is inside the parenthetical / "by" clause is not
  assert.equal(
    inlineAdrStatuses("> **Superseded (2026-10-08, BL-241 / ADR-0028):** old text moved.").length,
    0
  );
  assert.equal(inlineAdrStatuses("Superseded by ADR-0020 in 2026.").length, 0);
  assert.equal(only(run("adr_inline_by_fail"), "adr-status-inline").length, 1);
});

test("number-snapshot: undated counts warn (never fail); dated / as-of / command counts pass", () => {
  assert.deepEqual(run("number_snapshot_pass"), []);
  const f = only(run("number_snapshot_warn"), "number-snapshot");
  assert.equal(f.length, 2);
  assert.equal(f[0].level, "warn");
  assert.equal(exitCode("number_snapshot_warn").status, 0);
  assert.equal(undatedCounts("There are 1,234 files.").length, 1);
  assert.equal(undatedCounts("```\n1,234 files\n```").length, 0);
});

test("gap 1: root-relative links resolve from the repo root", () => {
  assert.deepEqual(run("rootrel_link_pass"), []);
  const f = only(run("rootrel_link_fail"), "links");
  assert.equal(f.length, 2);
  assert.ok(
    f.some(
      (x) =>
        x.file === "docs/decisions/0001-first.md" && /decisions\/0001-first\.md/.test(x.message)
    )
  );
  assert.equal(exitCode("rootrel_link_fail").status, 1);
});

test("gap 2: double-backtick spans containing a single backtick are masked", () => {
  assert.deepEqual(run("double_backtick"), []);
  const spans = codeSpans("a ``x`y`` b `c` ```d``e``` f");
  assert.deepEqual(
    spans.map((s) => s.content),
    ["x`y", "c", "d``e"]
  );
  assert.equal(parseLinks("``a`b [x](missing.md)`` [ok](ok.md)").length, 1);
  assert.equal(codeSpans("unclosed ` tick").length, 0);
});

test("gap 3: doc set comes from the tracked-file list at a repo toplevel, static list otherwise", () => {
  const root = fx("git_listing");
  const vcs = (files) => (_r, a) => {
    if (a[0] === "rev-parse" && a[1] === "--show-prefix") return "";
    if (a[0] === "rev-parse") return "true"; // shallow: last-updated skips
    if (a[0] === "ls-files") return files.join("\n");
    throw new Error("unexpected " + a.join(" "));
  };
  assert.deepEqual(
    listDocFiles(root, vcs(["README.md", "docs/decisions/0001-first.md", "src/x.ts"])),
    ["README.md", "docs/decisions/0001-first.md"].sort()
  );
  // untracked (private-layer) docs are not scanned: only README.md is tracked here
  const onlyReadme = only(runChecks({ root, git: vcs(["README.md"]) }).findings, "links");
  assert.equal(onlyReadme.length, 1);
  assert.equal(onlyReadme[0].file, "README.md");
  // toplevel elsewhere (fixture inside a bigger repo) or no VCS at all: static list
  assert.equal(only(runChecks({ root, git: () => "sub/dir/" }).findings, "links").length, 2);
  assert.equal(
    only(
      runChecks({
        root,
        git: () => {
          throw new Error("unavailable");
        },
      }).findings,
      "links"
    ).length,
    2
  );
});

test("round 2 level table and --json include the new checks", () => {
  for (const c of ["cite-line", "adr-status-inline", "cite-path", "ci-job-name"])
    assert.equal(LEVELS[c], "fail", c);
  for (const c of ["cite-line-range", "number-snapshot"]) assert.equal(LEVELS[c], "warn", c);
  const j = JSON.parse(exitCode("cite_line_fail", ["--json"]).stdout);
  assert.deepEqual([...new Set(j.findings.map((f) => f.check))].sort(), [
    "cite-line",
    "cite-line-range",
  ]);
  assert.equal(exitCode("cite_path_fail", ["--level", "cite-path=fail"]).status, 1);
});

test("cite-path: the ignore list is doc-scoped — the entry's doc passes, another doc citing the same missing path fails", () => {
  const f = only(run("cite_path_ignored"), "cite-path");
  assert.equal(f.length, 1);
  assert.equal(f[0].file, "README.md");
  assert.equal(f[0].level, "fail");
  assert.equal(exitCode("cite_path_ignored").status, 1);
});

test("private mode: tombstone-index table rows count as tombstones (Phase C)", () => {
  assert.deepEqual(only(run("private_table", { privateMode: true }), "private-mode"), []);
  assert.equal(exitCode("private_table", ["--private"]).status, 0);
});
