#!/usr/bin/env bash
# Post-deploy smoke for the public card pages (design note §8 "Deploy smoke"),
# run by deploy-dev and the promote-prod action right after `firebase deploy`:
#
#   bash .github/scripts/card_pages_smoke.sh <origin> <noindex|index> <distDir>
#
#   - three card URLs sampled from the dist just deployed (first, middle,
#     last): 200 with Content-Type text/html;
#   - /cards/sor/005 (no slash) gives a 301 to /cards/sor/005/ (Hosting's
#     native directory redirect, design note §2);
#   - /sitemap.xml is a sitemap index (200) and /sitemaps/cards-sor.xml is 200;
#   - the robots noindex meta is PRESENT on every sampled page when
#     `noindex` (dev) and ABSENT when `index` (prod: a prod page with
#     noindex silently deindexes the site);
#   - one same-origin card image the sampled pages load carries
#     `X-Robots-Tag: noindex` (design note §5a part E).
set -euo pipefail

origin="${1:?origin}"
origin="${origin%/}"
mode="${2:?noindex|index}"
dist="${3:?distDir}"
case "$mode" in noindex|index) ;; *) echo "::error::mode must be noindex or index"; exit 2 ;; esac

fail=0
err() { echo "::error::card pages smoke: $*"; fail=1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mapfile -t pages < <(cd "$dist" && find cards -mindepth 3 -maxdepth 3 -name index.html | sort)
if [ "${#pages[@]}" -eq 0 ]; then
  echo "::error::card pages smoke: no card pages in $dist"
  exit 1
fi
n=${#pages[@]}
samples=("${pages[0]}" "${pages[$((n / 2))]}" "${pages[$((n - 1))]}")

curl_retry=(--retry 3 --retry-delay 5 --retry-all-errors -sS)
image=""
for rel in "${samples[@]}"; do
  path="/${rel%index.html}"
  out="$tmp/page.html"
  read -r code ctype < <(curl "${curl_retry[@]}" -D "$tmp/page.h" -o "$out" -w '%{http_code} %{content_type}\n' "$origin$path")
  echo "GET $path -> $code $ctype"
  [ "$code" = "200" ] || err "$path returned $code"
  case "$ctype" in text/html*) ;; *) err "$path Content-Type is '$ctype'" ;; esac
  # Any <meta> naming robots or googlebot AND noindex, in any attribute order
  # or quote style (one tag per line first, so a match cannot span tags).
  if tr '>' '\n' < "$out" | grep -iE '<meta' | grep -iE 'robots|googlebot' | grep -qi 'noindex'; then
    has_noindex=yes
  else
    has_noindex=no
  fi
  if [ "$mode" = "noindex" ] && [ "$has_noindex" = "no" ]; then err "$path has no robots noindex meta (dev)"; fi
  if [ "$mode" = "index" ] && [ "$has_noindex" = "yes" ]; then err "$path carries a robots noindex meta on prod"; fi
  # A response header does the same as the meta: prod pages must carry none.
  if [ "$mode" = "index" ] && grep -qiE '^x-robots-tag:.*noindex' "$tmp/page.h"; then
    err "$path is served with an X-Robots-Tag noindex header on prod"
  fi
  if [ -z "$image" ]; then
    image="$(grep -oE '/images/cards/[A-Za-z0-9_-]+_320\.webp' "$out" | head -n 1 || true)"
  fi
done

read -r code location < <(curl "${curl_retry[@]}" -o /dev/null -w '%{http_code} %{redirect_url}\n' "$origin/cards/sor/005")
location="${location%$'\r'}"
echo "GET /cards/sor/005 -> $code $location"
[ "$code" = "301" ] || err "/cards/sor/005 returned $code (want 301)"
case "$location" in */cards/sor/005/) ;; *) err "/cards/sor/005 redirects to '$location'" ;; esac

code="$(curl "${curl_retry[@]}" -o "$tmp/index.xml" -w '%{http_code}' "$origin/sitemap.xml")"
echo "GET /sitemap.xml -> $code"
[ "$code" = "200" ] || err "/sitemap.xml returned $code"
grep -q '<sitemapindex' "$tmp/index.xml" || err "/sitemap.xml is not a sitemap index"
code="$(curl "${curl_retry[@]}" -o /dev/null -w '%{http_code}' "$origin/sitemaps/cards-sor.xml")"
echo "GET /sitemaps/cards-sor.xml -> $code"
[ "$code" = "200" ] || err "/sitemaps/cards-sor.xml returned $code"

if [ -z "$image" ]; then
  # Every sample may show the placeholder (art not mirrored); take any page's.
  image="$(grep -rhoE '/images/cards/[A-Za-z0-9_-]+_320\.webp' "$dist/cards" | head -n 1 || true)"
fi
if [ -z "$image" ]; then
  err "no page loads a /images/cards/*_320.webp image to check"
else
  curl "${curl_retry[@]}" -o /dev/null -D "$tmp/img.h" "$origin$image"
  echo "GET $image -> $(head -n 1 "$tmp/img.h" | tr -d "\r")"
  grep -qiE '^x-robots-tag:.*noindex' "$tmp/img.h" || err "$image has no X-Robots-Tag: noindex"
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "card pages smoke ($mode) on $origin: OK"
