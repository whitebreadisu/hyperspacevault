// The generator's command line (scripts/public-pages/generate.mjs), parsed
// strictly: an unknown flag, a missing value or an ambiguous mode is an
// error, never a default. The deploy steps in ci.yml and the promote-prod
// action call it; a typo there must fail the deploy, not quietly turn a
// guard off.
//
//   npm run public-pages -- --catalog FILE --origin ORIGIN [common]
//   npm run public-pages -- --backend URL --expect-sha SHA --origin ORIGIN [common]
//
//   common: [--allow-shrink [true|false]] [--override-name TEXT]
//           [--images-bucket NAME] [--images off|auto|bucket|probe]
//           [--summary FILE] [--dist DIR]
//   env:    PUBLIC_PAGES_NOINDEX=true|false (dev deploys: true)
//           GCS_ACCESS_TOKEN (the bucket listing's bearer token)
//
// --catalog mode reads no live site and checks no images (local runs and the
// CI fixture check). --origin drives the sitemaps' URLs and every live read
// (sitemaps, manifest, image probe); the canonical URL is always
// https://www.hyperspacevault.com (head.ts), whatever --origin says.

export const USAGE =
  "usage: generate.mjs (--catalog FILE | --backend URL --expect-sha SHA) --origin ORIGIN " +
  "[--allow-shrink [true|false]] [--override-name TEXT] [--images-bucket NAME] " +
  "[--images off|auto|bucket|probe] [--summary FILE] [--dist DIR]";

export const IMAGE_MODES = ["off", "auto", "bucket", "probe"];

const VALUED = new Set([
  "--catalog",
  "--backend",
  "--expect-sha",
  "--origin",
  "--override-name",
  "--images-bucket",
  "--images",
  "--summary",
  "--dist",
]);

export class UsageError extends Error {
  constructor(message) {
    super(`${message}\n${USAGE}`);
    this.name = "UsageError";
  }
}

function httpUrl(flag, value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new UsageError(`${flag} is not a URL: ${value}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new UsageError(`${flag} must be an http(s) URL: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @param {Record<string, string | undefined>} env
 */
export function parseArgs(argv, env = {}) {
  const raw = {};
  let allowShrink = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-shrink") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        allowShrink = true;
      } else if (next === "true" || next === "false") {
        allowShrink = next === "true";
        i += 1;
      } else {
        throw new UsageError(`--allow-shrink takes true or false, not "${next}"`);
      }
      continue;
    }
    if (!VALUED.has(a)) throw new UsageError(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--") || v === "") {
      throw new UsageError(`${a} needs a value`);
    }
    if (a in raw) throw new UsageError(`${a} given twice`);
    raw[a] = v;
    i += 1;
  }

  const catalog = raw["--catalog"];
  const backend = raw["--backend"];
  if (catalog && (backend || raw["--expect-sha"])) {
    throw new UsageError("--catalog cannot be combined with --backend / --expect-sha");
  }
  if (!catalog && !backend) throw new UsageError("give --catalog FILE or --backend URL");
  if (backend && !raw["--expect-sha"]) throw new UsageError("--backend needs --expect-sha");
  if (!raw["--origin"]) throw new UsageError("--origin is required");

  const images = raw["--images"] ?? (catalog ? "off" : "auto");
  if (!IMAGE_MODES.includes(images)) {
    throw new UsageError(`--images must be one of ${IMAGE_MODES.join(", ")}`);
  }
  if (catalog && images !== "off") {
    throw new UsageError("--catalog mode checks no images (--images off)");
  }

  const nx = env.PUBLIC_PAGES_NOINDEX;
  if (nx !== undefined && nx !== "" && nx !== "true" && nx !== "false") {
    throw new UsageError(`PUBLIC_PAGES_NOINDEX must be true or false, not "${nx}"`);
  }

  return {
    mode: catalog ? "catalog" : "backend",
    catalog: catalog ?? null,
    backend: backend ? httpUrl("--backend", backend) : null,
    expectSha: raw["--expect-sha"] ?? null,
    origin: httpUrl("--origin", raw["--origin"]),
    allowShrink,
    overrideName: raw["--override-name"] ?? "--allow-shrink",
    imagesBucket: raw["--images-bucket"] ?? null,
    images,
    summary: raw["--summary"] ?? null,
    dist: raw["--dist"] ?? "dist",
    noindex: nx === "true",
    token: env.GCS_ACCESS_TOKEN || null,
  };
}
