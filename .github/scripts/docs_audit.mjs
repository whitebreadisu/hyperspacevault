// BL-271 Phase E: the scheduled documentation audit (ADR-0033 "audit on a schedule").
// Dependency-free, Node >= 20. Run monthly by .github/workflows/docs-audit.yml, which pastes the report into
// one rolling GitHub issue; also runnable locally.
//
//   node .github/scripts/docs_audit.mjs [--root <dir>] [--out <report.md>]
//
// Four parts, all derived (nothing typed by hand):
//   1. docs-check with EVERY level at fail (the PR job tolerates warns; the audit does not)
//   2. the generated artefacts' freshness: INDEX.md (docs_index) and HISTORY.md's Releases block
//   3. "sections whose cited code changed": every INDEX.md row with a dated banner and cited code paths,
//      where `git log -1 --format=%cs -- <path>` is newer than the banner date — the spec section may be
//      describing code that has since moved (the drift class a feature PR without a spec PR produces)
//   4. the promote-time docs gate as it would run today (GATE_CHECKS)
// Always exits 0 and writes `findings=<n>` to $GITHUB_OUTPUT when set; the workflow decides what to do.
// Triage vocabulary for the issue (ADR-0033): drift (spec behind code) / defect (code behind spec) /
// intentional-unbuilt (design-stage text, belongs on the private design shelf).

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LEVELS, GATE_CHECKS, runChecks, runGate, cellEscape } from "./docs_check.mjs";
import { generateBody, bodyOf } from "./docs_index.mjs";
import { historyState } from "./docs_history.mjs";

const git = (root, args) => {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

/** INDEX.md rows -> [{spec, section, line, banner, paths}] (only rows with a banner date AND cited paths). */
export function indexRows(indexText) {
  const rows = [];
  let spec = null;
  for (const line of indexText.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^## (\S+\.md)\s*$/.exec(line);
    if (h) spec = h[1];
    if (!spec || !line.startsWith("| ")) continue;
    // Split on unescaped pipes (headings may carry `\|`); empty cells may be `|  |` or `| |`.
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|\s*$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (cells.length < 8 || cells[0] === "§" || cells[0].startsWith("---")) continue;
    const date = /^(\d{4}-\d{2}-\d{2})/.exec(cells[4])?.[1];
    const paths = [...cells[6].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!date || paths.length === 0) continue;
    const section = cells[1].replace(/^\[§?(.*?)\]\(.*\)$/, "$1");
    rows.push({ spec, section, line: Number(cells[2]), banner: date, paths });
  }
  return rows;
}

/** Rows whose cited paths changed after the banner; `lastChange(path)` -> ISO date or "" (injectable for tests). */
export function changedSinceBanner(rows, lastChange) {
  const out = [];
  for (const r of rows) {
    const changed = r.paths
      .map((p) => ({ path: p, date: lastChange(p) }))
      .filter((c) => c.date && c.date > r.banner);
    if (changed.length) out.push({ ...r, changed });
  }
  return out;
}

export function audit(root) {
  const parts = [];
  let findings = 0;
  const h = (s) => parts.push(`\n### ${s}\n`);

  // 1. docs-check, every level at fail
  const strict = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, "fail"]));
  const dc = runChecks({ root, levels: strict });
  findings += dc.findings.length;
  h(`docs-check, every check at fail — ${dc.findings.length} finding(s)`);
  if (dc.findings.length) {
    parts.push("| Check | Where | Finding |", "|---|---|---|");
    for (const f of dc.findings)
      parts.push(`| \`${f.check}\` | \`${f.file}:${f.line}\` | ${cellEscape(f.message)} |`);
  } else parts.push("None.");

  // 2. generated artefacts
  h("Generated artefacts");
  const idxPath = join(root, "specification_documents", "INDEX.md");
  let idxFresh = false;
  if (existsSync(idxPath)) {
    idxFresh =
      bodyOf(readFileSync(idxPath, "utf-8")) === generateBody(root).body.replace(/\r\n/g, "\n");
  }
  parts.push(
    `- INDEX.md: ${idxFresh ? "fresh" : "**STALE or missing** — `node .github/scripts/docs_index.mjs --write`"}`
  );
  if (!idxFresh) findings++;
  let hist = { status: "missing" };
  try {
    hist = historyState(root);
  } catch {
    /* files absent */
  }
  parts.push(
    `- HISTORY.md Releases block: ${hist.status === "fresh" ? "fresh" : `**${hist.status.toUpperCase()}** — \`node .github/scripts/docs_history.mjs --write\``}`
  );
  // Not counted here: a stale/missing block is already a `history-releases` finding in the strict run.

  // 3. sections whose cited code changed since the section's banner
  h("Spec sections whose cited code changed after the section's dated banner");
  if (existsSync(idxPath)) {
    const shallow = git(root, ["rev-parse", "--is-shallow-repository"]) !== "false";
    if (shallow) parts.push("Skipped: shallow checkout (needs `fetch-depth: 0`).");
    else {
      const cache = new Map();
      const lastChange = (p) => {
        if (!cache.has(p)) cache.set(p, git(root, ["log", "-1", "--format=%cs", "--", p]));
        return cache.get(p);
      };
      const rows = changedSinceBanner(indexRows(readFileSync(idxPath, "utf-8")), lastChange);
      findings += rows.length;
      if (rows.length) {
        parts.push(
          "Triage each as drift / defect / intentional-unbuilt (ADR-0033).",
          "",
          "| Spec | Section | Banner | Code changed since |",
          "|---|---|---|---|"
        );
        for (const r of rows)
          parts.push(
            `| ${r.spec} | ${cellEscape(r.section)} (L${r.line}) | ${r.banner} | ${r.changed.map((c) => `\`${c.path}\` ${c.date}`).join("<br/>")} |`
          );
      } else parts.push("None.");
    }
  } else parts.push("Skipped: no INDEX.md.");

  // 4. the promote-time docs gate, as it would run today
  h(`Promote-time docs gate (${GATE_CHECKS.join(", ")})`);
  const gate = runGate({ root });
  if (gate.findings.length) {
    parts.push(
      "These would **block the next prod promote** until fixed (or waived for a rollback):",
      ""
    );
    for (const f of gate.findings)
      parts.push(`- \`${f.check}\` \`${f.file}:${f.line}\` — ${f.message}`);
  } else parts.push("Would pass.");
  // Not added to the total: every gate finding is already counted by the strict docs-check run above.

  const sha = git(root, ["rev-parse", "--short", "HEAD"]) || "unknown";
  const head = [
    `## Documentation audit — ${new Date().toISOString().slice(0, 10)} at \`${sha}\``,
    "",
    `**${findings} finding(s).** Generated by \`.github/scripts/docs_audit.mjs\`; nothing here is typed by hand.`,
  ];
  return { findings, markdown: [...head, ...parts].join("\n") + "\n" };
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = resolve(argv[++i]);
    else if (a === "--out") out = resolve(argv[++i]);
    else {
      console.error(`unknown argument ${a}`);
      return 2;
    }
  }
  const { findings, markdown } = audit(root);
  if (out) writeFileSync(out, markdown);
  else process.stdout.write(markdown);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `findings=${findings}\n`);
  console.error(`docs-audit: ${findings} finding(s)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
