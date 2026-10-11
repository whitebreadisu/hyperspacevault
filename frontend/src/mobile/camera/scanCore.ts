// BL-253 S7-06: the strip parser, validator and acceptance state machine --
// a TypeScript port of the BL-238 spike's scan-core.js (v0.5.5, 397 lines),
// line for line. Types only: no behaviour change (ADR-0029 Consequences --
// the spike is the seed, not a reference to reinterpret). Pure, no DOM.
//
// Denominator semantics (verbatim from the spike):
//   N/<main> = main; N/20 in SOR/SHD/TWI = Weekly Play; N/2 = tournament
//   tiers, always a pick (`byDesign`); absent = non-main printings; a
//   denominator one digit off a known main size is corrected (`denCorrected`);
//   later-set promo codes (ASHP, P26, JTLP ...) ignore the denominator;
//   T-prefixed numbers are tokens.

/** The scan catalogue (the spike's catalog.json shape; derived from the app's
 * own data by scanCatalog.ts, S7-07). */
export interface ScanCatalogData {
  v: number;
  snapshot?: string;
  main: Record<string, number>;
  early: string[];
  printed: Record<string, string[]>;
  /** [src, num, card, vid, vt, cls] */
  p: [string, number, number, number, number, string][];
  /** [name, subtitle, type, home, baseNum] */
  cards: [string, string, string, string, number][];
  vt: string[];
  setNames?: Record<string, string>;
}

export interface CatRow {
  src: string;
  num: number;
  card: number;
  vid: number;
  vt: string;
  cls: string;
}

export interface CardInfo {
  name: string;
  subtitle: string;
  type: string;
  home: string;
  baseNum: number;
}

export interface CodeHit {
  code: string;
  how: string;
  fixed: boolean;
}

export interface NumReading {
  num: number;
  numRaw: string;
  den: number | null;
  denRaw: string | null;
  token: boolean;
  badge: string | null;
  alt?: boolean;
}

export interface Parsed {
  norm: string;
  code: string | null;
  codeHow: string | null;
  codeFixed: boolean;
  haveEN: boolean;
  enAt: number;
  readings: NumReading[];
  notes: string[];
  numTokenAt?: number;
  altReadings?: NumReading[];
  codeDist?: number;
}

export interface Printing {
  vid: number;
  vt: string;
  src: string;
  num: number;
}

export interface CandidateCard {
  card: number;
  name: string;
  subtitle: string;
  type: string;
  home: string;
  printings: Printing[];
}

export type ReadResult = "exact" | "ambiguous" | "invalid";

export interface Validation {
  key: string;
  result: ReadResult;
  reason: string;
  cards: CandidateCard[];
  foilPick: boolean;
  byDesign: boolean;
  denCorrected?: number;
  reading?: NumReading;
}

export interface Evaluation {
  parse: Parsed;
  result: ReadResult;
  reason: string;
  best: Validation | null;
  all: Validation[];
}

export interface KeyStrength {
  strength: "weak" | "strong";
  why: string;
}

// Confusions applied ONLY inside the number token (definition §9.5).
const NUM_FIX: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  "|": "1",
  S: "5",
  B: "8",
  Z: "2",
};
// For set codes: try swapping letter/digit look-alikes, accept only a unique known-code hit.
const CODE_SWAP: Record<string, string> = {
  "0": "O",
  O: "0",
  "1": "I",
  I: "1",
  "5": "S",
  S: "5",
  "8": "B",
  B: "8",
  "2": "Z",
  Z: "2",
  "6": "G",
  G: "6",
};

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev: number[] = [];
  let cur: number[];
  let i: number;
  let j: number;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur = [i];
    for (j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function fixDigits(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += NUM_FIX[s[i]] || s[i];
  return out;
}

// One number token -> zero or more {num, den, token} interpretations.
export function numberReadings(tok: string): NumReading[] {
  const outs: NumReading[] = [];
  function tryTok(t: string, badge: string | null) {
    const m = /^(T?)([0-9OQDILSBZ|]{1,4})(?:\/(T?)([0-9OQDILSBZ|]{1,4}))?$/.exec(t);
    if (!m) return;
    const n = fixDigits(m[2]);
    const d = m[4] != null ? fixDigits(m[4]) : null;
    if (!/^\d+$/.test(n) || (d != null && !/^\d+$/.test(d))) return;
    // a number must contain at least one real digit, otherwise "SOR"/"EN"-like noise becomes numbers
    if (!/\d/.test(m[2])) return;
    outs.push({
      num: parseInt(n, 10),
      numRaw: m[1] + n,
      den: d != null ? parseInt(d, 10) : null,
      denRaw: d != null ? (m[3] || "") + d : null,
      token: !!(m[1] || m[3]),
      badge: badge || null,
    });
  }
  tryTok(tok, null);
  // a rarity badge letter glued to the front: C U R L S (S and L are also digit look-alikes, so keep both readings)
  if (/^[CURLS]/.test(tok) && tok.length > 1) tryTok(tok.slice(1), tok[0]);
  return outs;
}

export function normalise(raw: unknown): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/[•·∙●・.,:;_\-–—]/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

const EN_RX = /^[EF][NHM]$/;
const EN_GLUED_RX = /[EF][NHM]$/;

function oneDigitOff(a: number | string, b: number | string): boolean {
  const x = String(a);
  const y = String(b);
  let diff = 0;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
  return diff === 1;
}

export function tripleKey(
  code: string,
  r: { token?: boolean; num: number; den: number | null; denRaw?: string | null }
): string {
  return (
    code +
    " " +
    (r.token ? "T" : "") +
    r.num +
    (r.den != null ? "/" + (r.token && r.denRaw && r.denRaw[0] === "T" ? "T" : "") + r.den : "")
  );
}

export class Catalog {
  cat: ScanCatalogData;
  known: string[];
  knownSet: Record<string, boolean>;
  early: Record<string, boolean>;
  idx: Map<string, CatRow[]>;
  private _ks: Record<string, KeyStrength> = {};

  constructor(cat: ScanCatalogData) {
    this.cat = cat;
    this.known = Object.keys(cat.printed);
    this.knownSet = {};
    for (let i = 0; i < this.known.length; i++) this.knownSet[this.known[i]] = true;
    this.early = {};
    for (let i = 0; i < cat.early.length; i++) this.early[cat.early[i]] = true;
    this.idx = new Map();
    for (let i = 0; i < cat.p.length; i++) {
      const r = cat.p[i];
      const row: CatRow = {
        src: r[0],
        num: r[1],
        card: r[2],
        vid: r[3],
        vt: cat.vt[r[4]],
        cls: r[5],
      };
      const k = r[0] + "|" + r[1];
      if (!this.idx.has(k)) this.idx.set(k, []);
      this.idx.get(k)!.push(row);
    }
  }

  cardInfo(ci: number): CardInfo {
    const c = this.cat.cards[ci];
    return { name: c[0], subtitle: c[1], type: c[2], home: c[3], baseNum: c[4] };
  }

  // token -> {code, how, fixed} or null. how: exact | trailing | swap | edit1
  resolveCode(tok: string | undefined): CodeHit | null {
    if (!tok) return null;
    if (this.knownSet[tok]) return { code: tok, how: "exact", fixed: false };
    if (tok.length < 2 || tok.length > 12) return null;
    // the "•" separator read as a trailing S/-/./· glued to the code: LAWS(EN) -> LAW
    const last = tok[tok.length - 1];
    const head = tok.slice(0, -1);
    if ("S-.·•".indexOf(last) >= 0 && this.knownSet[head])
      return { code: head, how: "trailing", fixed: true };
    // code glued to the preceding "©FFG" ("O0FFGASHP"): the longest known code (3+ chars) the token ends with
    let suf: string | null = null;
    for (let q = 0; q < this.known.length; q++) {
      const kk = this.known[q];
      if (
        kk.length >= 3 &&
        tok.length > kk.length &&
        tok.slice(-kk.length) === kk &&
        (!suf || kk.length > suf.length)
      )
        suf = kk;
    }
    if (suf) return { code: suf, how: "suffix", fixed: true };
    // letter/digit look-alikes (S0R -> SOR), unique hit only
    let opts = [""];
    let i: number;
    let j: number;
    for (i = 0; i < tok.length; i++) {
      const ch = tok[i];
      const alt = CODE_SWAP[ch];
      const next: string[] = [];
      for (j = 0; j < opts.length; j++) {
        next.push(opts[j] + ch);
        if (alt) next.push(opts[j] + alt);
      }
      opts = next;
    }
    const hits: Record<string, boolean> = {};
    for (i = 0; i < opts.length; i++) if (this.knownSet[opts[i]]) hits[opts[i]] = true;
    const h = Object.keys(hits);
    if (h.length === 1) return { code: h[0], how: "swap", fixed: true };
    if (h.length > 1) return null;
    // one character inserted, substituted or deleted versus exactly one known code (codes of 3+ chars only)
    if (tok.length < 3) return null;
    const d1: string[] = [];
    for (i = 0; i < this.known.length; i++) {
      const k = this.known[i];
      if (k.length >= 3 && Math.abs(k.length - tok.length) <= 1 && editDistance(tok, k) === 1)
        d1.push(k);
    }
    return d1.length === 1 ? { code: d1[0], how: "edit1", fixed: true } : null;
  }

  // raw OCR text -> {norm, code, codeHow, codeFixed, haveEN, readings:[{num,den,token,...}], notes}
  parse(raw: unknown): Parsed {
    const norm = normalise(raw);
    const toks0 = norm ? norm.split(" ") : [];
    const toks: string[] = [];
    // PaddleOCR glues EN to the rarity/program badge and the number ("ENR", "ENU598", "ENW"): split them back out
    for (let z = 0; z < toks0.length; z++) {
      const gm = /^([EF][NHM])([CURLSWVP]?)(T?[0-9][0-9OILSBZ/T]*)?$/.exec(toks0[z]);
      if (gm && (gm[2] || gm[3])) {
        toks.push(gm[1]);
        if (gm[2]) toks.push(gm[2]);
        if (gm[3]) toks.push(gm[3]);
      } else toks.push(toks0[z]);
    }
    const res: Parsed = {
      norm,
      code: null,
      codeHow: null,
      codeFixed: false,
      haveEN: false,
      enAt: -1,
      readings: [],
      notes: [],
    };
    let codeAt = -1;
    let enEnd = -1;
    let i: number;
    let rc: CodeHit | null = null;
    // 1) the EN marker: "EN", a split "E N", or EN glued to the code ("LAWSEN", "ASHEN")
    for (i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (EN_RX.test(t) || (t === "E" && toks[i + 1] === "N")) {
        if (enEnd < 0) {
          enEnd = t === "E" ? i + 1 : i;
          res.enAt = i;
        }
        if (i > 0 && (rc = this.resolveCode(toks[i - 1]))) {
          codeAt = i - 1;
          enEnd = t === "E" ? i + 1 : i;
          res.enAt = i;
          break;
        }
        continue;
      }
      if (t.length > 3 && EN_GLUED_RX.test(t) && (rc = this.resolveCode(t.slice(0, -2)))) {
        codeAt = i;
        enEnd = i;
        res.enAt = i;
        break;
      }
    }
    if (codeAt >= 0 && rc) {
      res.code = rc.code;
      res.codeHow = rc.how;
      res.codeFixed = rc.fixed;
      res.haveEN = true;
    }
    // 2) no code before an EN: first token that is exactly a known printed code
    if (codeAt < 0) {
      for (i = 0; i < toks.length; i++) {
        if (this.knownSet[toks[i]]) {
          res.code = toks[i];
          res.codeHow = "exact_no_EN";
          codeAt = i;
          res.notes.push("no_EN_before_number");
          break;
        }
      }
      if (enEnd >= 0) res.haveEN = true;
    }
    // 3) number = right-most number token AFTER both the code and the EN marker (never one that precedes EN)
    const start = Math.max(codeAt, enEnd) + 1;
    for (i = toks.length - 1; i >= start; i--) {
      if (toks[i].length === 1 && /[A-Z]/.test(toks[i])) continue; // lone rarity badge
      const rs = numberReadings(toks[i]);
      if (rs.length) {
        res.readings = rs;
        res.numTokenAt = i;
        break;
      }
    }
    // v0.5.1: other number tokens after EN (e.g. Paddle "16 1": trailing noise) are kept as alternatives; a valid
    // alternative that disagrees makes the read ambiguous instead of silently taking the right-most token
    res.altReadings = [];
    if (res.readings.length) {
      for (i = res.numTokenAt! - 1; i >= start; i--) {
        if (toks[i].length === 1 && /[A-Z]/.test(toks[i])) continue;
        const ar = numberReadings(toks[i]).filter((x) => /\d/.test(x.numRaw));
        ar.forEach((x) => {
          x.alt = true;
        });
        res.altReadings = res.altReadings.concat(ar);
      }
    }
    // 4) no code at all: a denominator equal to some sets' main size + a token within edit distance 2 of one of them
    if (!res.code && this.cat.main) {
      for (i = toks.length - 1; i >= 0 && !res.code; i--) {
        const rr = numberReadings(toks[i]).filter((x) => x.den != null && !x.token);
        if (!rr.length) continue;
        const den = rr[0].den;
        const cands: string[] = [];
        Object.keys(this.cat.main).forEach((c) => {
          if (this.cat.main[c] === den) cands.push(c);
        });
        if (!cands.length) break;
        let best: { c: string; d: number } | null = null;
        let second = 99;
        const iAt = i;
        cands.forEach((c) => {
          let dmin = 99;
          for (let k = 0; k < iAt; k++) {
            const tk = toks[k];
            if (tk.length < 2) continue;
            const forms = [tk];
            if (tk.length > 2 && EN_GLUED_RX.test(tk)) forms.push(tk.slice(0, -2));
            forms.forEach((f) => {
              if (f.length >= 2) dmin = Math.min(dmin, editDistance(f, c));
            });
          }
          if (!best || dmin < best.d) {
            if (best) second = Math.min(second, best.d);
            best = { c, d: dmin };
          } else second = Math.min(second, dmin);
        });
        const b = best as { c: string; d: number } | null;
        if (b && b.d <= 2 && second > b.d) {
          res.code = b.c;
          res.codeHow = "den_fallback";
          res.codeFixed = true;
          res.codeDist = b.d;
          res.readings = rr;
          res.numTokenAt = i;
          res.notes.push("code_from_denominator");
        }
        break;
      }
    }
    return res;
  }

  // (code, reading) -> {result: exact|ambiguous|invalid, reason, cards:[{card, name, subtitle, printings:[...]}], key}
  validateOne(
    code: string,
    r: { num: number; den: number | null; denRaw?: string | null; token: boolean }
  ): Validation {
    const cat = this.cat;
    const out: Validation = {
      key: tripleKey(code, r),
      result: "invalid",
      reason: "",
      cards: [],
      foilPick: false,
      byDesign: false,
    };
    const srcs = cat.printed[code];
    if (!srcs) {
      out.reason = "unknown_code";
      return out;
    }
    let rows: CatRow[] = [];
    for (let i = 0; i < srcs.length; i++) {
      const got = this.idx.get(srcs[i] + "|" + r.num);
      if (got) rows = rows.concat(got);
    }
    const main = cat.main[code];
    const early = !!this.early[code];
    if (r.token) {
      rows = rows.filter((x) => x.cls === "t");
    } else {
      rows = rows.filter((x) => x.cls !== "t");
      if (main) {
        if (r.den == null) rows = rows.filter((x) => x.cls === "n");
        else if (r.den === main) rows = rows.filter((x) => x.cls === "m");
        else if (early && r.den === 20) rows = rows.filter((x) => x.cls === "w");
        else if (early && r.den === 2) {
          rows = rows.filter((x) => x.cls === "2");
          out.byDesign = true;
        } else if (oneDigitOff(r.den, main)) {
          rows = rows.filter((x) => x.cls === "m");
          out.denCorrected = r.den;
          out.key = code + " " + r.num + "/" + main;
        } else {
          out.reason = "denominator_" + r.den + "_not_" + main;
          return out;
        }
      }
      // non-base printed codes (P25, J25, JTLP ...): the code identifies the series; denominator ignored
    }
    if (!rows.length) {
      out.reason = "no_printing";
      return out;
    }
    const byCard = new Map<number, CatRow[]>();
    for (let i = 0; i < rows.length; i++) {
      const x = rows[i];
      if (!byCard.has(x.card)) byCard.set(x.card, []);
      byCard.get(x.card)!.push(x);
    }
    byCard.forEach((prs, ci) => {
      const info = this.cardInfo(ci);
      out.cards.push({
        card: ci,
        name: info.name,
        subtitle: info.subtitle,
        type: info.type,
        home: info.home,
        printings: prs.map((p) => ({ vid: p.vid, vt: p.vt, src: p.src, num: p.num })),
      });
    });
    if (out.cards.length === 1 && !out.byDesign) {
      out.result = "exact";
      out.foilPick = out.cards[0].printings.length > 1;
    } else {
      out.result = "ambiguous";
      const srcSet: Record<string, boolean> = {};
      out.cards.forEach((c) => {
        c.printings.forEach((p) => {
          srcSet[p.src] = true;
        });
      });
      out.reason = out.byDesign
        ? "small_series_N_of_2"
        : Object.keys(srcSet).length > 1
          ? "printed_code_collision"
          : "several_cards";
    }
    return out;
  }

  // Full: raw -> parse -> validate every reading -> one decision
  evaluate(raw: unknown): Evaluation {
    const p = this.parse(raw);
    const ev: Evaluation = {
      parse: p,
      result: "invalid",
      reason: p.code ? "no_number" : "no_code",
      best: null,
      all: [],
    };
    if (!p.code || !p.readings.length) return ev;
    const code = p.code;
    const vals = p.readings.map((r) => {
      const v = this.validateOne(code, r);
      v.reading = r;
      return v;
    });
    ev.all = vals;
    const alts = (p.altReadings || [])
      .map((r) => {
        const v = this.validateOne(code, r);
        v.reading = r;
        return v;
      })
      .filter((v) => v.result !== "invalid");
    const exact = vals.filter((v) => v.result === "exact");
    const keys: Record<number, boolean> = {};
    exact.forEach((v) => {
      keys[v.cards[0].card] = true;
    });
    if (exact.length && Object.keys(keys).length === 1) {
      ev.result = "exact";
      ev.best = exact[0];
      ev.reason = "";
    } else if (exact.length > 1) {
      // two readings of the same token give different cards: never pick silently
      const merged: Validation = {
        key: exact.map((v) => v.key).join(" | "),
        result: "ambiguous",
        reason: "reading_conflict",
        cards: [],
        foilPick: false,
        byDesign: false,
      };
      exact.forEach((v) => {
        merged.cards = merged.cards.concat(v.cards);
      });
      ev.result = "ambiguous";
      ev.best = merged;
      ev.reason = "reading_conflict";
    } else {
      const amb = vals.filter((v) => v.result === "ambiguous");
      if (amb.length) {
        ev.result = "ambiguous";
        ev.best = amb[0];
        ev.reason = amb[0].reason;
      } else {
        ev.result = "invalid";
        ev.best = vals[0];
        ev.reason = vals[0].reason;
      }
    }
    if (ev.result === "invalid" && alts.length && p.code) {
      // the right-most number is not valid but an earlier one is: never auto-accept it, offer it as a pick
      let cards: CandidateCard[] = [];
      alts.forEach((v) => {
        cards = cards.concat(v.cards);
      });
      ev.best = {
        key: alts.map((v) => v.key).join(" | "),
        result: "ambiguous",
        reason: "number_conflict",
        cards,
        foilPick: false,
        byDesign: false,
      };
      ev.result = "ambiguous";
      ev.reason = "number_conflict";
    } else if (ev.result !== "invalid" && alts.length) {
      const have: Record<number, boolean> = {};
      (ev.best!.cards || []).forEach((c) => {
        have[c.card] = true;
      });
      const extra: CandidateCard[] = [];
      alts.forEach((v) => {
        v.cards.forEach((c) => {
          if (!have[c.card]) {
            have[c.card] = true;
            extra.push(c);
          }
        });
      });
      if (extra.length) {
        ev.best = {
          key: ev.best!.key + " | " + alts.map((v) => v.key).join(" | "),
          result: "ambiguous",
          reason: "number_conflict",
          cards: (ev.best!.cards || []).concat(extra),
          foilPick: false,
          byDesign: false,
        };
        ev.result = "ambiguous";
        ev.reason = "number_conflict";
      }
    }
    return ev;
  }

  // ---------------------------------------------------------------- v0.4: key strength
  // weak = no denominator, OR the number has a one-digit-different neighbour (same length) that is also a valid key of the
  // same code and denominator form. (From the catalogue this makes nearly every key weak; computed and cached per key.)
  keyStrength(
    code: string,
    r: { num: number; den: number | null; denRaw?: string | null; token: boolean }
  ): KeyStrength {
    const k = tripleKey(code, r);
    if (this._ks[k]) return this._ks[k];
    let weak = r.den == null;
    let why: string | null = weak ? "no_denominator" : null;
    const numS = String(r.num);
    if (!weak) {
      for (let i = 0; i < numS.length && !weak; i++) {
        for (let dgt = 0; dgt <= 9 && !weak; dgt++) {
          const ch = String(dgt);
          if (ch === numS[i]) continue;
          const alt = numS.slice(0, i) + ch + numS.slice(i + 1);
          if (alt[0] === "0" && alt.length > 1) continue;
          const v = this.validateOne(code, {
            num: parseInt(alt, 10),
            den: r.den,
            denRaw: r.denRaw,
            token: r.token,
          });
          if (v.result !== "invalid") {
            weak = true;
            why = "neighbour_" + alt;
          }
        }
      }
    }
    return (this._ks[k] = { strength: weak ? "weak" : "strong", why: why || "no_neighbour" });
  }
}

// C: a no-denominator number shorter than the digit run the digits-only pass saw is not trusted ("ASH 1" vs "795")
export function numLenConflict(
  reading: { num: number; den: number | null } | null | undefined,
  pass2Text: string | null | undefined
): { parsed_len: number; pass2_len: number; pass2_text: string } | null {
  if (!reading || reading.den != null || !pass2Text) return null;
  const runs = String(pass2Text).match(/\d+/g) || [];
  let longest = 0;
  runs.forEach((x) => {
    if (x.length > longest) longest = x.length;
  });
  const mine = String(reading.num).length;
  return longest > mine ? { parsed_len: mine, pass2_len: longest, pass2_text: pass2Text } : null;
}

// ---------------------------------------------------------------- v0.4: acceptance state machine (pure, testable)
// feed({t, result: exact|ambiguous|invalid|skipped, key, conf, weak, small}) -> decision

export interface AcceptorOptions {
  rearmGoneMs?: number;
  rearmDiffN?: number;
  dupMs?: number;
  confBar?: Record<string, number>;
}

export interface FeedInput {
  t: number;
  result: ReadResult | "skipped";
  key?: string | null;
  conf?: number | null;
  weak?: boolean;
  small?: boolean;
  reader?: string;
}

export interface Decision {
  state: string;
  accept: boolean;
  key: string | null;
  rearm?: {
    why: string;
    ms_since_match: number;
    ocr_reads_since_match: number;
    diff_key: string | null;
    diff_n: number;
  };
  conf_bar?: Record<string, number>;
  agree_by_reader?: Record<string, number>;
  conf_by_reader?: Record<string, number>;
  window?: (string | null)[];
  agree?: number;
  conf_used?: number | null;
  key_strength?: "weak" | "strong";
  dup_ms?: number;
}

interface HistEntry {
  key: string | null;
  conf: number | null | undefined;
  t: number;
  reader: string;
}

interface Blocked {
  key: string;
  t: number;
  lastMatchT: number;
  ocrSince: number;
  diffKey: string | null;
  diffN: number;
}

export class Acceptor {
  REARM_GONE_MS: number;
  REARM_DIFF_N: number;
  DUP_MS: number;
  WEAK_N = 3;
  WEAK_OF = 4;
  // v0.4.1: confidence bar per reader (Tesseract 0-100 scale sits lower than Paddle's); unknown readers use 'default'
  CONF_BAR: Record<string, number>;
  hist: HistEntry[] = []; // last OCR'd reads: {key|null, conf, t}
  blocked: Blocked | null = null; // {key, t, lastMatchT, ocrSince, diffKey, diffN}
  last: { key: string; t: number } | null = null; // {key, t} of the last accept

  constructor(opts: AcceptorOptions = {}) {
    this.REARM_GONE_MS = opts.rearmGoneMs || 1000;
    this.REARM_DIFF_N = opts.rearmDiffN || 3;
    this.DUP_MS = opts.dupMs || 2000;
    this.CONF_BAR = opts.confBar || { tesseract: 30, paddle: 60, default: 40 };
    this.reset();
  }

  reset(): void {
    this.hist = [];
    this.blocked = null;
    this.last = null;
  }

  markAccepted(key: string, t: number): void {
    this.blocked = { key, t, lastMatchT: t, ocrSince: 0, diffKey: null, diffN: 0 };
    this.last = { key, t };
    this.hist = [];
  }

  feed(r: FeedInput): Decision {
    const d: Decision = { state: "none", accept: false, key: r.key || null };
    if (r.result === "skipped") {
      d.state = this.blocked ? "hold" : "skipped"; // blur skips are neutral
      return d;
    }
    const good = r.result === "exact" && !r.small;
    // ---- blocked: is the accepted card still there?
    if (this.blocked) {
      const b = this.blocked;
      if (good && r.key === b.key) {
        b.lastMatchT = r.t;
        b.ocrSince = 0;
        b.diffKey = null;
        b.diffN = 0;
        d.state = "hold";
        return d;
      }
      b.ocrSince++;
      if (good) {
        if (b.diffKey === r.key) b.diffN++;
        else {
          b.diffKey = r.key ?? null;
          b.diffN = 1;
        }
      } else {
        b.diffKey = null;
        b.diffN = 0;
      }
      let why: string | null = null;
      if (b.diffN >= this.REARM_DIFF_N) why = "different_key_x" + b.diffN;
      else if (r.t - b.lastMatchT >= this.REARM_GONE_MS && b.ocrSince >= 2)
        why = "no_match_" + (r.t - b.lastMatchT) + "ms";
      if (!why) {
        this.hist.push({
          key: good ? (r.key ?? null) : null,
          conf: r.conf,
          t: r.t,
          reader: r.reader || "tesseract",
        });
        this.trim();
        d.state = "hold";
        return d;
      }
      d.rearm = {
        why,
        ms_since_match: Math.round(r.t - b.lastMatchT),
        ocr_reads_since_match: b.ocrSince,
        diff_key: b.diffKey,
        diff_n: b.diffN,
      };
      this.blocked = null;
      // the reads that proved a different card keep counting toward its acceptance
    }
    this.hist.push({
      key: good ? (r.key ?? null) : null,
      conf: r.conf,
      t: r.t,
      reader: r.reader || "tesseract",
    });
    this.trim();
    if (!good) {
      d.state = r.result === "exact" ? "small" : r.result;
      return d;
    }
    // ---- agreement
    let win: HistEntry[];
    let agree: HistEntry[];
    let ok: boolean;
    let confUsed: number | null = null;
    if (r.weak) {
      win = this.hist.slice(-this.WEAK_OF);
      agree = win.filter((h) => h.key === r.key);
      // each agreeing read's confidence is divided by its own reader's bar; the median of those ratios must reach 1
      const bars = this.CONF_BAR;
      const med = (a: number[]): number => {
        a = a.slice().sort((x, y) => x - y);
        return a.length
          ? a.length % 2
            ? a[a.length >> 1]
            : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
          : 0;
      };
      const ratios = agree.map((h) => {
        const bar = bars[h.reader] != null ? bars[h.reader] : bars["default"];
        return (h.conf == null ? 0 : h.conf) / bar;
      });
      confUsed = Math.round(med(ratios) * 100) / 100;
      d.conf_bar = {};
      d.agree_by_reader = {};
      d.conf_by_reader = {};
      const confByReader: Record<string, number[]> = {};
      agree.forEach((h) => {
        d.agree_by_reader![h.reader] = (d.agree_by_reader![h.reader] || 0) + 1;
        d.conf_bar![h.reader] = bars[h.reader] != null ? bars[h.reader] : bars["default"];
        (confByReader[h.reader] = confByReader[h.reader] || []).push(h.conf as number);
      });
      Object.keys(confByReader).forEach((k) => {
        d.conf_by_reader![k] = med(confByReader[k]);
      });
      ok = agree.length >= this.WEAK_N && confUsed >= 1;
    } else {
      win = this.hist.slice(-2);
      ok =
        win.length === 2 &&
        win[0].key === r.key &&
        win[1].key === r.key &&
        win[1].t - win[0].t >= 150;
      agree = win.filter((h) => h.key === r.key);
      d.agree_by_reader = {};
      agree.forEach((h) => {
        d.agree_by_reader![h.reader] = (d.agree_by_reader![h.reader] || 0) + 1;
      });
    }
    d.window = win.map((h) => h.key);
    d.agree = agree.length;
    d.conf_used = confUsed;
    d.key_strength = r.weak ? "weak" : "strong";
    if (!ok) {
      d.state = "confirming";
      return d;
    }
    if (this.last && this.last.key === r.key && r.t - this.last.t < this.DUP_MS) {
      d.state = "dup";
      d.dup_ms = Math.round(r.t - this.last.t);
      return d;
    }
    d.state = "accept";
    d.accept = true;
    this.markAccepted(r.key as string, r.t);
    return d;
  }

  trim(): void {
    if (this.hist.length > 8) this.hist.splice(0, this.hist.length - 8);
  }
}
