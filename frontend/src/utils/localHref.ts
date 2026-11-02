// A link target the public pages render from data (the page's embedded
// #card-data JSON at hydration): only a same-origin absolute path is kept --
// "/" then path, query and fragment characters, no scheme, no "//" or "/\"
// host, no "%", no space -- and anything else becomes "/" (the app). The
// generator only ever writes such paths (`/cards/sor/005/`, `/?card=sor-006`),
// so a kept value is unchanged by the final encodeURI; the encoding is there
// so no other shape can reach an href.

const LOCAL_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&#]*$/;

export function localHref(raw: string | null | undefined): string {
  return raw != null && LOCAL_PATH.test(raw) ? encodeURI(raw) : "/";
}
