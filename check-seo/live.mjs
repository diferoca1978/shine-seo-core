// Input adapter: --url <origin>. Reads the live site the same way as a crawler: its
// sitemaps, then every page they list, with no redirect followed. Nothing here depends
// on the host: any 3xx is a redirect (Netlify answers 301, Cloudflare 307).

import { makePage, readLocs } from "./html.mjs";
import { isSameSite, markdownLinks, pathKind, urlsOf } from "./urls.mjs";
import { InputError } from "./util.mjs";

// ---------------------------------------------------------------------------
// Input adapter: --url <origin>
// ---------------------------------------------------------------------------

const USER_AGENT = "shine-seo-core-check-seo";
const TIMEOUT_MS = 10_000;
const MAX_PARALLEL = 4;

/** Runs the jobs it is given, at most `max` at a time. */
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { job, resolve, reject } = queue.shift();
    job()
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (job) =>
    new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      next();
    });
}

/** A short reason for a failed fetch (the error code when there is one). */
function fetchError(err) {
  if (err?.name === "TimeoutError") {
    return `no answer in ${TIMEOUT_MS / 1000} s`;
  }
  const cause = err?.cause;
  const code =
    cause?.code ?? cause?.errors?.find((e) => e?.code)?.code ?? cause?.message;
  return `request failed${code ? ` (${code})` : ""}`;
}

/**
 * The run's HTTP client. Every request: redirects not followed, a 10 s
 * timeout, the check-seo User-Agent, at most 4 at a time, and each
 * (method, URL) sent once. A response is { status, location, body } (body
 * only when asked for and the status is 2xx) or { error } for a timeout or a
 * network error.
 */
function httpClient(extraHeaders = {}) {
  const limit = limiter(MAX_PARALLEL);
  const cache = new Map();

  async function send(url, method, readBody) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "manual",
        headers: { ...extraHeaders, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ok = res.status >= 200 && res.status < 300;
      let body = null;
      if (readBody && ok) body = await res.text();
      else await res.body?.cancel();
      return {
        status: res.status,
        location: res.headers.get("location"),
        body,
      };
    } catch (err) {
      return { error: fetchError(err) };
    }
  }

  /** GET with the body (pages, sitemaps, robots.txt). */
  function get(url) {
    const key = `GET ${url}`;
    if (!cache.has(key))
      cache.set(
        key,
        limit(() => send(url, "GET", true)),
      );
    return cache.get(key);
  }

  /** An asset: HEAD, then a body-less GET on a 405 or 501. A GET already sent counts. */
  async function probe(url) {
    const done = cache.get(`GET ${url}`);
    if (done) return done;
    const headKey = `HEAD ${url}`;
    if (!cache.has(headKey)) {
      cache.set(
        headKey,
        limit(() => send(url, "HEAD", false)),
      );
    }
    const head = await cache.get(headKey);
    if (head.error || (head.status !== 405 && head.status !== 501)) return head;
    const getKey = `GET-nobody ${url}`;
    if (!cache.has(getKey)) {
      cache.set(
        getKey,
        limit(() => send(url, "GET", false)),
      );
    }
    return cache.get(getKey);
  }

  return { get, probe };
}

const is2xx = (res) => !res.error && res.status >= 200 && res.status < 300;

/** "HTTP 301 → /faq/", "HTTP 404", or why the request failed. */
function describeResponse(res) {
  if (res.error) return res.error;
  return res.location
    ? `HTTP ${res.status} → ${res.location}`
    : `HTTP ${res.status}`;
}

/**
 * Finds and reads the live site's sitemaps: the Sitemap: lines of
 * <origin>/robots.txt, or else <origin>/sitemap-index.xml, then
 * <origin>/sitemap.xml. Sitemap indexes are followed. A sitemap that does not
 * answer 2xx (a redirect included) cannot be fetched: exit 2.
 * Returns { rootSource, pageLocs: [{ loc, source }] }, source = sitemap URL.
 */
async function readUrlSitemaps(origin, http) {
  const robotsUrl = new URL("/robots.txt", origin).href;
  const robots = await http.get(robotsUrl);
  let roots = [];
  if (is2xx(robots)) {
    for (const m of (robots.body ?? "").matchAll(
      /^[ \t]*sitemap[ \t]*:[ \t]*(\S+)/gim,
    )) {
      try {
        roots.push(new URL(m[1], robotsUrl).href);
      } catch {
        throw new InputError(
          `robots.txt has a Sitemap: line that is not a URL: ${m[1]}`,
        );
      }
    }
  }
  let rootSource = "robots.txt";
  if (roots.length === 0) {
    const tried = [
      `robots.txt: ${is2xx(robots) ? "no Sitemap: line" : describeResponse(robots)}`,
    ];
    for (const name of ["sitemap-index.xml", "sitemap.xml"]) {
      const url = new URL(`/${name}`, origin).href;
      const res = await http.get(url);
      if (is2xx(res)) {
        roots = [url];
        rootSource = name;
        break;
      }
      tried.push(`${name}: ${describeResponse(res)}`);
    }
    if (roots.length === 0) {
      throw new InputError(
        `cannot fetch a sitemap of ${origin} (${tried.join("; ")})`,
      );
    }
  }

  const pageLocs = [];
  const seen = new Set();
  async function visit(url) {
    if (seen.has(url)) return;
    seen.add(url);
    const res = await http.get(url);
    if (!is2xx(res)) {
      throw new InputError(
        `cannot fetch the sitemap ${url}: ${describeResponse(res)}`,
      );
    }
    const xml = res.body ?? "";
    const locs = readLocs(xml);
    if (!/<sitemapindex[\s>]/.test(xml)) {
      for (const loc of locs) pageLocs.push({ loc, source: url });
      return;
    }
    for (const loc of locs) {
      let child;
      try {
        child = new URL(loc).href;
      } catch {
        throw new InputError(
          `the sitemap ${url} lists a child sitemap that is not a valid URL: ${loc}`,
        );
      }
      await visit(child);
    }
  }
  for (const root of roots) await visit(root);
  return { rootSource, pageLocs };
}

/** Same-site URLs found in markdown links in `text`, resolved against `origin`, whose pathname matches `pattern`. */
function sameSiteLinksMatching(text, origin, pattern) {
  const urls = new Set();
  for (const raw of markdownLinks(text)) {
    let url;
    try {
      url = new URL(raw, origin).href;
    } catch {
      continue;
    }
    if (isSameSite(url, origin) && pattern.test(new URL(url).pathname)) {
      urls.add(url);
    }
  }
  return urls;
}

/**
 * llms.txt and any llms/*.txt leaves it links to, fetched from the live site.
 * A non-200 llms.txt gives no docs at all. A leaf that does not answer 200 is
 * skipped (its own link, being asset-shaped, is not checked by
 * llms-links-resolve anyway — only its discovery as a doc is skipped here).
 */
async function readLlmsDocsUrl(origin, http) {
  const docs = [];
  const llmsUrl = new URL("/llms.txt", origin).href;
  const res = await http.get(llmsUrl);
  if (res.error || res.status !== 200) return docs;
  const text = res.body ?? "";
  docs.push({ label: "llms.txt", text });
  const leafUrls = sameSiteLinksMatching(text, origin, /^\/llms\/.*\.txt$/);
  for (const url of leafUrls) {
    const leafRes = await http.get(url);
    if (leafRes.error || leafRes.status !== 200) continue;
    const label = new URL(url).pathname.replace(/^\//, "");
    docs.push({ label, text: leafRes.body ?? "" });
  }
  return docs;
}

/**
 * Reads the live site at `origin`. `headers` go with every request, on top of the
 * User-Agent (e.g. the secret header a WAF rule lets through, plan §4.6).
 */
async function loadUrl(origin, { headers = {} } = {}) {
  const http = httpClient(headers);
  const sitemap = await readUrlSitemaps(origin, http);
  if (sitemap.pageLocs.length === 0) {
    throw new InputError(`the sitemaps of ${origin} list no page <loc>`);
  }

  // The pages: every same-site page <loc>, fetched with GET. Other hosts are
  // external URLs, which are never requested.
  const locUrls = new Set();
  const otherHosts = new Set();
  for (const { loc } of sitemap.pageLocs) {
    let u;
    try {
      u = new URL(loc);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    if (!isSameSite(u.href, origin)) otherHosts.add(u.origin);
    else if (pathKind(u.href) === "page") locUrls.add(u.href);
  }
  if (locUrls.size === 0 && otherHosts.size > 0) {
    throw new InputError(
      `no page <loc> in the sitemaps of ${origin} is on that site; they are on ${[...otherHosts].join(", ")}: pass that origin to --url`,
    );
  }
  const urls = [...locUrls];
  const responses = await Promise.all(urls.map((url) => http.get(url)));
  const pages = [];
  urls.forEach((url, i) => {
    const res = responses[i];
    if (!res.error && res.status === 200) {
      pages.push(
        makePage({ url, status: 200, html: res.body ?? "", label: url }),
      );
    }
  });
  pages.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const pageByUrl = new Map(pages.map((p) => [p.url, p]));
  const offSitemap = new Map(); // link targets that are not sitemap pages

  // Pages need a 200 with no redirect; assets need a 2xx.
  async function resolve(url) {
    const kind = pathKind(url);
    const res = kind === "page" ? await http.get(url) : await http.probe(url);
    const ok = kind === "page" ? !res.error && res.status === 200 : is2xx(res);
    if (!ok) {
      return {
        exists: false,
        kind,
        page: null,
        inPageSet: false,
        target: null,
        reason: describeResponse(res),
      };
    }
    if (kind === "asset") {
      return {
        exists: true,
        kind,
        page: null,
        inPageSet: false,
        target: url,
        reason: null,
      };
    }
    let page = pageByUrl.get(url);
    const inPageSet = page !== undefined;
    if (!page) {
      page = offSitemap.get(url);
      if (!page) {
        page = makePage({ url, status: 200, html: res.body ?? "", label: url });
        offSitemap.set(url, page);
      }
    }
    return { exists: true, kind, page, inPageSet, target: url, reason: null };
  }

  // Request every same-site URL the pages use now, 4 at a time, so the rules
  // read answers that are already cached.
  const sameSite = new Set(
    pages
      .flatMap((p) => urlsOf(p))
      .map((o) => o.url)
      .filter((url) => isSameSite(url, origin)),
  );
  await Promise.all([...sameSite].map((url) => resolve(url)));

  const skipped = otherHosts.size
    ? `\n(page <loc>s on ${[...otherHosts].join(", ")} are not on this site and were not checked)`
    : "";
  const llmsDocs = await readLlmsDocsUrl(origin, http);
  return {
    heading: `check-seo --url ${origin} · sitemaps from ${sitemap.rootSource}${skipped}`,
    pages,
    site: {
      origin,
      pages,
      sitemap: { root: sitemap.rootSource, pageLocs: sitemap.pageLocs },
      llmsDocs,
      resolve,
    },
  };
}

export { loadUrl };
