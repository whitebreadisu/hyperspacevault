// HSV design-language drift check (Controls Register: Platform Spec 2.8; ADR-0033).
// Scans frontend/src/**/*.css (and non-test *.tsx for rule `font`) and fails on:
//   clip  - a clip-path polygon that leaves either notch corner square: a vertex at "0 0"
//           (top-left uncut) or at "100% 100%" (bottom-right uncut), i.e. a single-corner
//           or no-corner variant of the steel-ring notch, on a file + selector not listed
//           in design_check.allow. Whitespace and zero units are normalised.
//   ring  - a steel ring drawn with a CSS border: `border`, `border-color`, `outline` or
//           `outline-color` coloured rgba(211, 211, 212, a), #d3d3d4 (or a custom property
//           holding that colour) on all four sides at a width of at least 1px, whether or
//           not the rule also has a clip-path (a border cannot follow a clip-path).
//           Single-side properties (border-top, border-bottom, border-left, border-right
//           and the logical ones) are separators and are not checked.
//   hex   - a hex literal equal to a hex-valued :root token in frontend/src/index.css.
//           Per-file count ratchet (design_check.baseline): a count may fall, never rise;
//           a new file with a hit fails; a count left above the real number fails until
//           the baseline is lowered (`--lower-baseline` does that and never raises one).
//           In CI, `--compare-baseline <base branch's baseline>` also fails when the
//           committed baseline adds a file or raises a count against the base branch.
//   font  - a <button> in TSX with a rule (for its classes) setting font-size where no
//           rule sets `font` or `font-family` for it: the same rule, or an unconditional
//           rule whose subject classes are all on the button, with no ancestors or the
//           same ancestors as the font-size rule. A family only under :hover, [attr],
//           `.a.b` (b not on the button), another ancestor or @media does not count. No
//           button font reset may cover it: an unconditional bare `button { font... }`,
//           or `.m-app button { font... }` for TSX under a BUTTON_RESET_SCOPES path
//           (`button:x`, `button[x]` and @media-wrapped rules are not resets). Desktop has
//           no global button font reset, so such a button renders in the UA control font.
//
// Usage: node .github/scripts/design_check.mjs [--root <dir>] [--allow <file>]
//          [--baseline <file>] [--lower-baseline] [--seed-baseline]
//          [--compare-baseline <base-branch baseline file>]
//   --lower-baseline    rewrite the hex baseline with each count lowered to the real
//                       number (never raised; files at zero are dropped), then check.
//   --seed-baseline     write the hex baseline from the tree as it stands, then exit 0.
//   --compare-baseline  compare the baseline against the given base-branch copy only
//                       (a missing file = first introduction: nothing to compare).
//
// design_check.allow lines: `rule | path | selector-or-class | reason` (rule = clip, ring
// or font; for font the path is the CSS file of the font-size rule and the third field
// its subject classes joined with "." and no leading dot). The reason is required. An
// entry that no longer matches a hit fails as stale.
//
// Limits (accepted; documented in Platform Spec 2.8):
//   - The CSS parser is a small dependency-free tokenizer: comments, strings, url() and
//     nested at-rules are handled; CSS nesting is resolved by plain `&` substitution.
//   - ring: a `border-color` / `outline-color` is resolved against width and style in the
//     same rule or a same-file rule with the same selector minus pseudo-classes; a colour
//     whose width or style cannot be found that way is not flagged. Colours set through
//     a CSS variable defined outside scanned CSS are not seen; a box-shadow ring is not
//     checked.
//   - font: only string-literal classes in `className` are read (template-literal static
//     words, ternary branches); computed classes, CSS modules, inline style fonts and
//     inheritance through ancestors other than BUTTON_RESET_SCOPES are not resolved.
//     :is() / :where() are expanded; pseudo-element rules are ignored. A button class
//     with no font-size rule is not checked. TSX block comments and whole-line //
//     comments are skipped; a trailing // comment holding JSX is not.
//   - hex: only literals in CSS declaration values count (selectors such as #id, quoted
//     strings and comments never do; hex in TSX is not scanned); @property initial
//     values and a declaration re-setting the token itself are exempt.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCAN_DIR = "frontend/src";
const TOKENS_FILE = "frontend/src/index.css";
const SKIP_DIRS = new Set(["node_modules", "__tests__", "vendor"]);
const SKIP_TSX = /\.(test|spec)\.tsx$/;
// A scoped button font reset: `<scope> button { font: inherit }` covers every <button>
// rendered from TSX under the mapped path prefix.
export const BUTTON_RESET_SCOPES = { "m-app": "frontend/src/mobile/" };
const STEEL =
  /rgba?\(\s*211\s*[,\s]\s*211\s*[,\s]\s*212\b|#d3d3d4(?:[0-9a-f]{2})?(?![0-9a-f])/i;
const BORDER_STYLES = new Set([
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
  "auto",
]);

// ---------- CSS parsing ----------

/** Replace comments with spaces, keeping newlines so line numbers hold. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = "";
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export const normSelector = (s) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();

/** Returns [{ selector, line, decls: [{ prop, value, line }] }], one per rule block. */
export function parseCss(src) {
  const text = stripComments(src);
  const rules = [];
  const stack = []; // { kind: "group" | "rule" | "keyframes", selector, rule }
  let buf = "";
  let bufLine = 0;
  let line = 1;
  let quote = "";
  let depth = 0;
  const top = () => stack[stack.length - 1];
  const flushDecl = () => {
    const t = buf.trim();
    const f = top();
    if (t && f && f.rule) {
      const k = t.indexOf(":");
      if (k > 0)
        f.rule.decls.push({
          prop: t.slice(0, k).trim().toLowerCase(),
          value: t.slice(k + 1).trim(),
          line: bufLine,
        });
    }
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") line++;
    if (!buf.trim() && !/\s/.test(c)) bufLine = line;
    if (quote) {
      buf += c;
      if (c === "\\") {
        buf += text[++i] ?? "";
      } else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (depth > 0) {
      buf += c;
      continue;
    }
    if (c === "{") {
      const prelude = buf.trim();
      const startLine = bufLine;
      buf = "";
      const parent = top();
      const parentCond = parent ? parent.cond : false;
      if (
        /^@(media|supports|container|layer|document|scope)\b/i.test(prelude)
      ) {
        // @layer only orders the cascade; the others apply conditionally.
        stack.push({
          kind: "group",
          selector: parent ? parent.selector : "",
          rule: parent ? parent.rule : undefined,
          cond: parentCond || !/^@layer\b/i.test(prelude),
        });
      } else if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
        stack.push({
          kind: "keyframes",
          selector: normSelector(prelude),
          cond: true,
        });
      } else {
        let selector = normSelector(prelude);
        if (parent && parent.kind === "keyframes")
          selector = `${parent.selector} ${selector}`;
        else if (parent && parent.rule) {
          selector = selector.includes("&")
            ? selector.replace(/&/g, parent.selector)
            : `${parent.selector} ${selector}`;
        }
        const rule = {
          selector,
          line: startLine,
          decls: [],
          conditional: parentCond,
        };
        rules.push(rule);
        stack.push({ kind: "rule", selector, rule, cond: parentCond });
      }
      continue;
    }
    if (c === ";") {
      flushDecl();
      continue;
    }
    if (c === "}") {
      flushDecl();
      stack.pop();
      continue;
    }
    buf += c;
  }
  return rules;
}

// ---------- helpers ----------

/** Split on commas at paren depth 0. */
function splitTop(s, ch = ",") {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ch && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Each polygon(...) argument list in a value, as normalised vertex strings. */
export function polygons(value) {
  const out = [];
  const re = /polygon\(/gi;
  let m;
  while ((m = re.exec(value))) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    while (j < value.length && depth > 0) {
      if (value[j] === "(") depth++;
      if (value[j] === ")") depth--;
      j++;
    }
    let verts = splitTop(
      value
        .slice(start, j - 1)
        .toLowerCase()
        .replace(/\s+/g, " "),
    );
    if (verts.length && /^(evenodd|nonzero)$/.test(verts[0]))
      verts = verts.slice(1);
    out.push(
      verts.map((v) =>
        v
          .split(" ")
          .filter(Boolean)
          .map((t) => (/^[-+]?0*\.?0+(px|%|em|rem)?$/.test(t) ? "0" : t))
          .join(" "),
      ),
    );
  }
  return out;
}

/** Width in px of a border/outline width token, or null if not a width. */
function widthPx(t) {
  if (t === "thin") return 1;
  if (t === "medium") return 3;
  if (t === "thick") return 5;
  const m = /^(\d*\.?\d+)(px|em|rem)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "em" || m[2] === "rem" ? n * 16 : n;
}

/** Tokens of a value with function calls (rgba(), var(), calc()) collapsed to one token. */
function valueTokens(v) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const c of v.trim()) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (/\s/.test(c) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** { widths: [4 sides px | null], style } from a border/outline shorthand. */
function shorthand(v) {
  let width = null;
  let style = null;
  for (const t of valueTokens(v.toLowerCase().replace(/!important/, ""))) {
    const w = widthPx(t);
    if (w !== null) width = w;
    else if (BORDER_STYLES.has(t) || t === "none" || t === "hidden") style = t;
  }
  if (style && style !== "none" && style !== "hidden" && width === null)
    width = 3; // initial: medium
  return {
    widths: width === null ? null : [width, width, width, width],
    style,
  };
}

function expandWidths(v) {
  const ws = valueTokens(v.toLowerCase()).map(widthPx);
  if (!ws.length || ws.some((w) => w === null)) return null;
  const [a, b = a, c = a, d = b] = ws;
  return [a, b, c, d];
}

const stripPseudo = (sel) =>
  sel
    .replace(/::?[a-z-]+(\([^)]*\))?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------- rules ----------

/** Which of the two notch corners a polygon leaves square: [] when both are cut. */
export function uncutCorners(verts) {
  const out = [];
  if (verts.includes("0 0")) out.push("top-left");
  if (verts.includes("100% 100%")) out.push("bottom-right");
  return out;
}

function clipHits(file, rules) {
  const hits = [];
  for (const r of rules) {
    for (const d of r.decls) {
      if (!(
        d.prop === "clip-path" ||
        d.prop === "-webkit-clip-path" ||
        d.prop.startsWith("--")
      ))
        continue;
      for (const verts of polygons(d.value)) {
        const uncut = uncutCorners(verts);
        if (uncut.length)
          hits.push({
            rule: "clip",
            file,
            key: r.selector,
            line: d.line,
            msg: `polygon(${verts.join(", ")}) leaves the ${uncut.join(" and ")} corner${uncut.length > 1 ? "s" : ""} uncut`,
          });
      }
    }
  }
  return hits;
}

function ringHits(file, rules, steelVars) {
  const isSteel = (v) =>
    STEEL.test(v) ||
    [...v.matchAll(/var\(\s*(--[\w-]+)/g)].some((m) => steelVars.has(m[1]));
  const hits = [];
  for (const r of rules) {
    const base = stripPseudo(r.selector);
    const family = rules.filter(
      (o) => o === r || stripPseudo(o.selector) === base,
    );
    // No clip-path exemption: a border cannot follow a clip-path, so a steel border on a
    // clipped element is the forbidden case too.
    for (const d of r.decls) {
      if (
        !["border", "border-color", "outline", "outline-color"].includes(
          d.prop,
        ) ||
        !isSteel(d.value)
      )
        continue;
      const kind = d.prop.startsWith("outline") ? "outline" : "border";
      let widths = null;
      let style = null;
      if (d.prop === kind) ({ widths, style } = shorthand(d.value));
      else {
        // colour only: resolve width and style from this rule, then its pseudo-class family.
        for (const o of [r, ...family.filter((x) => x !== r)]) {
          for (const od of o.decls) {
            if (od.prop === kind) {
              const s = shorthand(od.value);
              widths ??= s.widths;
              style ??= s.style;
            } else if (od.prop === `${kind}-width`)
              widths ??= expandWidths(od.value);
            else if (od.prop === `${kind}-style`)
              style ??= od.value.trim().toLowerCase().split(/\s+/)[0];
          }
        }
      }
      if (!widths || !style || style === "none" || style === "hidden") continue;
      if (widths.every((w) => w >= 1))
        hits.push({
          rule: "ring",
          file,
          key: r.selector,
          line: d.line,
          msg: `steel ring drawn with \`${d.prop}: ${d.value}\` (draw it as the two-layer clip-path ring)`,
        });
    }
  }
  return hits;
}

export function normHex(h) {
  let x = h.toLowerCase().replace(/^#/, "");
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join("");
  if (x.length === 8 && x.endsWith("ff")) x = x.slice(0, 6);
  return "#" + x;
}
const HEX =
  /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z_-])/gi;

/** Map normalised hex -> token name, from the :root rules of index.css. */
export function rootTokens(rules) {
  const out = new Map();
  for (const r of rules) {
    if (r.selector !== ":root") continue;
    for (const d of r.decls) {
      const m = /^#[0-9a-f]{3,8}$/i.exec(d.value.trim());
      if (d.prop.startsWith("--") && m)
        out.set(normHex(d.value.trim()), d.prop);
    }
  }
  return out;
}

function hexHits(file, rules, tokens, isTokensFile) {
  const hits = [];
  for (const r of rules) {
    // The token definitions themselves: :root in index.css and @property initial values.
    if (
      (isTokensFile && r.selector === ":root") ||
      r.selector.startsWith("@property ")
    )
      continue;
    for (const d of r.decls) {
      // url() and quoted strings (`content: "#1"`) are not colours.
      const v = d.value
        .replace(/url\([^)]*\)/gi, "")
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "");
      for (const m of v.matchAll(HEX)) {
        const tok = tokens.get(normHex(m[0]));
        // A rule re-setting the token itself (`--color-primary: #2563eb`) cannot use var().
        if (tok && tok !== d.prop)
          hits.push({
            rule: "hex",
            file,
            line: d.line,
            msg: `${m[0]} is var(${tok})`,
          });
      }
    }
  }
  return hits;
}

/** Subject compound of a selector: { tag, classes, pseudoElement, ancestors }. */
export function subject(sel) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of sel) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && /[\s>+~]/.test(c)) {
      if (cur) parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) parts.push(cur);
  const last = parts[parts.length - 1] || "";
  const pseudoElement =
    /::|:(before|after|placeholder|marker|selection)\b/i.test(last);
  const bare = last
    .replace(/:[a-z-]+\([^)]*\)/gi, "")
    .replace(/\[[^\]]*\]/g, "");
  const classes = [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  const tag = (/^([a-zA-Z][\w-]*)/.exec(bare) || [])[1]?.toLowerCase() || null;
  // A pseudo-class or attribute on the subject makes the rule apply only sometimes.
  const conditional = /[:[]/.test(last);
  return {
    tag,
    classes,
    pseudoElement,
    conditional,
    ancestors: parts.slice(0, -1),
  };
}

/** Expand :is(...) / :where(...) into one selector per argument (nesting allowed). */
export function expandIs(sel) {
  const m = /:(is|where|matches)\(/i.exec(sel);
  if (!m) return [sel];
  let depth = 1;
  let j = m.index + m[0].length;
  const start = j;
  while (j < sel.length && depth > 0) {
    if (sel[j] === "(") depth++;
    if (sel[j] === ")") depth--;
    j++;
  }
  const args = splitTop(sel.slice(start, j - 1));
  return args.flatMap((a) =>
    expandIs(sel.slice(0, m.index) + a + sel.slice(j)),
  );
}

/** Blank out JS block comments and whole-line // comments, keeping line numbers. */
export function stripTsxComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** [{ line, classes }] for each <button ...> in a TSX source. */
export function buttonsInTsx(raw) {
  const src = stripTsxComments(raw);
  const out = [];
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src))) {
    let j = m.index + m[0].length;
    let depth = 0;
    let quote = "";
    while (j < src.length) {
      const c = src[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
      j++;
    }
    const tag = src.slice(m.index, j);
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ line, classes: classNameClasses(tag) });
  }
  return out;
}

/** Class words from a JSX tag's className attribute (string literals only). */
export function classNameClasses(tag) {
  const at = /\bclassName\s*=\s*/.exec(tag);
  if (!at) return [];
  let rest = tag.slice(at.index + at[0].length);
  let expr;
  if (rest[0] === '"' || rest[0] === "'")
    expr = rest.slice(0, rest.indexOf(rest[0], 1) + 1);
  else if (rest[0] === "{") {
    let depth = 0;
    let k = 0;
    for (; k < rest.length; k++) {
      if (rest[k] === "{") depth++;
      if (rest[k] === "}" && --depth === 0) break;
    }
    expr = rest.slice(0, k + 1);
  } else return [];
  const words = new Set();
  for (const lit of expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const s = (lit[1] ?? lit[2] ?? lit[3]).replace(/\$\{[^}]*\}/g, "\u0000");
    for (const w of s.split(/\s+/))
      if (/^-?[_a-zA-Z][\w-]*$/.test(w) && !w.endsWith("-")) words.add(w);
  }
  return [...words];
}

function fontHits(cssByFile, tsxFiles, read) {
  const setsFamily = (r) =>
    r.decls.some((d) => d.prop === "font" || d.prop === "font-family");
  const entries = [];
  for (const [file, rules] of cssByFile) {
    for (const r of rules) {
      for (const sel of splitTop(r.selector)) {
        for (const x of expandIs(sel)) {
          const s = subject(x);
          if (s.pseudoElement) continue;
          entries.push({
            file,
            rule: r,
            s,
            anc: s.ancestors.join(" "),
            conditional: r.conditional || s.conditional,
            family: setsFamily(r),
            sized: r.decls.some((d) => d.prop === "font-size"),
          });
        }
      }
    }
  }
  // Button font resets: only an unconditional `button { font... }`, or one scoped to a
  // BUTTON_RESET_SCOPES ancestor (`.m-app button`). `button:hover`, `button[x]` and
  // @media-wrapped rules are not resets.
  let globalReset = false;
  const scopedResets = new Set();
  for (const e of entries) {
    if (
      e.s.tag !== "button" ||
      e.s.classes.length ||
      e.conditional ||
      !e.family
    )
      continue;
    if (!e.s.ancestors.length) globalReset = true;
    else if (e.s.ancestors.length === 1) {
      const anc = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(e.s.ancestors[0]);
      if (anc && BUTTON_RESET_SCOPES[anc[1]]) scopedResets.add(anc[1]);
    }
  }
  if (globalReset) return [];
  const scopeOf = (e) => {
    const anc = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(e.s.ancestors[0] || "");
    return anc && scopedResets.has(anc[1]) ? anc[1] : null;
  };
  const byClass = new Map();
  for (const e of entries) {
    if (scopeOf(e)) continue; // applies only inside a reset scope, which covers it
    for (const c of e.s.classes) {
      if (!byClass.has(c)) byClass.set(c, []);
      byClass.get(c).push(e);
    }
  }
  const hits = [];
  for (const tsx of tsxFiles) {
    const covered = [...scopedResets].some((sc) =>
      tsx.startsWith(BUTTON_RESET_SCOPES[sc]),
    );
    if (covered) continue;
    for (const b of buttonsInTsx(read(tsx))) {
      const C = new Set(b.classes);
      // A rule applies to this button when every class of its subject is on the button.
      const applies = (e) =>
        e.s.classes.every((c) => C.has(c)) &&
        (!e.s.tag || e.s.tag === "button");
      const cand = [
        ...new Set(b.classes.flatMap((c) => byClass.get(c) || [])),
      ].filter(applies);
      for (const sized of cand.filter((e) => e.sized)) {
        // A family covers the size when it is set by the same rule, or by an
        // unconditional rule for the button's classes in the same ancestor context
        // (or none). A family only under :hover, `.a.b` or another ancestor does not.
        const ok = cand.some(
          (f) =>
            f.family &&
            (f.rule === sized.rule ||
              (!f.conditional && (f.anc === "" || f.anc === sized.anc))),
        );
        if (ok) continue;
        hits.push({
          rule: "font",
          file: sized.file,
          key: sized.s.classes.join("."),
          line: sized.rule.line,
          msg: `sets font-size, but no rule for the classes of <button className="${b.classes.join(" ")}"> (${tsx}:${b.line}) sets font or font-family`,
        });
        break;
      }
    }
  }
  return hits;
}

// ---------- tree, allow-list, baseline ----------

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (
      /\.css$/.test(e.name) ||
      (/\.tsx$/.test(e.name) && !SKIP_TSX.test(e.name))
    )
      out.push(p);
  }
}

export function scan(root) {
  const files = [];
  walk(join(root, SCAN_DIR), files);
  const rel = (f) => relative(root, f).split(sep).join("/");
  const read = (r) => readFileSync(join(root, r), "utf-8");
  const css = files
    .map(rel)
    .filter((f) => f.endsWith(".css"))
    .sort();
  const tsx = files
    .map(rel)
    .filter((f) => f.endsWith(".tsx"))
    .sort();
  const cssByFile = new Map(css.map((f) => [f, parseCss(read(f))]));
  const tokens = cssByFile.has(TOKENS_FILE)
    ? rootTokens(cssByFile.get(TOKENS_FILE))
    : new Map();
  const steelVars = new Set();
  for (const rules of cssByFile.values())
    for (const r of rules)
      for (const d of r.decls)
        if (d.prop.startsWith("--") && STEEL.test(d.value))
          steelVars.add(d.prop);
  const hits = [];
  for (const [f, rules] of cssByFile) {
    hits.push(
      ...clipHits(f, rules),
      ...ringHits(f, rules, steelVars),
      ...hexHits(f, rules, tokens, f === TOKENS_FILE),
    );
  }
  hits.push(...fontHits(cssByFile, tsx, read));
  return hits;
}

const ALLOW_RULES = new Set(["clip", "ring", "font"]);
/** Map "rule|path|key" -> reason. */
export function readAllow(file) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(" | ").map((x) => x.trim());
    if (parts.length !== 4 || !ALLOW_RULES.has(parts[0]) || !parts[3])
      throw new Error(
        `design_check.allow: bad line "${t}" (want "rule | path | selector-or-class | reason", rule clip/ring/font)`,
      );
    out.set(`${parts[0]}|${parts[1]}|${normSelector(parts[2])}`, parts[3]);
  }
  return out;
}

/** Map path -> count from "path count" lines. */
export function readBaseline(file) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(\S+)\s+(\d+)$/.exec(t);
    if (!m)
      throw new Error(
        `design_check.baseline: bad line "${t}" (want "path count")`,
      );
    out.set(m[1], Number(m[2]));
  }
  return out;
}

const BASELINE_HEADER =
  "# design-check hex ratchet: per-file count of hex literals equal to a :root token in\n" +
  "# frontend/src/index.css (use the var() instead). Format: path count. A count may fall,\n" +
  "# never rise; lower an entry when you remove hits (node .github/scripts/design_check.mjs --lower-baseline).\n";

export function writeBaseline(file, counts) {
  const body = [...counts]
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([f, n]) => `${f} ${n}`);
  writeFileSync(file, BASELINE_HEADER + body.join("\n") + "\n");
}

export function hexCounts(hits) {
  const counts = new Map();
  for (const h of hits)
    if (h.rule === "hex") counts.set(h.file, (counts.get(h.file) || 0) + 1);
  return counts;
}

export function check(root, allowFile, baselineFile) {
  const hits = scan(root);
  const allow = readAllow(allowFile);
  const baseline = readBaseline(baselineFile);
  const errors = [];
  const used = new Set();
  const byRule = { clip: 0, ring: 0, font: 0, hex: 0 };
  for (const h of hits) {
    if (h.rule === "hex") continue;
    byRule[h.rule]++;
    const k = `${h.rule}|${h.file}|${normSelector(h.key)}`;
    if (allow.has(k)) used.add(k);
    else errors.push(`${h.file}:${h.line}: [${h.rule}] ${h.key}: ${h.msg}`);
  }
  for (const k of allow.keys())
    if (!used.has(k))
      errors.push(
        `design_check.allow: stale entry "${k.split("|").join(" | ")}" - it matches no hit; remove it`,
      );
  const counts = hexCounts(hits);
  for (const [file, n] of counts) {
    byRule.hex += n;
    const base = baseline.get(file);
    const lines = hits.filter((h) => h.rule === "hex" && h.file === file);
    if (base === undefined)
      for (const h of lines)
        errors.push(`${h.file}:${h.line}: [hex] ${h.msg} - use the token`);
    else if (n > base)
      errors.push(
        `${file}: [hex] ${n} token-valued hex literal(s), baseline ${base} - the count may only fall; use the tokens (lines ${lines.map((h) => h.line).join(", ")})`,
      );
    else if (n < base)
      errors.push(
        `${file}: [hex] ${n} token-valued hex literal(s), baseline ${base} - lower the baseline: set this entry in design_check.baseline to ${n} (or run node .github/scripts/design_check.mjs --lower-baseline)`,
      );
  }
  for (const f of baseline.keys())
    if (!counts.has(f))
      errors.push(
        `${f}: [hex] stale baseline entry - no token-valued hex left; remove it (or run --lower-baseline)`,
      );
  let baseTotal = 0;
  for (const v of baseline.values()) baseTotal += v;
  return {
    errors,
    hits,
    byRule,
    allow: allow.size,
    baseline: baseTotal,
    baselineFiles: baseline.size,
  };
}

/**
 * Errors where `head` (this tree's baseline) is looser than `base` (the base branch's):
 * a file added or a count raised. `base` null (no baseline on the base branch yet: the
 * check's first introduction) compares nothing.
 */
export function compareBaselines(base, head) {
  if (!base) return [];
  const errors = [];
  for (const [f, n] of head) {
    const b = base.get(f);
    if (b === undefined)
      errors.push(
        `${f}: [hex] added to design_check.baseline (not on the base branch) - use the tokens instead`,
      );
    else if (n > b)
      errors.push(
        `${f}: [hex] baseline raised from ${b} to ${n} against the base branch - the count may only fall`,
      );
  }
  return errors;
}

/** Lower each baseline count to the real number; never raise one; drop zeros. */
export function lowerBaseline(root, baselineFile) {
  const counts = hexCounts(scan(root));
  const base = readBaseline(baselineFile);
  const next = new Map();
  for (const [f, n] of base) next.set(f, Math.min(n, counts.get(f) || 0));
  writeBaseline(baselineFile, next);
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const here = dirname(fileURLToPath(import.meta.url));
  const root = arg("--root") || join(here, "..", "..");
  const allowFile =
    arg("--allow") || join(root, ".github", "scripts", "design_check.allow");
  const baselineFile =
    arg("--baseline") ||
    join(root, ".github", "scripts", "design_check.baseline");
  if (argv.includes("--compare-baseline")) {
    const baseFile = arg("--compare-baseline");
    const errs = compareBaselines(
      baseFile && existsSync(baseFile) ? readBaseline(baseFile) : null,
      readBaseline(baselineFile),
    );
    if (errs.length) {
      for (const e of errs) console.error(e);
      console.error(
        `design-check: FAIL baseline looser than the base branch's`,
      );
      process.exit(1);
    }
    console.log(
      "design-check: baseline at or under the base branch's (no file added, no count raised)",
    );
    return;
  }
  if (argv.includes("--seed-baseline")) {
    writeBaseline(baselineFile, hexCounts(scan(root)));
    console.log(`design-check: seeded ${relative(root, baselineFile)}`);
    return;
  }
  if (argv.includes("--lower-baseline")) lowerBaseline(root, baselineFile);
  const r = check(root, allowFile, baselineFile);
  if (r.errors.length) {
    for (const e of r.errors) console.error(e);
    console.error(`design-check: FAIL ${r.errors.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `design-check: clip ${r.byRule.clip}, ring ${r.byRule.ring}, font ${r.byRule.font} hit(s), all in the allow-list (${r.allow} entries); hex ${r.byRule.hex} at baseline (${r.baselineFiles} files)`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main();
