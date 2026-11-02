// The image check (design note §5a, "No hotlinking"): which card images have
// their 320 px rendition (`cards/<stem>_320.webp`) in the environment's
// card-images bucket. A page renders the placeholder panel instead of an
// <img> for any printing whose stem is missing, so a public page never
// triggers the backend's 307 to the official CDN.
//
//   primary   list the bucket `<project>-card-images` (terraform/modules/app/
//             card_images.tf) through the GCS JSON API with a bearer token
//             (CI: `gcloud auth print-access-token` after the WIF auth step;
//             terraform-ci holds roles/storage.objectAdmin on the bucket,
//             which includes storage.objects.list);
//   fallback  probe each image through the site origin. A GET, not a HEAD:
//             the backend route is a FastAPI GET route, and FastAPI answers
//             HEAD with 405. The body is cancelled once the status is known;
//             redirects are not followed (a 307 = not mirrored).

export const RENDITION_SUFFIX = "_320.webp";
const PATH_RE = /^\/images\/cards\/([A-Za-z0-9_-]+)_320\.webp$/;

/** "/images/cards/<stem>_320.webp" -> "<stem>", anything else -> null. */
export function stemFromPath(path) {
  const m = PATH_RE.exec(path ?? "");
  return m ? m[1] : null;
}

/** Every distinct 320 px stem a catalog's printings reference (front and
 * back), tokens excluded (they get no page). */
export function catalogStems(catalog) {
  const stems = new Set();
  for (const c of catalog.cards) {
    if (c.is_token) continue;
    for (const v of c.variants) {
      for (const imgs of [v.front_images, v.back_images]) {
        const s = stemFromPath(imgs?.w320);
        if (s) stems.add(s);
      }
    }
  }
  return stems;
}

/**
 * Lists `cards/*_320.webp` in a GCS bucket.
 * @returns {Promise<Set<string>>} stems present
 */
export async function listBucketStems({
  bucket,
  token,
  fetch = globalThis.fetch,
  pageSize = 5000,
}) {
  if (!bucket) throw new Error("listBucketStems: bucket is required");
  if (!token) throw new Error("listBucketStems: token is required");
  const stems = new Set();
  let pageToken = "";
  for (;;) {
    const q = new URLSearchParams({
      prefix: "cards/",
      matchGlob: `cards/*${RENDITION_SUFFIX}`,
      fields: "items(name),nextPageToken",
      maxResults: String(pageSize),
    });
    if (pageToken) q.set("pageToken", pageToken);
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${q}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list gs://${bucket}: HTTP ${res.status}`);
    const body = await res.json();
    for (const it of body.items ?? []) {
      const name = String(it.name);
      if (name.startsWith("cards/") && name.endsWith(RENDITION_SUFFIX)) {
        stems.add(name.slice("cards/".length, -RENDITION_SUFFIX.length));
      }
    }
    if (!body.nextPageToken) return stems;
    pageToken = body.nextPageToken;
  }
}

async function pool(items, concurrency, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

/**
 * Probes `<origin>/images/cards/<stem>_320.webp` for each stem.
 * 200 = present; 3xx (the backend's 307 to the CDN) or 404 = missing;
 * anything else (5xx, network) is retried once, then counted as an error.
 * More than `maxErrors` errors throws: an outage must not blank the art.
 * @returns {Promise<Set<string>>} stems present
 */
export async function probeStems({
  origin,
  stems,
  fetch = globalThis.fetch,
  concurrency = 8,
  maxErrors = 0,
}) {
  const base = origin.replace(/\/+$/, "");
  const present = new Set();
  const errors = [];
  const probe = async (stem) => {
    const url = `${base}/images/cards/${stem}${RENDITION_SUFFIX}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: "GET", redirect: "manual" });
        try {
          await res.body?.cancel();
        } catch {
          /* body already consumed or not cancellable */
        }
        if (res.status === 200) return void present.add(stem);
        if ((res.status >= 300 && res.status < 400) || res.status === 404) return;
        if (attempt === 1) errors.push(`${stem}: HTTP ${res.status}`);
      } catch (err) {
        if (attempt === 1) errors.push(`${stem}: ${err instanceof Error ? err.message : err}`);
      }
    }
  };
  await pool(stems, concurrency, probe);
  if (errors.length > maxErrors) {
    throw new Error(
      `image probe: ${errors.length} errors (first: ${errors.slice(0, 3).join("; ")})`
    );
  }
  return present;
}

/**
 * The check as the generator runs it: bucket listing when a bucket and token
 * are given, else (or when the listing fails) the origin probe. `mode: "off"`
 * skips both and treats every stem as present (local and fixture runs).
 * @returns {Promise<{ present: Set<string>, missing: string[], source: string, line: string }>}
 */
export async function imageAvailability({
  stems,
  bucket,
  token,
  origin,
  mode = "auto",
  fetch = globalThis.fetch,
  log = () => {},
  concurrency,
}) {
  const wanted = [...stems];
  let present;
  let source;
  if (mode === "off") {
    present = new Set(wanted);
    source = "not checked";
  } else {
    if (bucket && token && mode !== "probe") {
      try {
        const listed = await listBucketStems({ bucket, token, fetch });
        present = new Set(wanted.filter((s) => listed.has(s)));
        source = `bucket gs://${bucket}`;
      } catch (err) {
        log(
          `image check: bucket listing failed (${err instanceof Error ? err.message : err}); probing through ${origin}`
        );
      }
    }
    if (!present) {
      if (!origin) throw new Error("image check: no bucket listing and no origin to probe");
      present = await probeStems({ origin, stems: wanted, fetch, concurrency });
      source = `GET probe through ${origin}`;
    }
  }
  const missing = wanted.filter((s) => !present.has(s)).sort();
  return {
    present,
    missing,
    source,
    line: `image check (${source}): ${present.size} of ${wanted.length} 320 px images present, ${missing.length} render the placeholder`,
  };
}
