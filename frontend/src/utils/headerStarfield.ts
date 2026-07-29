/** BL-165: the app-header starfield is randomly selected once per app open
 * instead of hardcoding ASH. Pool = the nine shipped starfields (TS26 is a
 * base set but has NO starfield asset yet -- it joins the pool when one
 * exists; index.css's `var(--header-starfield, url(.../starfield_ASH.jpg))`
 * keeps ASH as the no-JS fallback either way).
 *
 * Random flavor (recorded build-time decision per the BL-165 entry):
 * no-repeat-of-last -- localStorage remembers the previous pick and the next
 * open draws from the other eight, because a repeat reads as "it didn't
 * change" rather than as randomness. */

export const HEADER_STARFIELD_CODES = [
  "SOR",
  "SHD",
  "TWI",
  "JTL",
  "LOF",
  "SEC",
  "LAW",
  "ASH",
  "IBH",
] as const;

const LAST_PICK_KEY = "swu.headerStarfield.last";

/** Pure picker: a uniformly random code, excluding `last` when it's a valid
 * pool member (so a corrupt/absent stored value degrades to pure random). */
export function pickHeaderStarfield(
  last: string | null,
  random: () => number = Math.random
): string {
  const pool = HEADER_STARFIELD_CODES.filter((c) => c !== last);
  return pool[Math.floor(random() * pool.length)];
}

/** Called once from App on mount: picks, remembers, and sets the CSS custom
 * property `--header-starfield` on the document root (index.css layers it
 * under the header's gradient). localStorage access is best-effort --
 * private-mode/storage-denied environments just get pure random. */
export function applyHeaderStarfield(): string {
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(LAST_PICK_KEY);
  } catch {
    /* storage unavailable -- pure random */
  }
  const code = pickHeaderStarfield(last);
  try {
    window.localStorage.setItem(LAST_PICK_KEY, code);
  } catch {
    /* best-effort */
  }
  document.documentElement.style.setProperty(
    "--header-starfield",
    `url("/images/starfields/starfield_${code}.jpg")`
  );
  return code;
}
