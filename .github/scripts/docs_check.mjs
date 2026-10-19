// BL-271 Phase B: documentation integrity checks (ADR-0020 made verifiable).
// Dependency-free (node:fs / node:path / node:child_process only), Node >= 20.
//
//   node .github/scripts/docs_check.mjs [--root <dir>] [--private] [--json]
//                                       [--level <check>=<fail|warn>]...
//   node .github/scripts/docs_check.mjs --gate [--waive] [--root <dir>]   (promote-time: GATE_CHECKS only)
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
  "private-marker": "fail", // allowlisted private link lacking "(private)" (fail since Phase C, 2026-10-19; verbatim spec archives exempt)
  "adr-index": "fail",
  "spec-tombstones": "fail", // strict: quoted heading <-> archive heading
  "spec-tombstones-loose": "warn", // date-only mentions / unquoted headings
  "history-releases": "fail", // HISTORY.md's generated Releases block differs from releaseNotes.ts (BL-271 Phase E, 2026-10-19; replaced history-current)
  "last-updated": "warn", // fail inside --gate (promote-time)
  "arch-as-of": "warn", // architecture view "as of release vX.Y" is behind the newest release's major.minor; fail inside --gate
  "app-milestone": "warn", // App Spec "App milestone" banner does not name the newest release version; fail inside --gate
  "private-mode": "fail", // only evaluated with --private
  // round 2 (BL-271 Phase B ext)
  "cite-path": "fail", // backticked repo-shaped path that does not exist (fail since Phase C, 2026-10-19; historical citations on CITE_PATH_IGNORE)
  "cite-line": "fail", // `path:line` citation whose file does not exist
  "cite-line-range": "warn", // `path:line` where line > the file's length
  "ci-job-name": "fail", // Platform Spec section 2 names a CI job that no workflow defines (fail since Phase C, 2026-10-19)
  "adr-status-inline": "fail", // inline status word contradicts the ADR's own ## Status
  "number-snapshot": "warn", // bare count with no date / "as of" / backticked command
};

// Promote-time gate (BL-271 Phase E): the release-event checks only, all at fail. Content checks stay CI's job
// on PRs, so an older SHA (a rollback) is never judged by today's content rules. `waive` (the dispatch's
// allow_stale_notes path) demotes them to warn.
export const GATE_CHECKS = ["history-releases", "last-updated", "arch-as-of", "app-milestone"];

// Documented-as-historical citations that cite-path must not flag: scoped to ONE doc each, with the reason
// and the date the entry was added (BL-271 Phase C). A path is ignored only inside its named doc.
export const CITE_PATH_IGNORE = [
  {
    doc: "docs/decisions/0004-catalog-bootstrap-from-swuapi-export.md",
    path: "backend/app/tests/fixtures/swuapi_export_2026-06-21.json",
    reason:
      "ADR text is immutable; the 2026-06-21 fixture was retired from the repo to the private repo-assets bucket (BL-170)",
    date: "2026-10-19",
  },
  {
    doc: "specification_documents/CARD_RULES.md",
    path: "backend/app/tests/test_card_domain_rules.py",
    reason: "frozen document (2026-07-24) cites its own retired test; historical by its banner",
    date: "2026-10-19",
  },
];

// Build outputs / runtime locations that are cited as paths but are never tracked (not defects).
const CITE_RUNTIME_PATHS = [
  "frontend/dist",
  "frontend/coverage",
  "frontend/e2e-results",
  "frontend/node_modules",
  "terraform/state",
  "terraform/.terraform",
];

// Top-level directories a backticked path must start with to count as a repo path citation.
const CITE_ROOTS = [
  "backend",
  "frontend",
  "terraform",
  ".github",
  "docs",
  "specification_documents",
  "scripts",
  "claude_design",
  ".design-sync",
  "tcgcsv_files",
];

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
  // frozen/historical specs, private layer (ADR-0020 Tier 3)
  "specification_documents/SWU_ClaudeCode_Spec.md",
  "specification_documents/SWU_Platform_Roadmap.md",
];

const PUBLIC_DOC_GLOBS = [
  "README.md",
  "HISTORY.md",
  "docs/decisions/*.md",
  "specification_documents/*.md",
  "specification_documents/architecture/*.md",
];

const SPECS = [
  [
    "specification_documents/SWU_Application_Spec.md",
    "specification_documents/SWU_Application_Spec_Archive.md",
  ],
  [
    "specification_documents/SWU_Platform_Spec.md",
    "specification_documents/SWU_Platform_Spec_Archive.md",
  ],
];

// ── helpers ────────────────────────────────────────────────────────────────
const read = (root, rel) => readFileSync(join(root, rel), "utf-8");
const exists = (root, rel) => existsSync(join(root, rel));
const escRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function isPrivatePath(rel) {
  return PRIVATE_ALLOWLIST.some((pat) => {
    if (pat.includes("*"))
      return new RegExp("^" + escRe(pat).replace(/\*/g, "[^/]*") + "$").test(rel);
    if (pat.endsWith("/")) return rel.startsWith(pat) || rel + "/" === pat;
    return rel === pat;
  });
}

const isSpecArchive = (file) => /^specification_documents\/[^/]+_Archive\.md$/.test(file);

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

const globRe = (pattern) => {
  const slash = pattern.lastIndexOf("/");
  const dir = slash < 0 ? "" : pattern.slice(0, slash);
  const filePat = pattern.slice(slash + 1);
  return { dir, re: new RegExp("^" + escRe(filePat).replace(/\*/g, ".*") + "$") };
};

/** Tracked files via git, only when `root` is itself a git toplevel (never for fixtures). null if unavailable. */
function trackedFiles(root, git) {
  try {
    // Empty --show-prefix = root is the repo toplevel (no path/drive-letter-case comparison needed).
    if (git(root, ["rev-parse", "--show-prefix"]) !== "") return null;
    const out = git(root, ["ls-files"]);
    return out ? out.split("\n").filter(Boolean) : null;
  } catch {
    return null;
  }
}

/**
 * The public doc set, repo-relative POSIX paths. Built from `git ls-files` when `root` is a git
 * toplevel (so a local run in the main tree does not scan untracked private specs); otherwise from
 * the static glob list (fixtures, tarball checkouts).
 */
export function listDocFiles(root, git = defaultGit) {
  const tracked = trackedFiles(root, git);
  if (tracked) {
    const pats = PUBLIC_DOC_GLOBS.map(globRe);
    return tracked
      .filter(
        (f) =>
          existsSync(join(root, f)) &&
          pats.some(
            (p) =>
              (posix.dirname(f) === "." ? "" : posix.dirname(f)) === p.dir &&
              p.re.test(posix.basename(f))
          )
      )
      .sort();
  }
  const out = new Set();
  for (const g of PUBLIC_DOC_GLOBS) for (const f of globFiles(root, g)) out.add(f);
  return [...out];
}

/** Inline code spans on one line, CommonMark-style: a run of n backticks closes at the next run of exactly n. */
export function codeSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let j = i;
    while (line[j] === "`") j++;
    const n = j - i;
    let k = j;
    let found = -1;
    while (k < line.length) {
      if (line[k] === "`") {
        let m = k;
        while (line[m] === "`") m++;
        if (m - k === n) {
          found = k;
          break;
        }
        k = m;
      } else k++;
    }
    if (found >= 0) {
      spans.push({ start: i, end: found + n, content: line.slice(j, found) });
      i = found + n;
    } else i = j;
  }
  return spans;
}

/** Lines of `text` as {n, text, fenced}; fence delimiter lines and fenced content have fenced=true. */
export function fencedLines(text) {
  let fence = null;
  return text.split("\n").map((line, i) => {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (m) {
      if (fence === null) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return { n: i + 1, text: line, fenced: true };
    }
    return { n: i + 1, text: line, fenced: fence !== null };
  });
}

/** Blank out fenced code blocks and inline code so links inside them are not parsed. Keeps line numbers. */
function maskCode(text) {
  return fencedLines(text)
    .map((l) => {
      if (l.fenced) return "";
      let out = l.text;
      for (const sp of codeSpans(l.text))
        out = out.slice(0, sp.start) + " ".repeat(sp.end - sp.start) + out.slice(sp.end);
      return out;
    })
    .join("\n");
}

/** Relative Markdown links: [{line, text, target, after}] (http/mailto/etc. excluded). */
export function parseLinks(text) {
  const links = [];
  // Link text may carry one level of balanced brackets (e.g. a heading "[HSV] Updates" in a generated index link).
  const re = /\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\s*\)/g;
  maskCode(text)
    .split("\n")
    .forEach((line, i) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const target = m[2].replace(/^<|>$/g, "");
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
        links.push({
          line: i + 1,
          text: m[1],
          target,
          after: line.slice(re.lastIndex, re.lastIndex + 40),
        });
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
    for (let prev = ""; prev !== h;) {
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
      // Root-relative ("/docs/x.md") resolves from the repo root, not the file's folder.
      const rel =
        pathPart === ""
          ? file
          : pathPart.startsWith("/")
            ? posix.normalize(safeDecode(pathPart).replace(/^\/+/, ""))
            : posix.normalize(posix.join(posix.dirname(file), safeDecode(pathPart)));
      if (rel.startsWith("../")) {
        add("links", file, l.line, `link escapes the repository: ${l.target}`);
        continue;
      }
      const relNoSlash = rel.replace(/\/$/, "");
      if (isPrivatePath(relNoSlash)) {
        // Verbatim spec archives (ADR-0020 Tier 3) cannot carry markers; their links are history.
        if (!isSpecArchive(file) && !/\(private\)/i.test(l.text) && !/\(private\)/i.test(l.after)) {
          add(
            "private-marker",
            file,
            l.line,
            `link to private-layer path ${relNoSlash} lacks a "(private)" marker`
          );
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
      const m = /^\|\s*\[(\d{4})\]\(([^)]+)\)(?:\s*\(private\))?\s*\|.*\|\s*([^|]*?)\s*\|\s*$/.exec(
        line
      ); // "(private)" after the link marks a private ADR (BL-271 C)
      if (m && m[1] !== "0000") rows.set(m[1], { file: m[2], status: m[3], line: i + 1 });
    });
  const files = globFiles(root, "docs/decisions/*.md")
    .map((f) => posix.basename(f))
    .filter((f) => /^\d{4}-/.test(f) && !f.startsWith("0000-"));
  const byId = new Map(files.map((f) => [f.slice(0, 4), f]));
  for (const [id, f] of byId) {
    if (!rows.has(id))
      add("adr-index", `docs/decisions/${f}`, 1, `ADR ${id} has no row in the index`);
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
      add(
        "adr-index",
        idx,
        r.line,
        `ADR ${id} status mismatch: index "${r.status}" vs file "## Status" ${want}`
      );
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
        if (m)
          headings.push({ text: m[1], line: i + 1, date: /\d{4}-\d{2}-\d{2}/.exec(m[1])?.[0] });
      });
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const headingSet = new Set(headings.map((h) => norm(h.text)));
    const quotedRefs = new Set();
    const looseDates = new Map(); // date -> first line
    specLines.forEach((line, i) => {
      for (const q of line.matchAll(
        /"((?:Archived|Superseded|Extraction batch) \d{4}-\d{2}-\d{2}[^"]*)"/g
      )) {
        const t = norm(q[1]);
        quotedRefs.add(t);
        const truncated = !headingSet.has(t) && headings.find((h) => norm(h.text).startsWith(t));
        if (truncated) {
          quotedRefs.add(norm(truncated.text));
          add(
            "spec-tombstones-loose",
            spec,
            i + 1,
            `tombstone quote is a truncated archive heading (canonical: "${norm(truncated.text)}")`
          );
        } else if (!headingSet.has(t)) {
          add(
            "spec-tombstones",
            spec,
            i + 1,
            `tombstone quotes an archive heading not found in ${posix.basename(archive)}: "${t}"`
          );
        }
      }
      if (/\u2014 archive\.\)\*/.test(line)) {
        add(
          "spec-tombstones-loose",
          spec,
          i + 1,
          "bare archive pointer names no heading or file (canonical: *(Archived YYYY-MM-DD \u2014 label: see ..._Archive.md.)*)"
        );
      }
      const unquoted = line.replace(/"[^"]*"/g, "");
      for (const m of unquoted.matchAll(
        /(?:archived|extracted|superseded)\b[^.\n]{0,15}?(\d{4}-\d{2}-\d{2})|(\d{4}-\d{2}-\d{2}) batch/gi
      )) {
        const d = m[1] ?? m[2];
        if (!looseDates.has(d)) looseDates.set(d, i + 1);
      }
    });
    for (const [d, line] of looseDates) {
      if (!headings.some((h) => h.date === d)) {
        add(
          "spec-tombstones-loose",
          spec,
          line,
          `tombstone date ${d} matches no archive heading in ${posix.basename(archive)}`
        );
      }
    }
    const specText = specLines.join("\n");
    for (const h of headings) {
      if (!/^(Archived|Superseded)\b/.test(h.text)) {
        if (h.date && !specText.includes(h.date)) {
          add(
            "spec-tombstones-loose",
            archive,
            h.line,
            `archive batch "${h.text}" is not mentioned by date in ${posix.basename(spec)}`
          );
        }
        continue;
      }
      if (quotedRefs.has(norm(h.text))) continue;
      const level =
        h.date && specText.includes(h.date) ? "spec-tombstones-loose" : "spec-tombstones";
      add(
        level,
        archive,
        h.line,
        `archive heading "${h.text}" is not quoted by any tombstone in ${posix.basename(spec)}`
      );
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

// ── HISTORY.md generated Releases block (BL-271 Phase E) ───────────────────
export const RELEASE_NOTES_PATH = "frontend/src/content/releaseNotes.ts";
export const HISTORY_BLOCK_START =
  "<!-- generated:releases start — from frontend/src/content/releaseNotes.ts by `node .github/scripts/docs_history.mjs --write`; do not hand-edit -->";
export const HISTORY_BLOCK_END = "<!-- generated:releases end -->";

/**
 * Release entries from releaseNotes.ts by regex (the module is pure data: string literals only):
 * [{kind, key, version, date, title}], newest first as in the file. Announcements are returned with kind
 * "announcement" and no version. Fields are read in any order up to the next `kind:`.
 */
export function parseReleaseEntries(tsText) {
  // Whole-line `//` comments and block comments are stripped; a `//` inside a string (a URL in a title)
  // is left alone. Shape contract (the module is hand-written data): `kind` leads each entry and the
  // entry's own `title` precedes its nested `sections[].title`s — both guarded below, so a reordered
  // entry throws instead of silently vanishing or borrowing a neighbour's fields.
  const text = tsText.replace(/^\s*\/\/[^\n]*/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  // An entry's `kind` is followed by a comma; the TypeScript union type's `kind: "release";` is not.
  const kinds = [...text.matchAll(/\bkind:\s*"(release|announcement)"\s*,/g)];
  kinds.forEach((m, i) => {
    const chunk = text.slice(m.index, i + 1 < kinds.length ? kinds[i + 1].index : undefined);
    const field = (name) =>
      new RegExp(`\\b${name}:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
        .exec(chunk)?.[1]
        ?.replace(/\\(.)/g, "$1");
    const sectionsAt = chunk.search(/\bsections:/);
    const titleAt = chunk.search(/\btitle:/);
    if (sectionsAt >= 0 && titleAt > sectionsAt) {
      throw new Error(
        `releaseNotes.ts: entry ${i + 1} (kind ${m[1]}) has its title after \`sections:\` — move the entry's title above its sections`
      );
    }
    const e = { kind: m[1], key: field("key"), date: field("date"), title: field("title") };
    if (e.kind === "release") e.version = field("version") ?? e.key;
    if (!e.key || !e.date || !e.title) {
      throw new Error(
        `releaseNotes.ts: entry ${i + 1} (kind ${m[1]}) is missing key/date/title after its \`kind:\` — \`kind\` must lead each entry`
      );
    }
    out.push(e);
  });
  return out;
}

/** Markdown table cell text: backslashes first, then pipes (CodeQL js/incomplete-sanitization otherwise). */
export const cellEscape = (s) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

/** The Releases table (releases only, newest first, as the notes module orders them). */
export function renderReleasesBlock(entries) {
  const rows = entries
    .filter((e) => e.kind === "release")
    .map((e) => `| ${e.date} | v${e.version} | ${cellEscape(e.title)} |`);
  return [
    HISTORY_BLOCK_START,
    "",
    "| Date | Version | Release |",
    "|---|---|---|",
    ...rows,
    "",
    HISTORY_BLOCK_END,
  ].join("\n");
}

/** Replace (or report) the generated block inside HISTORY text. Returns {text, had} ; `had` false when no markers. */
export function spliceReleasesBlock(historyText, block) {
  const lf = historyText.replace(/\r\n/g, "\n");
  const s = lf.indexOf(HISTORY_BLOCK_START);
  const e = lf.indexOf(HISTORY_BLOCK_END);
  if (s < 0 || e < s) return { text: lf, had: false, current: null };
  const current = lf.slice(s, e + HISTORY_BLOCK_END.length);
  return {
    text: lf.slice(0, s) + block + lf.slice(e + HISTORY_BLOCK_END.length),
    had: true,
    current,
  };
}

function checkHistoryReleases(ctx) {
  const { root, add } = ctx;
  if (!exists(root, "HISTORY.md") || !exists(root, RELEASE_NOTES_PATH)) return;
  const fresh = renderReleasesBlock(parseReleaseEntries(read(root, RELEASE_NOTES_PATH)));
  const { had, current } = spliceReleasesBlock(read(root, "HISTORY.md"), fresh);
  const cmd = "node .github/scripts/docs_history.mjs --write";
  if (!had) {
    add(
      "history-releases",
      "HISTORY.md",
      1,
      `no generated Releases block (markers missing) — run: ${cmd}`
    );
    return;
  }
  if (current !== fresh) {
    const line = read(root, "HISTORY.md")
      .replace(/\r\n/g, "\n")
      .slice(0, read(root, "HISTORY.md").replace(/\r\n/g, "\n").indexOf(HISTORY_BLOCK_START))
      .split("\n").length;
    add(
      "history-releases",
      "HISTORY.md",
      line,
      `generated Releases block differs from releaseNotes.ts — run: ${cmd}`
    );
  }
}

/** "major.minor" of a version string, or null. */
export const minorOf = (v) =>
  /^v?(\d+)\.(\d+)/
    .exec(v ?? "")
    ?.slice(1, 3)
    .map(Number) ?? null;
const minorLt = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Newest release entry (kind "release") from releaseNotes.ts, or null. */
function newestRelease(root) {
  if (!exists(root, RELEASE_NOTES_PATH)) return null;
  return (
    parseReleaseEntries(read(root, RELEASE_NOTES_PATH)).find((e) => e.kind === "release") ?? null
  );
}

// Each architecture view carries "as of release vX.Y[.Z]"; a view is current when its major.minor is at least
// the newest release's major.minor (patch releases need no redraw; minor releases are the review trigger).
function checkArchAsOf(ctx) {
  const { root, add } = ctx;
  const rel = newestRelease(root);
  if (!rel) return;
  const want = minorOf(rel.version);
  if (!want) return;
  for (const file of globFiles(root, "specification_documents/architecture/*.md")) {
    const lines = read(root, file).split("\n");
    const idx = lines.findIndex((l) => /as of release v\d+\.\d+/.test(l));
    if (idx < 0) {
      add("arch-as-of", file, 1, 'no "as of release vX.Y" banner');
      continue;
    }
    const haveStr = /as of release (v\d+\.\d+(?:\.\d+)?)/.exec(lines[idx])[1];
    if (minorLt(minorOf(haveStr), want))
      add(
        "arch-as-of",
        file,
        idx + 1,
        `view is as of release ${haveStr} but the newest release note is v${rel.version} (a new minor) — review the view and update its banner`
      );
  }
}

// The App Spec's "App milestone" banner must name the newest release (the Phase A class: six releases missing).
function checkAppMilestone(ctx) {
  const { root, add } = ctx;
  const rel = newestRelease(root);
  const spec = SPECS[0][0];
  if (!rel || !exists(root, spec)) return;
  const lines = read(root, spec).split("\n");
  const idx = lines.findIndex((l) => /\*\*App milestone:\*\*/.test(l));
  if (idx < 0) return;
  if (!new RegExp(`\\bv${escRe(rel.version)}(?![.\\d])`).test(lines[idx])) {
    add(
      "app-milestone",
      spec,
      idx + 1,
      `"App milestone" banner does not name v${rel.version} (the newest release note, ${rel.date})`
    );
  }
}

const defaultGit = (root, args) =>
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();

/** Days the file's last commit is after the banner date. */
export function daysLate(banner, commit) {
  return (Date.parse(commit) - Date.parse(banner)) / 86400000;
}

function checkLastUpdated(ctx) {
  const { root, add, notes, git } = ctx;
  // A shallow checkout (CI) makes `git log -1` return the tip commit for every file,
  // so the comparison is meaningless there; so is a tree without git (fixtures).
  try {
    if (git(root, ["rev-parse", "--is-shallow-repository"]) !== "false") throw new Error("shallow");
  } catch {
    notes.push("last-updated: skipped (shallow checkout)");
    return;
  }
  for (const [spec] of SPECS) {
    if (!exists(root, spec)) continue;
    const lines = read(root, spec).split("\n");
    const idx = lines.findIndex((l) => /\*\*Last updated:\*\*\s*\d{4}-\d{2}-\d{2}/.test(l));
    if (idx < 0) continue;
    const banner = /\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(lines[idx])[1];
    let commit;
    try {
      commit = git(root, ["log", "-1", "--format=%cs", "--", spec]);
    } catch {
      continue; // no history for this file: skip it
    }
    if (!commit) continue;
    const days = daysLate(banner, commit);
    if (days > 14)
      add(
        "last-updated",
        spec,
        idx + 1,
        `banner says ${banner} but the file last changed ${commit} (${Math.round(days)} days later)`
      );
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
      // A tombstone is a one-line `- **BL-n — …** … → [archive](…)` or, since Phase C (ADR-0020 amendment
      // 2026-10-18), a row of the tombstone-index table: `| BL-n | … | [archive](SWU_Backlog_Archive.md) |`.
      let m =
        /^- \*\*BL-(\d+)\b.*→ \[archive\]\(SWU_Backlog_Archive\.md\)/.exec(l) ||
        /^\| \**BL-(\d+)\**\s*\|.*\[archive\]\(SWU_Backlog_Archive\.md\)/.exec(l);
      if (m) tomb.set(m[1], i + 1);
      m = /^#{3,4} BL-(\d+):/.exec(l);
      if (m) {
        cur = m[1];
        full.set(cur, i + 1);
      } else if (/^#{1,3}\s/.test(l)) cur = null;
      else if (
        cur &&
        (/^\**Status:?\**:?\s*(✅|⤴️)/.test(l.trim()) || /Status.*✅\s*Resolved/.test(l))
      ) {
        add(
          "private-mode",
          active,
          i + 1,
          `BL-${cur} is a full active entry with a ✅ Resolved status (should be archived + tombstoned)`
        );
      }
    });
  const archived = new Map();
  read(root, arch)
    .split("\n")
    .forEach((l, i) => {
      const m = /^#{3,4} BL-(\d+):/.exec(l);
      if (m && archived.has(m[1]))
        add(
          "private-mode",
          arch,
          i + 1,
          `duplicate archive heading for BL-${m[1]} (first at line ${archived.get(m[1])})`
        );
      else if (m) archived.set(m[1], i + 1);
      if (/^- \*\*BL-\d+/.test(l))
        add("private-mode", arch, i + 1, "stray tombstone-style line in the archive");
    });
  for (const [id, line] of tomb) {
    if (!archived.has(id))
      add(
        "private-mode",
        active,
        line,
        `tombstone BL-${id} has no "### BL-${id}:" (or ####) heading in the archive`
      );
  }
  for (const [id, line] of archived) {
    if (!tomb.has(id))
      add("private-mode", arch, line, `archived BL-${id} has no tombstone in the active backlog`);
    if (full.has(id))
      add(
        "private-mode",
        active,
        full.get(id),
        `BL-${id} appears as a full entry in both the active backlog and the archive`
      );
  }
}

// ── round 2 checks (BL-271 Phase B ext) ────────────────────────────────────
const ignoredCite = (file, p) =>
  CITE_PATH_IGNORE.some((e) => e.doc === file && e.path === p) ||
  CITE_RUNTIME_PATHS.some((i) =>
    i.endsWith("/") ? p.startsWith(i) : p === i || p.startsWith(i + "/")
  );

/** True when `rel` exists, or (extensionless citation) a sibling file `rel.<ext>` does, e.g. `.../MobileApp` -> MobileApp.tsx. */
function citedExists(root, rel) {
  if (exists(root, rel)) return true;
  if (/\.[A-Za-z0-9]+$/.test(posix.basename(rel))) return false;
  const abs = join(root, posix.dirname(rel));
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return false;
  const sibling = new RegExp("^" + escRe(posix.basename(rel)) + "\\.[A-Za-z0-9]+$");
  return readdirSync(abs).some((f) => sibling.test(f));
}

/**
 * Backticked repo-shaped citations in a doc: [{line, path, lines?}] where `path` starts with a known
 * repo root and `lines` (when the token is `path:12` / `path:12-30` / `path:12,14`) is the largest line number.
 * Globs, placeholders, ellipses and URLs are skipped.
 */
export function parseCitations(text, root) {
  const out = [];
  for (const l of fencedLines(text)) {
    if (l.fenced) continue;
    for (const sp of codeSpans(l.text)) {
      const tok = sp.content.trim();
      const m = /^([A-Za-z0-9_.][\w.@-]*(?:\/[\w.@-]+)+\/?)(?::(\d+(?:[-,]\d+)*))?$/.exec(tok);
      if (!m) continue;
      const lines = m[2] ? Math.max(...m[2].split(/[-,]/).map(Number)) : undefined;
      let path = m[1].replace(/\/$/, "");
      if (!CITE_ROOTS.includes(path.split("/")[0])) {
        // Repo-relative citation (`app/auth.py`, `src/firebase.ts`): resolved against the known bases when
        // `root` is given, so cite-path and the index see it (BL-271 Phase E; reviewer finding on PR #279).
        // An unresolvable token stays ignored: it is indistinguishable from a non-path code span.
        if (!root || !/\.[A-Za-z0-9]+$/.test(path)) continue;
        const base = RELATIVE_BASES.find((b) => exists(root, posix.join(b, path)));
        if (!base) continue;
        out.push({ line: l.n, path: posix.join(base, path), lines, relative: path });
        continue;
      }
      out.push({ line: l.n, path, lines });
    }
  }
  return out;
}

/** Bases a repo-relative citation is tried against, in order (first hit wins). */
export const RELATIVE_BASES = ["backend", "frontend", "frontend/src"];

const fileLineCount = (root, rel) => {
  const t = read(root, rel);
  return t.endsWith("\n") ? t.split("\n").length - 1 : t.split("\n").length;
};

// NOTE: cite-path / cite-line check the filesystem, not the git index: an untracked local file
// passes a local run but fails in CI. CI (a clean checkout) is the authority.
function checkCitations(ctx) {
  const { root, docs, add, notes } = ctx;
  notes.push(`cite-path: CITE_PATH_IGNORE has ${CITE_PATH_IGNORE.length} entries`);
  for (const file of docs) {
    for (const c of parseCitations(read(root, file), root)) {
      if (isPrivatePath(c.path) || ignoredCite(file, c.path)) continue;
      if (!citedExists(root, c.path)) {
        add(
          c.lines === undefined ? "cite-path" : "cite-line",
          file,
          c.line,
          `cited path does not exist: ${c.path}${c.lines === undefined ? "" : ":" + c.lines}`
        );
        continue;
      }
      if (c.lines !== undefined && statSync(join(root, c.path)).isFile()) {
        const len = fileLineCount(root, c.path);
        if (c.lines > len)
          add(
            "cite-line-range",
            file,
            c.line,
            `cited line ${c.lines} is beyond the end of ${c.path} (${len} lines)`
          );
      }
    }
  }
}

/** Job ids (and display names) defined in the repo's workflow files. */
export function workflowJobNames(root) {
  const names = new Set();
  for (const f of globFiles(root, ".github/workflows/*.yml")) {
    let inJobs = false;
    for (const line of read(root, f).split("\n")) {
      if (/^jobs:\s*$/.test(line)) inJobs = true;
      else if (/^\S/.test(line)) inJobs = false;
      else if (inJobs) {
        let m = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
        if (m) names.add(m[1]);
        m = /^ {4}name:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/.exec(line);
        if (m) names.add(m[1]);
      }
    }
  }
  return names;
}

/** Job-name-shaped tokens a Platform Spec section 2 line asserts: diagram nodes in a fence, and backticked "X job" / "job X" tokens. */
export function jobMentions(lines) {
  const out = [];
  const shape = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  for (const l of lines) {
    if (l.fenced) {
      // diagram: a token counts when it touches a flow glyph or opens/precedes a dash-annotation
      for (const m of l.text.matchAll(/(?<![\w-])([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?![\w-])/g)) {
        const before = l.text.slice(0, m.index).trimEnd();
        const after = l.text.slice(m.index + m[0].length).trimStart();
        // box-drawing / arrows on either side; an em dash only AFTER the token ("name - annotation")
        const flow = /[─-╿►▼▲→]/;
        const prevGlyph = before.length > 0 && flow.test(before.at(-1));
        const nextGlyph = after.length > 0 && (flow.test(after[0]) || after[0] === "—");
        const bracket = before.endsWith("[") || before.endsWith("/") || after.startsWith("/");
        if (
          prevGlyph ||
          nextGlyph ||
          bracket ||
          (before === "" && after !== "" && /^[─-╿►▼▲—→(]/.test(after))
        )
          out.push({ line: l.n, name: m[1] });
      }
      continue;
    }
    for (const sp of codeSpans(l.text)) {
      if (!shape.test(sp.content)) continue;
      const before = l.text.slice(0, sp.start);
      const after = l.text.slice(sp.end);
      if (
        /\bjobs?\s*(?:named\s*)?$/i.test(before) ||
        /^\s*(?:[,/+&]\s*`[^`]+`\s*)*(?:and\s+`[^`]+`\s*)?(?:\(\w+\)\s*)?\bjobs?\b/i.test(after)
      )
        out.push({ line: l.n, name: sp.content });
    }
  }
  return out;
}

function checkCiJobNames(ctx) {
  const { root, add } = ctx;
  const spec = "specification_documents/SWU_Platform_Spec.md";
  if (!exists(root, spec)) return;
  const jobs = workflowJobNames(root);
  if (jobs.size === 0) return;
  const all = fencedLines(read(root, spec));
  const start = all.findIndex((l) => !l.fenced && /^##\s+2[.\s]/.test(l.text));
  if (start < 0) return;
  let end = all.findIndex((l, i) => i > start && !l.fenced && /^##\s+(?!#)/.test(l.text));
  if (end < 0) end = all.length;
  const seen = new Set();
  for (const m of jobMentions(all.slice(start, end))) {
    if (jobs.has(m.name) || seen.has(m.name)) continue;
    seen.add(m.name);
    add(
      "ci-job-name",
      spec,
      m.line,
      `section 2 names job "${m.name}" which no workflow in .github/workflows defines`
    );
  }
}

const ADR_STATUS_WORDS = ["Proposed", "Accepted", "Superseded", "Deprecated"];

/** Status words within 60 chars of an ADR mention, nearest mention wins: [{line, adr, word}]. */
export function inlineAdrStatuses(text) {
  const out = [];
  let inStatusSection = false;
  for (const l of fencedLines(text)) {
    if (l.fenced) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(l.text);
    if (h) inStatusSection = /^Status\b/i.test(h[1]);
    if (inStatusSection) continue;
    const mentions = [];
    for (const m of l.text.matchAll(/ADR[- ]?(\d{4})\b/g))
      mentions.push({ id: m[1], start: m.index, end: m.index + m[0].length });
    for (const m of l.text.matchAll(/\]\(([^)\s]*\/)?(\d{4})-[^)\s]*\.md[^)]*\)/g))
      mentions.push({ id: m[2], start: m.index, end: m.index + m[0].length });
    if (mentions.length === 0) continue;
    // sentence segmentation: a mention only qualifies a status word in the same sentence
    const cuts = [...l.text.matchAll(/[.!?]\s+(?=[A-Z*(`\[])/g)].map((m) => m.index + 1);
    const sent = (pos) => cuts.filter((c) => c <= pos).length;
    for (const w of l.text.matchAll(new RegExp(`\\b(${ADR_STATUS_WORDS.join("|")})\\b`, "g"))) {
      const wEnd = w.index + w[0].length;
      const tail = l.text.slice(wEnd);
      const head = l.text.slice(0, w.index);
      // Words that describe something else entirely ("Accepted risk", "Superseded text"): skip.
      if (
        /^\s*\(?(in favou?r of|risk|trade-?off|deviation|text|sentence|wording|section|paragraph)\b/i.test(
          tail
        ) ||
        /(supersed(?:es|ed)|replac(?:es|ed))\s+(by\s+)?$/i.test(head)
      )
        continue;
      // "ADR-X (Superseded by ADR-Y)" / "ADR-X: Superseded (2026-10-08, ... ADR-Y)": the claim is about the
      // ADR mentioned BEFORE the word; a mention that only sits in the "by"/parenthetical is not the subject.
      const subjectOnly = /^\s*\(?by\b/i.test(tail) || /^\s*\(\s*\d{4}-\d\d-\d\d/.test(tail);
      let best = null;
      for (const men of mentions) {
        if (subjectOnly && men.end > w.index) continue;
        const dist =
          men.start >= wEnd ? men.start - wEnd : w.index >= men.end ? w.index - men.end : 0;
        if (dist <= 60 && sent(men.start) === sent(w.index) && (!best || dist < best.dist))
          best = { id: men.id, dist };
      }
      if (best) out.push({ line: l.n, adr: best.id, word: w[0] });
    }
  }
  return out;
}

function checkAdrStatusInline(ctx) {
  const { root, docs, add } = ctx;
  const statusOf = new Map();
  for (const f of globFiles(root, "docs/decisions/*.md")) {
    const id = /^(\d{4})-/.exec(posix.basename(f))?.[1];
    if (id) statusOf.set(id, adrStatusWord(read(root, f)));
  }
  for (const file of docs) {
    if (/_Archive\.md$/.test(file)) continue; // Tier 3 history legitimately describes past states
    for (const s of inlineAdrStatuses(read(root, file))) {
      const want = statusOf.get(s.adr);
      if (want && want.toLowerCase() !== s.word.toLowerCase()) {
        add(
          "adr-status-inline",
          file,
          s.line,
          `says ADR-${s.adr} is ${s.word} but its "## Status" is ${want}`
        );
      }
    }
  }
}

const COUNT_RE =
  /\b\d{1,3}(?:,\d{3})*\s+(?:files|bytes|routes|occurrences|variants|objects|alert policies)\b/;

/** Sentences carrying a bare count with no date, "as of", or backticked command: [{line, sentence}]. */
export function undatedCounts(text) {
  const out = [];
  for (const l of fencedLines(text)) {
    if (l.fenced) continue;
    for (const sentence of l.text.split(/(?<=[.!?])\s+(?=[A-Z*(`|\[])/)) {
      const bare = sentence.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
      if (!COUNT_RE.test(bare)) continue;
      const hasDate = /\b20\d\d-\d\d-\d\d\b/.test(sentence) || /\bas of\b/i.test(sentence);
      const hasCommand = codeSpans(sentence).some((sp) => /\s/.test(sp.content.trim()));
      if (!hasDate && !hasCommand) out.push({ line: l.n, sentence: bare.trim() });
    }
  }
  return out;
}

function checkNumberSnapshots(ctx) {
  const { root, docs, add } = ctx;
  for (const file of docs) {
    // Archives (Tier 3) and ADRs (Tier 2, dated by their own Status line) are snapshots by nature.
    if (/_Archive\.md$/.test(file) || file.startsWith("docs/decisions/")) continue;
    for (const u of undatedCounts(read(root, file))) {
      add(
        "number-snapshot",
        file,
        u.line,
        `count with no date / "as of" / command: ${u.sentence.slice(0, 90)}${u.sentence.length > 90 ? "…" : ""}`
      );
    }
  }
}

// ── runner ─────────────────────────────────────────────────────────────────
export function runChecks({ root, privateMode = false, levels = {}, git = defaultGit } = {}) {
  const table = { ...LEVELS, ...levels };
  const findings = [];
  const notes = [];
  const add = (check, file, line, message) =>
    findings.push({ level: table[check], check, file, line, message });
  // Files in the private allowlist (present only in the main tree) are not public docs.
  const ctx = {
    root,
    docs: listDocFiles(root, git).filter((f) => !isPrivatePath(f)),
    add,
    notes,
    git,
  };
  checkLinks(ctx);
  checkAdrIndex(ctx);
  checkSpecTombstones(ctx);
  checkHistoryReleases(ctx);
  checkLastUpdated(ctx);
  checkArchAsOf(ctx);
  checkAppMilestone(ctx);
  checkCitations(ctx);
  checkCiJobNames(ctx);
  checkAdrStatusInline(ctx);
  checkNumberSnapshots(ctx);
  if (privateMode) checkPrivateMode(ctx);
  return { findings, notes };
}

/**
 * Promote-time docs gate (BL-271 Phase E): only GATE_CHECKS, each at fail (or warn when `waive`). Run by
 * promote-prod.yml from main's copy of this script against the promoted SHA's checkout, so a rollback to an
 * older tree is judged by today's gate logic but never by today's content rules.
 */
export function runGate({ root, waive = false, git = defaultGit } = {}) {
  const level = waive ? "warn" : "fail";
  const findings = [];
  const notes = [
    waive
      ? "docs-gate: date/currency checks waived (allow_stale_notes — rollback / re-promote path)"
      : `docs-gate: ${GATE_CHECKS.join(", ")} at fail`,
  ];
  const add = (check, file, line, message) => {
    if (GATE_CHECKS.includes(check)) findings.push({ level, check, file, line, message });
  };
  const ctx = { root, docs: [], add, notes, git };
  checkHistoryReleases(ctx);
  checkLastUpdated(ctx);
  checkArchAsOf(ctx);
  checkAppMilestone(ctx);
  return { findings, notes };
}

export function formatReport({ findings, notes }) {
  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  const lines = findings.map(
    (f) => `${f.level.padEnd(4)}  ${f.check}  ${f.file}:${f.line}  ${f.message}`
  );
  lines.push(...notes);
  lines.push(`docs-check: ${fails} fail, ${warns} warn`);
  return { text: lines.join("\n"), fails, warns };
}

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let privateMode = false;
  let json = false;
  let gate = false;
  let waive = false;
  const levels = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = resolve(argv[++i]);
    else if (a === "--private") privateMode = true;
    else if (a === "--json") json = true;
    else if (a === "--gate") gate = true;
    else if (a === "--waive") waive = true;
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
  const result = gate ? runGate({ root, waive }) : runChecks({ root, privateMode, levels });
  const rep = formatReport(result);
  if (json)
    console.log(
      JSON.stringify(
        { fails: rep.fails, warns: rep.warns, findings: result.findings, notes: result.notes },
        null,
        2
      )
    );
  else console.log(rep.text);
  return rep.fails > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
