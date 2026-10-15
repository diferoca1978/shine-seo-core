// URLs: every URL a page uses, and how a URL is classified (same-site or external,
// page or asset). What the url-* rules and asset-missing look at, cached per page.

import { elements, parsedBlocks, relTokens } from "./html.mjs";
import { imageCdnSource, urlKind } from "./util.mjs";

// ---------------------------------------------------------------------------
// URLs — what the url-* rules and asset-missing look at, cached per page
// ---------------------------------------------------------------------------

const urlCache = new WeakMap();
const META_URL_KEYS = ["og:url", "og:image", "twitter:image"];
const JSONLD_PATH_KEYS = new Set(["url", "item", "logo", "image", "sameAs"]);

function withoutHash(url) {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

const bareHost = (url) => new URL(url).hostname.replace(/^www\./, "");

/** Same hostname as the origin, ignoring the scheme and a leading "www.". */
function isSameSite(url, origin) {
  try {
    return bareHost(url) === bareHost(origin);
  } catch {
    return false;
  }
}

function isSchemaOrgUrl(url) {
  try {
    return bareHost(url) === "schema.org";
  } catch {
    return false;
  }
}

/** The base for the page's relative URLs: its first <base href>, else its own URL. */
function baseOf(page) {
  const base = elements(page, "base").find((t) => t.attrs.href !== undefined);
  if (base) {
    try {
      return new URL(base.attrs.href.trim(), page.url).href;
    } catch {
      // an unusable <base href> is ignored
    }
  }
  return page.url;
}

/**
 * Every string in a JSON-LD value with its nearest object key (array indexes
 * are skipped over). Nothing under @context, and no @id value.
 */
function* walkStrings(value, key = "") {
  if (typeof value === "string") {
    yield { key, value };
  } else if (Array.isArray(value)) {
    for (const item of value) yield* walkStrings(item, key);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k !== "@context" && k !== "@id") yield* walkStrings(v, k);
    }
  }
}

/**
 * Every URL occurrence on the page, in document order:
 *   [{ raw, url, where, jsonld, relative }]
 *   raw       as written
 *   url       absolute (resolved against baseOf(page)), #fragment removed
 *   where     e.g. "<a href>", "og:image", "JSON-LD logo"
 *   jsonld    it comes from a JSON-LD block
 *   relative  a JSON-LD "/..." string (always fails url-canonical-form)
 * Left out: empty and "#..." values, schemes other than http(s) (mailto:,
 * tel:, javascript:, data:...), and values that do not parse as a URL.
 */
function urlsOf(page) {
  let urls = urlCache.get(page);
  if (urls) return urls;
  urls = [];
  const base = baseOf(page);
  const add = (raw, where, jsonld = false) => {
    const value = raw.trim();
    if (value === "" || value.startsWith("#")) return;
    let u;
    try {
      u = new URL(value, base);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    u.hash = "";
    const relative = jsonld && value.startsWith("/");
    urls.push({ raw: value, url: u.href, where, jsonld, relative });
  };

  for (const t of elements(page, "a")) {
    if (t.attrs.href !== undefined) add(t.attrs.href, "<a href>");
  }
  for (const t of elements(page, "img")) {
    if (t.attrs.src !== undefined) add(t.attrs.src, "<img src>");
  }
  for (const t of elements(page, "link")) {
    if (t.attrs.href === undefined) continue;
    if (relTokens(t).includes("canonical")) {
      add(t.attrs.href, '<link rel="canonical">');
    } else if ((t.attrs.rel ?? "").toLowerCase().includes("icon")) {
      add(t.attrs.href, `<link rel="${t.attrs.rel.trim()}">`);
    }
  }
  for (const t of elements(page, "meta")) {
    const key = (t.attrs.property ?? t.attrs.name ?? "").trim().toLowerCase();
    if (META_URL_KEYS.includes(key) && t.attrs.content !== undefined) {
      add(t.attrs.content, key);
    }
  }
  for (const block of parsedBlocks(page)) {
    for (const { key, value } of walkStrings(block.data)) {
      if (/^https?:\/\//i.test(value)) {
        if (!isSchemaOrgUrl(value)) add(value, `JSON-LD ${key}`, true);
      } else if (value.startsWith("/") && JSONLD_PATH_KEYS.has(key)) {
        add(value, `JSON-LD ${key}`, true);
      }
    }
  }
  urlCache.set(page, urls);
  return urls;
}

/**
 * Groups occurrences into distinct URLs (one finding each): the same absolute
 * URL is one entry, and a relative JSON-LD URL is its own entry. `where`
 * lists every place the URL appeared; `raw` is how it was first written.
 */
function distinctUrls(occurrences) {
  const byKey = new Map();
  for (const o of occurrences) {
    const key = `${o.url}\n${o.relative}`;
    const entry = byKey.get(key);
    if (entry) entry.places.add(o.where);
    else byKey.set(key, { ...o, places: new Set([o.where]) });
  }
  return [...byKey.values()].map(({ places, ...o }) => ({
    ...o,
    where: [...places].join(", "),
  }));
}

const describe = (u) => `${u.raw} (${u.where})`;

/** urlKind() of an absolute URL's pathname; an image-CDN URL is always an asset. */
const pathKind = (url) =>
  imageCdnSource(url) !== null ? "asset" : urlKind(new URL(url).pathname);

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** URLs captured inside markdown-style links ([text](url)) in `text`, as written (not resolved). */
function markdownLinks(text) {
  return [...text.matchAll(MARKDOWN_LINK)].map((m) => m[1]);
}
/**
 * The pathname of `url` if it has an uppercase letter (Unicode Lu), else null.
 * It is percent-decoded first, the same test as siteUrl() in src/url.ts.
 * With malformed percent-encoding, every %XX escape is dropped instead, so only
 * literal letters count, and the pathname is returned as written.
 */
function uppercasePath(url) {
  const pathname = new URL(url).pathname;
  let decoded = null;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // malformed percent-encoding: tested without its escapes, below
  }
  const tested = decoded ?? pathname.replace(/%[0-9A-Fa-f]{2}/g, "");
  return /\p{Lu}/u.test(tested) ? (decoded ?? pathname) : null;
}

/** url-lowercase over a list of occurrences (a page's, or a sitemap's). */
function uppercasePageUrls(occurrences, site) {
  const pages = occurrences.filter(
    (o) => isSameSite(o.url, site.origin) && pathKind(o.url) === "page",
  );
  const findings = [];
  for (const u of distinctUrls(pages)) {
    const shown = uppercasePath(u.url);
    if (shown !== null) {
      findings.push(
        `${describe(u)} has an uppercase letter in its path: ${shown}`,
      );
    }
  }
  return findings;
}

/** A page's own URL as an occurrence, so url-lowercase merges it with the same URL on the page. */
const ownUrlOccurrence = (page) => ({
  raw: page.url,
  url: page.url,
  where: "own URL",
  jsonld: false,
  relative: false,
});

export {
  baseOf,
  describe,
  distinctUrls,
  isSameSite,
  isSchemaOrgUrl,
  markdownLinks,
  ownUrlOccurrence,
  pathKind,
  uppercasePageUrls,
  uppercasePath,
  urlsOf,
  withoutHash,
};
