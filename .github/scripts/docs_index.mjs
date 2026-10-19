// BL-271 Phase D: generated section-level retrieval index for the three public specs.
// Dependency-free (node:fs / node:path / node:child_process only), Node >= 20.
//
//   node .github/scripts/docs_index.mjs [--write | --check] [--root <dir>]
//
// specification_documents/INDEX.md lists every `##` / `###` section of the Application, Platform and
// Variant Mapping specs with its line, LF byte size, dated banner, ADRs, cited code paths and quoted
// archive headings. Everything is derived from the spec text -- nothing is typed by hand.
//   --write  regenerates INDEX.md.
//   --check  (default) regenerates in memory; exit 1 if the committed body differs. Line 1 (the
//            informational "generated <date> from <sha>" header) is excluded from the comparison, so
//            a fresh commit never makes the index stale. Both sides are compared with CRLF -> LF.
// Exit 2 on bad arguments. Parsers come from docs_check.mjs (not modified).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fencedLines, slugify, parseCitations, CITE_PATH_IGNORE } from "./docs_check.mjs";

export const SPEC_FILES = [
  "SWU_Application_Spec.md",
  "SWU_Platform_Spec.md",
  "SWU_Standard_Variant_Mapping_Spec.md",
];
const DIR = "specification_documents";
export const INDEX_PATH = `${DIR}/INDEX.md`;
const REGEN = "node .github/scripts/docs_index.mjs --write";

const lf = (s) => s.replace(/\r\n/g, "\n");
const fmt = (n) => n.toLocaleString("en-US");
const cell = (s) => s.replace(/\|/g, "\\|");
const ISO = /\d{4}-\d{2}-\d{2}/;

/** Parse one spec's text into rows: [{level, heading, line, bytes, banner, adrs, paths, quotes}]. */
export function parseSpec(rawText, docPath) {
  const text = lf(rawText);
  const lines = fencedLines(text);
  const lineBytes = lines.map((l, i) => Buffer.byteLength(l.text) + (i < lines.length - 1 ? 1 : 0));
  const heads = [];
  for (const l of lines) {
    if (l.fenced) continue;
    const m = /^(##|###)\s+(.*?)\s*#*\s*$/.exec(l.text);
    if (m) heads.push({ level: m[1].length, heading: m[2], idx: l.n - 1 });
  }
  const sum = (a, b) => lineBytes.slice(a, b).reduce((x, y) => x + y, 0);
  const rows = [];
  const firstIdx = heads.length ? heads[0].idx : lines.length;
  rows.push({
    level: 0,
    heading: "(preamble: title and front matter)",
    line: 1,
    bytes: sum(0, firstIdx),
    own: lines.slice(0, firstIdx),
  });
  heads.forEach((h, i) => {
    const nextAny = i + 1 < heads.length ? heads[i + 1].idx : lines.length;
    let end = nextAny;
    if (h.level === 2) {
      end = lines.length;
      for (let j = i + 1; j < heads.length; j++)
        if (heads[j].level === 2) {
          end = heads[j].idx;
          break;
        }
    }
    rows.push({
      level: h.level,
      heading: h.heading,
      line: h.idx + 1,
      bytes: sum(h.idx, end),
      own: lines.slice(h.idx, nextAny),
    });
  });
  return rows.map((r) => ({ ...r, ...derive(r.own, docPath) }));
}

function derive(ownLines, docPath) {
  const body = ownLines.filter((l) => !l.fenced);
  const ownText = ownLines.map((l) => l.text).join("\n");
  return {
    banner: banner(body),
    adrs: adrs(ownText),
    paths: codePaths(ownText, docPath),
    quotes: quotes(body.map((l) => l.text).join("\n")),
  };
}

/** First line carrying a `**Last updated:** DATE` or a bold lead containing an ISO date: "DATE label". */
export function banner(bodyLines) {
  for (const l of bodyLines) {
    const lu = /^\s*>?\s*\*\*Last updated:?\*\*:?\s*(\d{4}-\d{2}-\d{2})/i.exec(l.text);
    if (lu) return `${lu[1]} Last updated`;
    const b = /^\s*>?\s*\*\*([^*]+)\*\*/.exec(l.text);
    if (!b) continue;
    const d = ISO.exec(b[1]);
    if (!d) continue;
    const label = b[1]
      .replace(/\([^)]*\d{4}-\d{2}-\d{2}[^)]*\)/, "")
      .replace(/\d{4}-\d{2}-\d{2}/, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s:.,—-]+|[\s:.,—-]+$/g, "")
      .slice(0, 40)
      .trim();
    return label ? `${d[0]} ${label}` : d[0];
  }
  return "";
}

export function adrs(text) {
  const set = new Set();
  for (const m of text.matchAll(/ADR-(0\d{3})\b/g)) set.add(m[1]);
  for (const m of text.matchAll(/docs\/decisions\/(0\d{3})-/g)) set.add(m[1]);
  return [...set].sort();
}

// Repo root for resolving repo-relative citations (`app/auth.py` -> `backend/app/auth.py`, BL-271 Phase E);
// null (unit tests on bare text) keeps the Phase D behaviour of rooted paths only.
let CITE_ROOT = null;

export function codePaths(text, docPath) {
  const set = new Set();
  for (const c of parseCitations(text, CITE_ROOT)) {
    if (CITE_PATH_IGNORE.some((e) => e.doc === docPath && e.path === c.path)) continue;
    set.add(c.path);
  }
  return [...set].sort();
}

export function quotes(text) {
  const set = new Set();
  for (const m of text.matchAll(
    /"((?:Archived|Superseded|Extraction batch) \d{4}-\d{2}-\d{2}[^"]*)"/g
  ))
    set.add(m[1]);
  return [...set];
}

function render(specs) {
  const out = [];
  out.push("# Documentation index (generated)");
  out.push("");
  out.push(
    `Generated section-level index of the three public specs, for retrieval and for the doc-currency audit: one row per \`##\` / \`###\` section, with its starting line, its size (\`Bytes (LF)\`, LF-normalised UTF-8 so Windows and Linux agree; a \`##\` row includes its \`###\` children), the first dated banner line in the section's own text, the ADRs it mentions, the code paths it cites in backticks (historical citations excluded) and the archive headings its tombstones quote. Regenerate with \`${REGEN}\`; CI fails when the committed file is stale; never hand-edit.`
  );
  for (const s of specs) {
    out.push("");
    out.push(`## ${s.name}`);
    out.push("");
    if (!s.rows) {
      out.push(`Skipped: ${s.name} not found.`);
      continue;
    }
    const h2 = s.rows.filter((r) => r.level === 2).length;
    const h3 = s.rows.filter((r) => r.level === 3).length;
    const total = s.rows.filter((r) => r.level <= 2).reduce((a, r) => a + r.bytes, 0);
    out.push(`Total ${fmt(total)} B (LF) · ${h2} h2 · ${h3} h3`);
    out.push("");
    out.push(
      "| § | Section | Line | Bytes (LF) | Dated banner | ADRs | Code paths cited | Archive headings quoted |"
    );
    out.push("|---|---|---|---|---|---|---|---|");
    for (const r of s.rows) {
      const lvl = r.level === 0 ? "—" : `h${r.level}`;
      const sec =
        r.level === 0 ? cell(r.heading) : `[§${cell(r.heading)}](${s.name}#${slugify(r.heading)})`;
      out.push(
        `| ${lvl} | ${sec} | ${r.line} | ${fmt(r.bytes)} | ${cell(r.banner)} | ${r.adrs.join(", ")} | ${cell(r.paths.map((p) => `\`${p}\``).join(", "))} | ${cell(r.quotes.map((q) => `"${q}"`).join(", "))} |`
      );
    }
  }
  return out.join("\n") + "\n";
}

function headSha(root) {
  try {
    return (
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: root,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || "unknown"
    );
  } catch {
    return "unknown";
  }
}

/** The index body (everything after the informational header line), plus notes for skipped specs. */
export function generateBody(root) {
  CITE_ROOT = root;
  const specs = [];
  const notes = [];
  for (const name of SPEC_FILES) {
    const p = join(root, DIR, name);
    if (!existsSync(p)) {
      notes.push(`skipped ${name}: not found`);
      specs.push({ name });
      continue;
    }
    specs.push({ name, rows: parseSpec(readFileSync(p, "utf-8"), `${DIR}/${name}`) });
  }
  return { body: render(specs), specs, notes };
}

export function header(root, date = new Date().toISOString().slice(0, 10)) {
  return `<!-- generated ${date} by .github/scripts/docs_index.mjs from ${headSha(root)} — do not hand-edit; regenerate with: ${REGEN} -->`;
}

/** Everything after line 1, LF-normalised. */
export const bodyOf = (text) => lf(text).split("\n").slice(1).join("\n");

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let mode = "check";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      if (!argv[i + 1]) {
        console.error("--root needs a directory");
        return 2;
      }
      root = resolve(argv[++i]);
    } else if (a === "--write") mode = "write";
    else if (a === "--check") mode = "check";
    else {
      console.error(`unknown argument ${a}`);
      return 2;
    }
  }
  const { body, notes } = generateBody(root);
  for (const n of notes) console.log(`docs-index: ${n}`);
  const target = join(root, INDEX_PATH);
  const fresh = `${header(root)}\n${body}`;
  if (mode === "write") {
    writeFileSync(target, fresh);
    console.log(`docs-index: wrote ${INDEX_PATH} (${Buffer.byteLength(fresh)} bytes)`);
    return 0;
  }
  if (!existsSync(target)) {
    console.log(`docs-index: ${INDEX_PATH} is missing. Generate it with: ${REGEN}`);
    return 1;
  }
  const have = bodyOf(readFileSync(target, "utf-8"));
  const want = lf(body);
  if (have === want) {
    console.log("docs-index: fresh");
    return 0;
  }
  const a = have.split("\n");
  const b = want.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let diff = 0;
  for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) diff++;
  console.log(
    `docs-index: STALE — ${INDEX_PATH} differs from a fresh generation (${diff} differing lines; first at body line ${i + 1}, file line ${i + 2}).`
  );
  console.log(`  committed: ${(a[i] ?? "<end of file>").slice(0, 160)}`);
  console.log(`  generated: ${(b[i] ?? "<end of file>").slice(0, 160)}`);
  console.log(`Regenerate with: ${REGEN}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
