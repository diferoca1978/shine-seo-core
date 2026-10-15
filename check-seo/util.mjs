// Small helpers shared by every check-seo module.

import path from "node:path";

/** Usage errors and unreadable input. The CLI exits 2 on them, even with --report. */
export class InputError extends Error {
  constructor(message, { usage = false } = {}) {
    super(message);
    this.usage = usage;
  }
}

/** The origin of an absolute http(s) URL, or null. */
export function httpOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Two absolute URLs are equal once parsed (host case, empty path → "/"). */
export function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

export const isBlank = (s) => s.trim() === "";
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "page" if the path has no extension or ends in .html, else "asset".
 * Works on an encoded or a decoded pathname.
 */
export function urlKind(pathname) {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  const ext = path.posix.extname(last).toLowerCase();
  return ext === "" || ext === ".html" ? "page" : "asset";
}

/**
 * The image an image-CDN URL serves, as written in the URL (a path on the site, with
 * or without its leading "/", or an absolute URL), or null for any other URL. An
 * <Image> becomes one of these, depending on the host and the image service, and its
 * pathname has no extension, so urlKind() alone would read it as a page:
 *   Netlify      /.netlify/images?url=<src>&w=…   (@astrojs/netlify)
 *   Astro        /_image?href=<src>&w=…           (an on-demand image endpoint)
 *   Cloudflare   /cdn-cgi/image/<options>/<src>   (Cloudflare Images)
 * Only those exact pathnames with a non-empty source match.
 */
export function imageCdnSource(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.pathname === "/.netlify/images") return u.searchParams.get("url") || null;
  if (u.pathname === "/_image") return u.searchParams.get("href") || null;
  const cloudflare = u.pathname.match(/^\/cdn-cgi\/image\/[^/]+\/(.+)$/);
  return cloudflare ? cloudflare[1] : null;
}
