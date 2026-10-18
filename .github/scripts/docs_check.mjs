// BL-271 Phase B: documentation integrity checks (ADR-0020 made verifiable).
// Dependency-free (node:fs / node:path / node:child_process only), Node >= 20.
//
//   node .github/scripts/docs_check.mjs [--root <dir>] [--private] [--json]
//                                       [--level <check>=<fail|warn>]...
//
// Output: one line per finding `level  check  file:line  message`, then
// `docs-check: N fail, M warn`. Exit 1 iff any finding is at level `fail`.
// --private additionally checks the private backlog ledger (run locally from
// the main tree; no-ops with a message where those files are absent).
// The file walker and link parser are exported for the Phase D index generator.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── Check levels: the ONE table. Phase C/D flip entries here. ──────────────
export const LEVELS = {
  links: "fail", // relative link whose target file is missing
  "link-anchors": "warn", // #anchor that no heading slug matches
  "private-marker": "warn", // allowlisted private link lacking "(private)" (Phase C -> fail)
  "adr-index": "fail",
  "spec-tombstones": "fail", // strict: quoted heading <-> archive heading
  "spec-tombstones-loose": "warn", // date-only mentions / unquoted headings
  "history-current": "warn", // Phase D -> fail
  "last-updated": "warn",
  "private-mode": "fail", // only evaluated with --private
};

// Links into the private companion repo (ADR-0020, BL-271): public docs may
// reference these without a dangling-link failure, but should say "(private)".
// Entries ending in "/" are prefixes; entries containing "*" are single-segment globs.
export const PRIVATE_ALLOWLIST = [
  "specification_documents/SWU_Backlog.md",
  "specification_documents/SWU_Backlog_Archive.md",
  "specification_documents/analysis/",
  "specification_documents/planning/",
  "learning_guide/",
  "learning_journal/",
  "docs/decisions/0017-*.md",
  "docs/decisions/agentic-platform-concepts.md",
  "CLAUDE.md",
];

const PUBLIC_DOC_GLOBS = [
  "README.md",
  "HISTORY.md",
  "docs/decisions/*.md",
  "specification_documents/*.md",
  "specification_documents/architecture/*.md",
];

const SPECS = [
  ["specification_documents/SWU_Application_Spec.md", "specification_documents/SWU_Application_Spec_Archive.md"],
  ["specification_documents/SWU_Platform_Spec.md", "specification_documents/SWU_Platform_Spec_Archive.md"],
];

// ── helpers ────────────────────────────────────────────────────────────────
const read = (root, rel) => readFileSync(join(root, rel), "utf-8");
const exists = (root, rel) => existsSync(join(root, rel));
const escRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function isPrivatePath(rel) {
  return PRIVATE_ALLOWLIST.some((pat) => {
    if (pat.includes("*")) return new RegExp("^" + escRe(pat).replace(/\*/g, "[^/]*") + "$").test(rel);
    if (pat.endsWith("/")) return rel.startsWith(pat) || rel + "/" === pat;
    return rel === pat;
  });
}

function globFiles(root, pattern) {
  const slash = pattern.lastIndexOf("/");
  const dir = slash < 0 ? "" : pattern.slice(0, slash);
  const filePat = pattern.slice(slash + 1);
  const abs = join(root, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const re = new RegExp("^" + escRe(filePat).replace(/\*/g, ".*") + "$");
  return readdirSync(abs)
    .filter((f) => re.test(f) && statSync(join(abs, f)).isFile())
    .sort()
    .map((f) => (dir ? `${dir}/${f}` : f));
}

/** The public doc set, repo-relative POSIX paths. */
export function listDocFiles(root) {
  const out = new Set();
  for (const g of PUBLIC_DOC_GLOBS) for (const f of globFiles(root, g)) out.add(f);
  return [...out];
}

/** Blank out fenced code blocks and inline code so links inside them are not parsed. Keeps line numbers. */
function maskCode(text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const m = /^\s*(```+|~~~+)/.exec(line);
      if (m) {
        if (fence === null) fence = m[1][0];
        else if (m[1][0] === fence) fence = null;
        return "";
      }
      if (fence) return "";
      return line.replace(/(`+)[^`]*?\1/g, (s) => " ".repeat(s.length));
    })
    .join("\n");
}

/** Relative Markdown links: [{line, text, target, after}] (http/mailto/etc. excluded). */
export function parseLinks(text) {
  const links = [];
  const re = /\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\s*\)/g;
  maskCode(text)
    .split("\n")
    .forEach((line, i) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const target = m[2].replace(/^<|>$/g, "");
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
        links.push({ line: i + 1, text: m[1], target, after: line.slice(re.lastIndex, re.lastIndex + 40) });
      }
    });
  return links;
}

/** GitHub heading slug. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function headingSlugs(text) {
  const seen = new Map();
  const slugs = new Set();
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    let h = m[1];
    for (let prev = ""; prev !== h; ) {
      prev = h;
      h = h.replace(/<[^<>]*>/g, "");
    }
    const base = slugify(h);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

function splitHash(t) {
  const i = t.indexOf("#");
  return i < 0 ? [t, undefined] : [t.slice(0, i), t.slice(i + 1)];
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ── checks ─────────────────────────────────────────────────────────────────
function checkLinks(ctx) {
  const { root, docs, add } = ctx;
  const slugCache = new Map();
  const slugsFor = (rel) => {
    if (!slugCache.has(rel)) slugCache.set(rel, headingSlugs(read(root, rel)));
    return slugCache.get(rel);
  };
  for (const file of docs) {
    for (const l of parseLinks(read(root, file))) {
      const [pathPart, rawAnchor] = splitHash(l.target);
      const anchor = rawAnchor === undefined ? undefined : safeDecode(rawAnchor);
      const rel = pathPart === "" ? file : posix.normalize(posix.join(posix.dirname(file), safeDecode(pathPart)));
      if (rel.startsWith("../")) {
        add("links", file, l.line, `link escapes the repository: ${l.target}`);
        continue;
      }
      const relNoSlash = rel.replace(/\/$/, "");
      if (isPrivatePath(relNoSlash)) {
        if (!/\(private\)/i.test(l.text) && !/\(private\)/i.test(l.after)) {
          add("private-marker", file, l.line, `link to private-layer path ${relNoSlash} lacks a "(private)" marker`);
        }
        continue;
      }
      if (!exists(root, relNoSlash)) {
        add("links", file, l.line, `broken link: ${l.target} (resolved ${relNoSlash})`);
        continue;
      }
      if (anchor && relNoSlash.endsWith(".md") && statSync(join(root, relNoSlash)).isFile()) {
        if (!slugsFor(relNoSlash).has(anchor.toLowerCase())) {
          add("link-anchors", file, l.line, `anchor #${anchor} not found in ${relNoSlash}`);
        }
      }
    }
  }
}

function adrStatusWord(text) {
  const m = /^##\s+Status\s*\n+\s*([^\n]+)/m.exec(text);
  if (!m) return null;
  const w = /[A-Za-z]+/.exec(m[1].replace(/[*_`]/g, ""));
  return w ? w[0] : null;
}

function checkAdrIndex(ctx) {
  const { root, add } = ctx;
  const idx = "docs/decisions/README.md";
  if (!exists(root, idx)) return;
  const rows = new Map(); // id -> {file, status, line}
  read(root, idx)
    .split("\n")
    .forEach((line, i) => {
      const m = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|.*\|\s*([^|]*?)\s*\|\s*$/.exec(line);
      if (m && m[1] !== "0000") rows.set(m[1], { file: m[2], status: m[3], line: i + 1 });
    });
  const files = globFiles(root, "docs/decisions/*.md")
    .map((f) => posix.basename(f))
    .filter((f) => /^\d{4}-/.test(f) && !f.startsWith("0000-"));
  const byId = new Map(files.map((f) => [f.slice(0, 4), f]));
  for (const [id, f] of byId) {
    if (!rows.has(id)) add("adr-index", `docs/decisions/${f}`, 1, `ADR ${id} has no row in the index`);
  }
  for (const [id, r] of rows) {
    const target = posix.join("docs/decisions", safeDecode(r.file));
    if (!exists(root, target)) {
      if (isPrivatePath(target)) continue; // private ADR: row may exist with no public file
      add("adr-index", idx, r.line, `index row ${id} points at missing file ${r.file}`);
      continue;
    }
    const want = adrStatusWord(read(root, target));
    const have = /[A-Za-z]+/.exec(r.status.replace(/[*_`]/g, ""))?.[0] ?? "";
    if (want && want.toLowerCase() !== have.toLowerCase()) {
      add("adr-index", idx, r.line, `ADR ${id} status mismatch: index "${r.status}" vs file "## Status" ${want}`);
    }
  }
}

/**
 * Spec tombstones <-> archive headings. Formats found by grep (2026-10-18):
 *  - Archive headings (H2): `## Archived YYYY-MM-DD — <title>`, `## Superseded YYYY-MM-DD (<title>)`,
 *    `## Extraction batch YYYY-MM-DD (<title>)`.
 *  - STRICT tombstone: the heading text in double quotes inside the spec, e.g.
 *    `under "Archived 2026-10-12 — round 2: phone gate and landscape (BL-257, F-18)"`.
 *    Must equal an archive heading; every `Archived`/`Superseded` archive heading must be quoted at
 *    least once (fail if its date is not mentioned in the spec at all, warn if only the date is).
 *  - LOOSE tombstone: unquoted `archived|extracted|superseded ... YYYY-MM-DD` or `YYYY-MM-DD batch`;
 *    matched by date against any archive heading (Extraction batches are referenced only this way).
 */
function checkSpecTombstones(ctx) {
  const { root, add } = ctx;
  for (const [spec, archive] of SPECS) {
    if (!exists(root, spec) || !exists(root, archive)) continue;
    const specLines = read(root, spec).split("\n");
    const headings = [];
    read(root, archive)
      .split("\n")
      .forEach((l, i) => {
        const m = /^##\s+(.*?)\s*$/.exec(l);
        if (m) headings.push({ text: m[1], line: i + 1, date: /\d{4}-\d{2}-\d{2}/.exec(m[1])?.[0] });
      });
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const headingSet = new Set(headings.map((h) => norm(h.text)));
    const quotedRefs = new Set();
    const looseDates = new Map(); // date -> first line
    specLines.forEach((line, i) => {
      for (const q of line.matchAll(/"((?:Archived|Superseded|Extraction batch) \d{4}-\d{2}-\d{2}[^"]*)"/g)) {
        const t = norm(q[1]);
        quotedRefs.add(t);
        const truncated = !headingSet.has(t) && headings.find((h) => norm(h.text).startsWith(t));
        if (truncated) {
          quotedRefs.add(norm(truncated.text));
          add("spec-tombstones-loose", spec, i + 1, `tombstone quote is a truncated archive heading (canonical: "${norm(truncated.text)}")`);
        } else if (!headingSet.has(t)) {
          add("spec-tombstones", spec, i + 1, `tombstone quotes an archive heading not found in ${posix.basename(archive)}: "${t}"`);
        }
      }
      if (/\u2014 archive\.\)\*/.test(line)) {
        add("spec-tombstones-loose", spec, i + 1, "bare archive pointer names no heading or file (canonical: *(Archived YYYY-MM-DD \u2014 label: see ..._Archive.md.)*)");
      }
      const unquoted = line.replace(/"[^"]*"/g, "");
      for (const m of unquoted.matchAll(/(?:archived|extracted|superseded)\b[^.\n]{0,15}?(\d{4}-\d{2}-\d{2})|(\d{4}-\d{2}-\d{2}) batch/gi)) {
        const d = m[1] ?? m[2];
        if (!looseDates.has(d)) looseDates.set(d, i + 1);
      }
    });
    for (const [d, line] of looseDates) {
      if (!headings.some((h) => h.date === d)) {
        add("spec-tombstones-loose", spec, line, `tombstone date ${d} matches no archive heading in ${posix.basename(archive)}`);
      }
    }
    const specText = specLines.join("\n");
    for (const h of headings) {
      if (!/^(Archived|Superseded)\b/.test(h.text)) {
        if (h.date && !specText.includes(h.date)) {
          add("spec-tombstones-loose", archive, h.line, `archive batch "${h.text}" is not mentioned by date in ${posix.basename(spec)}`);
        }
        continue;
      }
      if (quotedRefs.has(norm(h.text))) continue;
      const level = h.date && specText.includes(h.date) ? "spec-tombstones-loose" : "spec-tombstones";
      add(level, archive, h.line, `archive heading "${h.text}" is not quoted by any tombstone in ${posix.basename(spec)}`);
    }
  }
}

/** Newest release-kind date in releaseNotes.ts, parsed by regex (the module is pure data). */
export function newestReleaseDate(tsText) {
  let best = null;
  const re = /kind:\s*"release"[\s\S]*?\bdate:\s*"(\d{4}-\d{2}-\d{2})"/g;
  let m;
  while ((m = re.exec(tsText))) if (!best || m[1] > best) best = m[1];
  return best;
}

function checkHistoryCurrent(ctx) {
  const { root, add } = ctx;
  const notes = "frontend/src/content/releaseNotes.ts";
  if (!exists(root, "HISTORY.md") || !exists(root, notes)) return;
  const dates = [...read(root, "HISTORY.md").matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|/gm)].map((m) => m[1]);
  const newestHist = dates.sort().at(-1);
  const newestRel = newestReleaseDate(read(root, notes));
  if (newestHist && newestRel && newestHist < newestRel) {
    add("history-current", "HISTORY.md", 1, `newest Milestones date ${newestHist} is older than the newest release note ${newestRel}`);
  }
}

function checkLastUpdated(ctx) {
  const { root, add } = ctx;
  for (const [spec] of SPECS) {
    if (!exists(root, spec)) continue;
    const lines = read(root, spec).split("\n");
    const idx = lines.findIndex((l) => /\*\*Last updated:\*\*\s*\d{4}-\d{2}-\d{2}/.test(l));
    if (idx < 0) continue;
    const banner = /\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(lines[idx])[1];
    let commit;
    try {
      commit = execFileSync("git", ["log", "-1", "--format=%cs", "--", spec], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return; // version control unavailable (fixtures): skip silently
    }
    if (!commit) continue;
    const days = (Date.parse(commit) - Date.parse(banner)) / 86400000;
    if (days > 14) add("last-updated", spec, idx + 1, `banner says ${banner} but the file last changed ${commit} (${Math.round(days)} days later)`);
  }
}

function checkPrivateMode(ctx) {
  const { root, add, notes } = ctx;
  const active = "specification_documents/SWU_Backlog.md";
  const arch = "specification_documents/SWU_Backlog_Archive.md";
  if (!exists(root, active) || !exists(root, arch)) {
    notes.push("private-mode: backlog files absent in this tree; nothing checked");
    return;
  }
  const tomb = new Map();
  const full = new Map();
  let cur = null;
  read(root, active)
    .split("\n")
    .forEach((l, i) => {
      let m = /^- \*\*BL-(\d+)\b.*✅.*→ \[archive\]\(SWU_Backlog_Archive\.md\)/.exec(l);
      if (m) tomb.set(m[1], i + 1);
      m = /^#{3,4} BL-(\d+):/.exec(l);
      if (m) {
        cur = m[1];
        full.set(cur, i + 1);
      } else if (/^#{1,3}\s/.test(l)) cur = null;
      else if (cur && /^\**Status:?\**:?\s*(✅|⤴️)/.test(l.trim()) || /Status.*✅\s*Resolved/.test(l)) {
        add("private-mode", active, i + 1, `BL-${cur} is a full active entry with a ✅ Resolved status (should be archived + tombstoned)`);
      }
    });
  const archived = new Map();
  read(root, arch)
    .split("\n")
    .forEach((l, i) => {
      const m = /^#{3,4} BL-(\d+):/.exec(l);
      if (m && archived.has(m[1])) add("private-mode", arch, i + 1, `duplicate archive heading for BL-${m[1]} (first at line ${archived.get(m[1])})`);
      else if (m) archived.set(m[1], i + 1);
      if (/^- \*\*BL-\d+/.test(l)) add("private-mode", arch, i + 1, "stray tombstone-style line in the archive");
    });
  for (const [id, line] of tomb) {
    if (!archived.has(id)) add("private-mode", active, line, `tombstone BL-${id} has no "### BL-${id}:" (or ####) heading in the archive`);
  }
  for (const [id, line] of archived) {
    if (!tomb.has(id)) add("private-mode", arch, line, `archived BL-${id} has no tombstone in the active backlog`);
    if (full.has(id)) add("private-mode", active, full.get(id), `BL-${id} appears as a full entry in both the active backlog and the archive`);
  }
}

// ── runner ─────────────────────────────────────────────────────────────────
export function runChecks({ root, privateMode = false, levels = {} } = {}) {
  const table = { ...LEVELS, ...levels };
  const findings = [];
  const notes = [];
  const add = (check, file, line, message) => findings.push({ level: table[check], check, file, line, message });
  // Files in the private allowlist (present only in the main tree) are not public docs.
  const ctx = { root, docs: listDocFiles(root).filter((f) => !isPrivatePath(f)), add, notes };
  checkLinks(ctx);
  checkAdrIndex(ctx);
  checkSpecTombstones(ctx);
  checkHistoryCurrent(ctx);
  checkLastUpdated(ctx);
  if (privateMode) checkPrivateMode(ctx);
  return { findings, notes };
}

export function formatReport({ findings, notes }) {
  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const lines = findings.map((f) => `${f.level.padEnd(4)}  ${f.check}  ${f.file}:${f.line}  ${f.message}`);
  lines.push(...notes);
  lines.push(`docs-check: ${fails} fail, ${warns} warn`);
  return { text: lines.join("\n"), fails, warns };
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let privateMode = false;
  let json = false;
  const levels = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = resolve(argv[++i]);
    else if (a === "--private") privateMode = true;
    else if (a === "--json") json = true;
    else if (a === "--level") {
      const [k, v] = (argv[++i] ?? "").split("=");
      if (!(k in LEVELS) || !["fail", "warn"].includes(v)) {
        console.error(`bad --level ${k}=${v}; checks: ${Object.keys(LEVELS).join(", ")}`);
        return 2;
      }
      levels[k] = v;
    } else {
      console.error(`unknown argument ${a}`);
      return 2;
    }
  }
  const result = runChecks({ root, privateMode, levels });
  const rep = formatReport(result);
  if (json) console.log(JSON.stringify({ fails: rep.fails, warns: rep.warns, findings: result.findings, notes: result.notes }, null, 2));
  else console.log(rep.text);
  return rep.fails > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
