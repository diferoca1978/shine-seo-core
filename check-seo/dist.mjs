// Input adapter: --dist <dir>. Turns a build into pages and a site context.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { makePage, readLocs } from "./html.mjs";
import { InputError, httpOrigin, imageCdnSource, urlKind } from "./util.mjs";

// Folders whose HTML is not a page of the site: Partytown 0.14 copies
// partytown-sandbox-sw.html into the build (noindex, no <title>, never linked).
const IGNORED_HTML_DIRS = ["~partytown/"];

/** Every file under `root`, as POSIX paths relative to it. */
async function listFiles(root) {
  const files = new Set();
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      throw new InputError(`cannot read ${rel || root}: ${err.message}`);
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(abs, entry.name), childRel);
      else if (entry.isFile() || entry.isSymbolicLink()) files.add(childRel);
    }
  }
  await walk(root, "");
  return files;
}


/** URL → the file path it names inside the build dir (decoded, no leading "/"). */
function localPath(url) {
  return decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
}

/**
 * Reads <dir>/sitemap-index.xml, or <dir>/sitemap.xml if there is no index,
 * following each child <loc> of an index to its local file by pathname.
 * Returns { root, pageLocs: [{ loc, source }] }, where source is the sitemap
 * file that lists the <loc>, or null when neither file exists.
 */
async function readDistSitemaps(dir, dirLabel, files) {
  const root = ["sitemap-index.xml", "sitemap.xml"].find((f) => files.has(f));
  if (!root) return null;
  const pageLocs = [];
  const seen = new Set();

  async function visit(rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    let xml;
    try {
      xml = await readFile(path.join(dir, rel), "utf8");
    } catch (err) {
      throw new InputError(`cannot read the sitemap ${rel}: ${err.message}`);
    }
    const locs = readLocs(xml);
    if (!/<sitemapindex[\s>]/.test(xml)) {
      for (const loc of locs) pageLocs.push({ loc, source: rel });
      return;
    }
    for (const loc of locs) {
      let child;
      try {
        child = localPath(loc);
      } catch {
        throw new InputError(
          `the sitemap ${rel} lists a child sitemap that is not a valid URL: ${loc}`,
        );
      }
      if (!files.has(child)) {
        throw new InputError(
          `the sitemap ${rel} lists ${loc}, but ${child} does not exist in ${dirLabel}`,
        );
      }
      await visit(child);
    }
  }

  await visit(root);
  return { root, pageLocs };
}

function originOfSitemap(sitemap) {
  if (!sitemap) {
    throw new InputError(
      "no sitemap-index.xml or sitemap.xml, so the origin is unknown: pass --site <origin>",
    );
  }
  const origins = new Set(
    sitemap.pageLocs.map(({ loc }) => httpOrigin(loc)).filter(Boolean),
  );
  if (origins.size === 0) {
    throw new InputError(
      `the sitemaps (${sitemap.root}) list no page <loc> to take the origin from: pass --site <origin>`,
    );
  }
  if (origins.size > 1) {
    throw new InputError(
      `the page <loc>s use more than one origin (${[...origins].join(", ")}): pass --site <origin>`,
    );
  }
  return [...origins][0];
}

/**
 * A page's own URL from its file:
 *   index.html → <origin>/ · <path>/index.html → <origin>/<path>/ · <name>.html → <origin>/<name>
 */
function ownUrl(rel, origin) {
  let p;
  if (rel === "index.html") p = "/";
  else if (rel.endsWith("/index.html"))
    p = `/${rel.slice(0, -"index.html".length)}`;
  else p = `/${rel.slice(0, -".html".length)}`;
  return new URL(p.replace(/[%?#\\]/g, encodeURIComponent), origin).href;
}

const notFound = (kind, reason) => ({
  exists: false,
  kind,
  page: null,
  inPageSet: false,
  target: null,
  reason,
});

/**
 * An on-demand route pattern from Astro (/contacto, /blog/[slug], /docs/[...path]) as
 * a test on a decoded pathname. The trailing slash is ignored on both sides.
 */
function routeMatcher(pattern) {
  const source = pattern
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) =>
      segment
        .replace(/[.*+?^${}()|\\]/g, "\\$&")
        .replace(/\\?\[\\?\.\\?\.\\?\.[^\]]*\]/g, ".*")
        .replace(/\[[^\]]+\]/g, "[^/]+"),
    )
    .join("/");
  const re = new RegExp(`^${source}/?$`);
  return (pathname) => re.test(pathname);
}

/**
 * Resolves a same-site URL against the build (only its pathname is used, except
 * for an image-CDN URL):
 *   ends in "/"    → <dir><path>index.html
 *   ends in .html  → that file
 *   no extension   → <dir><path>/index.html, then <dir><path>.html, then an
 *                    on-demand route (it exists, but has no HTML in the build)
 *   any other ext. → that file (an asset)
 *   an image-CDN URL (see imageCdnSource) → the image it serves
 * The lookup is case-sensitive on every file system (a Set of real names).
 */
function resolveInDist(url, ctx) {
  const { files, pagesByFile, onDemand, origin } = ctx;
  let encoded;
  try {
    encoded = new URL(url).pathname;
  } catch {
    return notFound(null, "not a valid URL");
  }
  const source = imageCdnSource(url);
  if (source !== null) return resolveImageInDist(source, ctx);
  let pathname;
  try {
    pathname = decodeURIComponent(encoded);
  } catch {
    return notFound(urlKind(encoded), "malformed percent-encoding in the path");
  }
  const kind = urlKind(pathname);
  let candidates;
  if (pathname.endsWith("/")) candidates = [`${pathname}index.html`];
  else if (kind === "page" && !pathname.toLowerCase().endsWith(".html")) {
    candidates = [`${pathname}/index.html`, `${pathname}.html`];
  } else candidates = [pathname];
  const rels = candidates.map((c) => c.replace(/^\/+/, ""));
  const target = rels.find((rel) => files.has(rel));
  if (target) {
    const page = pagesByFile.get(target) ?? null;
    return { exists: true, kind, page, inPageSet: page !== null, target, reason: null };
  }
  if (kind === "page" && onDemand.some((matches) => matches(pathname))) {
    return { exists: true, kind, page: null, inPageSet: false, target: pathname, reason: null };
  }
  return notFound(kind, `no file ${rels.join(" or ")}`);
}

/**
 * resolveInDist() for an image-CDN URL, given the source it names: always an asset.
 * A path on the site is the file it names (percent-decoded like any URL path; its
 * leading "/" is optional, as @astrojs/netlify drops it for an imported image). A
 * remote source (another host) cannot be checked in a build, so it counts as present.
 */
function resolveImageInDist(source, ctx) {
  let decoded;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    return notFound("asset", "malformed percent-encoding in its source");
  }
  let rel = decoded;
  if (/^https?:\/\//i.test(decoded)) {
    let u;
    try {
      u = new URL(decoded);
    } catch {
      return notFound("asset", `its source is not a valid URL: ${decoded}`);
    }
    if (u.hostname.replace(/^www\./, "") !== new URL(ctx.origin).hostname.replace(/^www\./, "")) {
      return { exists: true, kind: "asset", page: null, inPageSet: false, target: decoded, reason: null };
    }
    rel = decodeURIComponent(u.pathname);
  }
  rel = rel.replace(/^\/+/, "");
  if (ctx.files.has(rel)) {
    return { exists: true, kind: "asset", page: null, inPageSet: false, target: rel, reason: null };
  }
  return notFound("asset", `no file ${rel} (the image it serves)`);
}

/** llms.txt and llms/*.txt files present in the build: [{ label, text }]. */
async function readLlmsDocs(dir, files) {
  const docs = [];
  if (files.has("llms.txt")) {
    docs.push({
      label: "llms.txt",
      text: await readFile(path.join(dir, "llms.txt"), "utf8"),
    });
  }
  const leaves = [...files].filter((f) => /^llms\/[^/]+\.txt$/.test(f)).sort();
  for (const rel of leaves) {
    docs.push({
      label: rel,
      text: await readFile(path.join(dir, rel), "utf8"),
    });
  }
  return docs;
}

/**
 * Reads a build.
 *   dir        the folder with the HTML (astro:build:done's `dir`)
 *   origin     the site's origin; default: the one in the sitemaps' page <loc>s
 *   onDemand   on-demand route patterns (prerender = false): pages that exist but
 *              have no HTML in the build, e.g. ['/contacto', '/blog/[slug]']
 *   label      how the report names the folder (default: `dir` as given)
 */
async function loadDist({ dir: dirArg, origin: siteOrigin = null, onDemand = [], label }) {
  const dirLabel = label ?? dirArg;
  const dir = path.resolve(dirArg);
  let info;
  try {
    info = await stat(dir);
  } catch {
    throw new InputError(`--dist: ${dirLabel} does not exist`);
  }
  if (!info.isDirectory())
    throw new InputError(`--dist: ${dirLabel} is not a directory`);

  const files = await listFiles(dir);
  const sitemap = await readDistSitemaps(dir, dirLabel, files);
  const origin = siteOrigin ?? originOfSitemap(sitemap);

  const pages = [];
  const htmlFiles = [...files]
    .filter((f) => f.endsWith(".html"))
    .filter((f) => !IGNORED_HTML_DIRS.some((d) => f.startsWith(d)))
    .sort();
  for (const rel of htmlFiles) {
    let html;
    try {
      html = await readFile(path.join(dir, rel), "utf8");
    } catch (err) {
      throw new InputError(`cannot read ${rel}: ${err.message}`);
    }
    const is404 = rel === "404.html";
    pages.push(
      makePage({
        url: ownUrl(rel, origin),
        status: is404 ? 404 : 200,
        html,
        label: rel,
        is404,
      }),
    );
  }
  const ctx = {
    files,
    pagesByFile: new Map(pages.map((p) => [p.label, p])),
    onDemand: onDemand.map(routeMatcher),
    origin,
  };
  const llmsDocs = await readLlmsDocs(dir, files);
  const source = siteOrigin ? "given" : sitemap.root;

  return {
    heading: `check-seo --dist ${dirLabel} · origin ${origin} (${source})`,
    pages,
    site: {
      origin,
      pages,
      sitemap,
      llmsDocs,
      resolve: async (url) => resolveInDist(url, ctx),
    },
  };
}

export { loadDist, routeMatcher };
