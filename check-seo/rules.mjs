// The rules. Each rule:
//   { id, severity, check?(page, site), checkSitemap?(site, occurrences), checkSite?(site) }
// - severity is 'error' or 'warning', or a function of the site that returns one
//   (placeholder-text: a warning while the site is still example.com, an error once it
//   has its real domain; plan Q2.2).
// - check runs once per page and returns (or resolves to) one message per finding.
// - checkSitemap runs once per sitemap file, on its page <loc>s as URL occurrences.
// - checkSite runs once per site and returns [{ label, message }], where label is the
//   page, sitemap file or llms doc the finding belongs to.
//
// Rules, with their severity:
//   jsonld-parse         error    Every JSON-LD block parses, declares a schema.org
//                                 @context, and each top-level node (or @graph
//                                 member) has a @type.
//   jsonld-id-resolves   error    Every reference node (an object whose only key is
//                                 @id) points to an @id that a typed node on the same
//                                 page defines.
//   jsonld-noindex       error    noindex pages and the 404 carry no JSON-LD.
//   title-description    error    Exactly one non-empty <title> and one non-empty
//                                 <meta name="description">; the 404 needs only the
//                                 title.
//   canonical-self       error    An indexable page has exactly one canonical, equal
//                                 to its own URL. A noindex page may have none, but
//                                 any it has must be exactly one, equal to its own
//                                 URL. The 404 has none.
//   robots-single        error    At most one <meta name="robots">.
//   url-resolves         error    A same-site page URL leads to a page (--dist: a
//                                 file, or an on-demand route; --url: a 200 with no
//                                 redirect, so any 3xx fails on any host).
//   url-canonical-form   error    A same-site page URL that resolves equals the
//                                 canonical of the page it leads to, ignoring the
//                                 #fragment. If that page has no canonical, or its
//                                 canonical fails canonical-self, it equals the page's
//                                 own URL (so a broken canonical is reported once, on
//                                 its own page). A relative URL in JSON-LD always
//                                 fails.
//   faq-visible          error    The name of every Question in a FAQPage is in the
//                                 page's visible text.
//   breadcrumb-shape     error    A BreadcrumbList has at least 2 items, and the home
//                                 page (/) has none.
//   local-address        error    Every node whose @type is a LocalBusiness subtype
//                                 (src/shared/business-types.mjs) has an address with
//                                 a non-empty streetAddress, addressLocality and
//                                 addressCountry.
//   url-lowercase        error    No uppercase letter in the decoded pathname of each
//                                 page's own URL, of every same-site page URL and of
//                                 every page <loc> in the sitemaps.
//   searchaction         error    No SearchAction: Google retired the sitelinks search
//                                 box (reference §5.2), and its /search?q= URL gave
//                                 404 on several sites.
//   img-alt              error    Every <img> has an alt attribute (alt="" is fine for
//                                 a decorative image).
//   title-unique         error    No two indexable pages share a <title>.
//   sitemap-coverage     error    Every indexable page is in the sitemap, and no
//                                 noindex page nor the 404 is (--dist; --url reads its
//                                 pages from the sitemap, so it checks only the
//                                 second half).
//   llms-links-resolve   error    Every same-site page URL inside a markdown link in
//                                 llms.txt, and in every llms/*.txt leaf it links to,
//                                 leads to a page.
//   asset-missing        warning  A same-site asset URL exists (--dist: a file;
//                                 --url: a 2xx). An image-CDN URL is checked as the
//                                 image it serves; a remote source is not checked.
//   placeholder-text     warning  The HTML has none of [CLIENTE], example.com, My
//                        / error  Website, My Site, Nueva web app, tuagencia or lorem
//                                 ipsum. An error once the site is not example.com.
//   404-empty            warning  dist/404.html is not empty or only whitespace.
//   deprecated-type      warning  No node has the @type ProfessionalService or HowTo.
//   external-url-http    warning  Every external URL in the JSON-LD uses https:.
//   h1                   warning  An indexable page has exactly one <h1>. A warning:
//                                 the number and order of headings do not matter to
//                                 Search (reference §10.8); it is hygiene and
//                                 accessibility.
//   title-length         warning  About 30–60 characters in the <title> of an
//                                 indexable page. An industry convention: Google sets
//                                 no number (reference §10.6). Never an error.
//   description-length   warning  About 70–160 characters in the meta description of
//                                 an indexable page. Same caveat.
//   description-unique   warning  No two indexable pages share a meta description.
//
// Pages: kind 404 is dist/404.html (--dist only; if empty, it gets only 404-empty),
// kind noindex has a <meta name="robots"> whose content includes noindex, and every
// other page is indexable.
//
// `site` is the adapter's site context:
//   site.origin       the site's origin, e.g. https://example.com
//   site.pages        every page model
//   site.sitemap      { root, pageLocs: [{ loc, source }] }, or null when the build has
//                     no sitemap (--dist only)
//   site.llmsDocs     llms.txt and its llms/*.txt leaves, if any: [{ label, text }]
//   site.resolve(url) async; for a same-site URL it returns
//                     { exists, kind: 'page' | 'asset', page, inPageSet, target, reason }
//                     where `page` is the page model it leads to (null for an on-demand
//                     route or a remote image) and inPageSet says whether that page is
//                     one of site.pages (canonical-self only judges those)
// An empty 404 gets 404-empty and no other rule (see run.mjs). A JSON-LD block that is
// not JSON is reported only by jsonld-parse: the other JSON-LD rules read
// parsedBlocks() / nodesOf(), which leave it out.

import {
  compactText,
  decodeEntities,
  elements,
  hasType,
  isObject,
  isSchemaOrgContext,
  jsonldBlocks,
  linksByRel,
  metaByName,
  nodesOf,
  parsedBlocks,
  topNodes,
  typesOf,
  visibleText,
  walkNodes,
  where,
} from "./html.mjs";
import {
  baseOf,
  describe,
  distinctUrls,
  isSameSite,
  markdownLinks,
  ownUrlOccurrence,
  pathKind,
  uppercasePageUrls,
  uppercasePath,
  urlsOf,
  withoutHash,
} from "./urls.mjs";
import { isBlank, plural, sameUrl } from "./util.mjs";
import {
  LEGACY_LOCAL_BUSINESS_TYPES,
  LOCAL_BUSINESS_TYPES as BUSINESS_TYPES,
} from "../src/shared/business-types.mjs";

/** What canonical-self reports for a page; [] when it passes. */
function canonicalSelfProblems(page) {
  const canonicals = linksByRel(page, "canonical");
  // A noindex page may have no canonical; if it has any, the indexable rule holds.
  if (page.kind === "noindex" && canonicals.length === 0) return [];
  const hrefs = canonicals
    .map((t) => (t.attrs.href ?? "").trim() || "(no href)")
    .join(", ");
  if (page.kind === "404") {
    return canonicals.length
      ? [`the 404 must have no <link rel="canonical">, found ${hrefs}`]
      : [];
  }
  if (canonicals.length !== 1) {
    const [problem] = exactlyOne(canonicals.length, '<link rel="canonical">');
    return [canonicals.length ? `${problem} (${hrefs})` : problem];
  }
  if (!sameUrl(hrefs, page.url)) {
    return [`canonical is ${hrefs}, expected ${page.url}`];
  }
  return [];
}

/**
 * The URL a same-site link must use to reach `page`, without #fragment: its
 * canonical, unless the page has none (or several) or, for a page in the
 * checked set, its canonical fails canonical-self; then the page's own URL.
 * A page outside the checked set (--url: a link target that is not in the
 * sitemap) is compared with its canonical as-is.
 */
function canonicalFormOf(page, inPageSet) {
  if (inPageSet && canonicalSelfProblems(page).length > 0) return page.url;
  const canonicals = linksByRel(page, "canonical");
  if (canonicals.length !== 1) return page.url;
  try {
    const href = (canonicals[0].attrs.href ?? "").trim();
    return withoutHash(new URL(href, baseOf(page)).href);
  } catch {
    return page.url;
  }
}

/** url-resolves over a list of occurrences (a page's, or a sitemap's). */
async function unresolvedPageUrls(occurrences, site) {
  const findings = [];
  const pages = occurrences.filter(
    (o) => isSameSite(o.url, site.origin) && pathKind(o.url) === "page",
  );
  for (const u of distinctUrls(pages)) {
    const r = await site.resolve(u.url);
    if (!r.exists)
      findings.push(`${describe(u)} leads to no page: ${r.reason}`);
  }
  return findings;
}

/** url-canonical-form over a list of occurrences (a page's, or a sitemap's). */
async function nonCanonicalPageUrls(occurrences, site) {
  const findings = [];
  const pages = occurrences.filter(
    (o) => isSameSite(o.url, site.origin) && pathKind(o.url) === "page",
  );
  for (const u of distinctUrls(pages)) {
    const r = await site.resolve(u.url);
    const expected =
      r.exists && r.page ? canonicalFormOf(r.page, r.inPageSet) : null;
    if (u.relative) {
      const hint = expected ? `: ${expected}` : "";
      findings.push(
        `${describe(u)} is relative; JSON-LD needs the absolute URL${hint}`,
      );
    } else if (expected && !sameUrl(u.url, expected)) {
      findings.push(
        `${describe(u)} is not the canonical form of the page it leads to: ${expected}`,
      );
    }
  }
  return findings;
}
// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
//
// Each rule: { id, severity: 'error' | 'warning', check(page, site) }, plus
// an optional checkSitemap(site, occurrences) for the rules that also look at
// the sitemaps' page <loc>s (their findings are grouped under the sitemap
// file, see runRules), and/or an optional checkSite(site), run once for the
// whole site rather than once per page.
// check and checkSitemap return (or resolve to) an array of messages, one per
// finding. checkSite returns (or resolves to) an array of { label, message },
// one per finding, where label is the site.llmsDocs entry it belongs to.
// `site` is the adapter's site context:
//   site.origin       the site's origin, e.g. https://example.com
//   site.pages        every page model
//   site.sitemapLocs  every page <loc> in the sitemaps: [{ loc, source }],
//                     where source names the sitemap that lists it
//   site.llmsDocs     llms.txt and its llms/*.txt leaves, if any:
//                     [{ label, text }]
//   site.resolve(url) async; for a same-site URL it returns
//                     { exists, kind: 'page' | 'asset', page, inPageSet,
//                       target, reason }
//                     where `page` is the page model it leads to (or null)
//                     and inPageSet says whether that page is one of
//                     site.pages (canonical-self only judges those)
// An empty 404 gets 404-empty and no other rule (see runRules). A JSON-LD
// block that is not JSON is reported only by jsonld-parse: the other JSON-LD
// rules read parsedBlocks() / nodesOf(), which leave it out.

const PLACEHOLDERS = [
  { text: "[CLIENTE]" },
  { text: "example.com" },
  { text: "My Website" },
  { text: "My Site" },
  { text: "Nueva web app" },
  { text: "tuagencia" },
  { text: "lorem ipsum", anyCase: true },
];

function countOccurrences(haystack, needle, anyCase) {
  const h = anyCase ? haystack.toLowerCase() : haystack;
  const nd = anyCase ? needle.toLowerCase() : needle;
  let count = 0;
  for (let i = h.indexOf(nd); i !== -1; i = h.indexOf(nd, i + nd.length))
    count++;
  return count;
}

/** "no X" / "N X elements, expected exactly 1" for a count that must be 1. */
function exactlyOne(count, what) {
  if (count === 0) return [`no ${what}`];
  if (count > 1) return [`${count} ${what} elements, expected exactly 1`];
  return [];
}

// SearchAction has its own rule (an error), so it is not listed here.
const DEPRECATED_TYPES = ["ProfessionalService", "HowTo"];

/** The @types local-address checks: the generators' subtypes plus the legacy ones. */
const LOCAL_BUSINESS_TYPES = [...BUSINESS_TYPES, ...LEGACY_LOCAL_BUSINESS_TYPES];
const ADDRESS_FIELDS = ["streetAddress", "addressLocality", "addressCountry"];

// Industry conventions, not Google rules (reference §10.6): only ever warnings.
const TITLE_LENGTH = { min: 30, max: 60 };
const DESCRIPTION_LENGTH = { min: 70, max: 160 };

/** A tag's text with its whitespace collapsed, as a snippet would show it. */
const collapse = (s) => s.replace(/\s+/g, " ").trim();

/** The page's single <title> or <meta name="description"> text, or null. */
function titleOf(page) {
  const titles = elements(page, "title");
  return titles.length === 1 ? collapse(titles[0].content ?? "") : null;
}

function descriptionOf(page) {
  const descriptions = metaByName(page, "description");
  return descriptions.length === 1
    ? collapse(descriptions[0].attrs.content ?? "")
    : null;
}

/** A length rule over titleOf() or descriptionOf() on indexable pages. */
function lengthCheck(textOf, what, { min, max }) {
  return (page) => {
    if (page.kind !== "indexable") return [];
    const text = textOf(page);
    if (!text) return []; // title-description reports it
    const length = [...text].length;
    if (length >= min && length <= max) return [];
    return [
      `${what} has ${plural(length, "character")}, expected about ${min}–${max}: ${JSON.stringify(text)}`,
    ];
  };
}

/** A uniqueness rule over titleOf() or descriptionOf() across the indexable pages. */
function uniqueCheck(textOf, what) {
  return (site) => {
    const byText = new Map();
    for (const page of site.pages) {
      if (page.kind !== "indexable") continue;
      const text = textOf(page);
      if (!text) continue;
      if (!byText.has(text)) byText.set(text, []);
      byText.get(text).push(page);
    }
    const findings = [];
    for (const [text, pages] of byText) {
      if (pages.length < 2) continue;
      for (const page of pages) {
        const others = pages.filter((p) => p !== page).map((p) => p.label);
        findings.push({
          label: page.label,
          message: `${what} ${JSON.stringify(text)} is also on ${others.join(", ")}`,
        });
      }
    }
    return findings;
  };
}

/** placeholder-text: a warning while `site` is example.com (a preview), an error after (plan Q2.2). */
function placeholderSeverity(site) {
  try {
    return new URL(site.origin).hostname.replace(/^www\./, "") === "example.com"
      ? "warning"
      : "error";
  } catch {
    return "warning";
  }
}

const RULES = [
  {
    id: "jsonld-parse",
    severity: "error",
    check(page) {
      const findings = [];
      for (const block of jsonldBlocks(page)) {
        if (block.error !== null) {
          findings.push(`block ${block.n} is not valid JSON: ${block.error}`);
          continue;
        }
        const problems = [];
        const isArray = Array.isArray(block.data);
        const items = isArray ? block.data : [block.data];
        if (items.length === 0) problems.push("empty array, no @context");
        items.forEach((item, i) => {
          const at = isArray ? `[${i}] ` : "";
          if (!isObject(item)) {
            problems.push(`${at}is not a JSON object`);
            return;
          }
          if (!Object.hasOwn(item, "@context")) {
            problems.push(`${at}has no @context`);
          } else if (!isSchemaOrgContext(item["@context"])) {
            const ctx = JSON.stringify(item["@context"]);
            problems.push(
              `${at}has a @context that is not schema.org (${ctx})`,
            );
          }
          if (Object.hasOwn(item, "@graph")) {
            const graph = item["@graph"];
            (Array.isArray(graph) ? graph : [graph]).forEach((member, j) => {
              if (typesOf(member).length === 0) {
                problems.push(`${at}@graph[${j}] has no @type`);
              }
            });
          } else if (typesOf(item).length === 0) {
            problems.push(`${at}has no @type`);
          }
        });
        if (problems.length) {
          findings.push(`block ${block.n}: ${problems.join("; ")}`);
        }
      }
      return findings;
    },
  },
  {
    id: "jsonld-id-resolves",
    severity: "error",
    check(page) {
      // @ids are compared as IRIs resolved against the page's own URL.
      const iri = (id) => {
        try {
          return new URL(id.trim(), page.url).href;
        } catch {
          return id.trim();
        }
      };
      const nodes = nodesOf(page);
      const defined = new Set(
        nodes
          .filter(
            ({ node }) =>
              typeof node["@id"] === "string" && typesOf(node).length > 0,
          )
          .map(({ node }) => iri(node["@id"])),
      );
      const findings = [];
      for (const { block, node, path } of nodes) {
        const keys = Object.keys(node);
        if (keys.length !== 1 || keys[0] !== "@id") continue; // not a reference node
        const id = node["@id"];
        if (typeof id !== "string" || !defined.has(iri(id))) {
          findings.push(
            `${where(block, path)} references @id ${JSON.stringify(id)}, which no typed node on this page defines`,
          );
        }
      }
      return findings;
    },
  },
  {
    id: "jsonld-noindex",
    severity: "error",
    check(page) {
      if (page.kind !== "noindex" && page.kind !== "404") return [];
      const blocks = parsedBlocks(page);
      if (blocks.length === 0) return [];
      const types = [
        ...new Set(blocks.flatMap((b) => topNodes(b.data).flatMap(typesOf))),
      ];
      const who = page.kind === "404" ? "the 404" : "a noindex page";
      const list = types.length ? ` (${types.join(", ")})` : "";
      return [
        `${who} must carry no JSON-LD, found ${plural(blocks.length, "block")}${list}`,
      ];
    },
  },
  {
    id: "title-description",
    severity: "error",
    check(page) {
      const problems = [];
      const titles = elements(page, "title");
      problems.push(...exactlyOne(titles.length, "<title>"));
      if (titles.length === 1 && isBlank(titles[0].content ?? ""))
        problems.push("<title> is empty");
      if (page.kind !== "404") {
        const descriptions = metaByName(page, "description");
        problems.push(
          ...exactlyOne(descriptions.length, '<meta name="description">'),
        );
        if (
          descriptions.length === 1 &&
          isBlank(descriptions[0].attrs.content ?? "")
        ) {
          problems.push('<meta name="description"> is empty');
        }
      }
      return problems.length ? [problems.join("; ")] : [];
    },
  },
  {
    id: "canonical-self",
    severity: "error",
    check: (page) => canonicalSelfProblems(page),
  },
  {
    id: "robots-single",
    severity: "error",
    check(page) {
      const robots = metaByName(page, "robots");
      if (robots.length <= 1) return [];
      const contents = robots
        .map((t) => `"${t.attrs.content ?? ""}"`)
        .join(", ");
      return [
        `${robots.length} <meta name="robots"> elements (${contents}), expected at most 1`,
      ];
    },
  },
  {
    id: "url-resolves",
    severity: "error",
    check: (page, site) => unresolvedPageUrls(urlsOf(page), site),
    checkSitemap: (site, occurrences) => unresolvedPageUrls(occurrences, site),
  },
  {
    id: "url-canonical-form",
    severity: "error",
    check: (page, site) => nonCanonicalPageUrls(urlsOf(page), site),
    checkSitemap: (site, occurrences) =>
      nonCanonicalPageUrls(occurrences, site),
  },
  {
    id: "faq-visible",
    severity: "error",
    check(page) {
      const questions = new Set(); // document order, each Question once
      for (const { node } of nodesOf(page)) {
        if (!hasType(node, "FAQPage")) continue;
        for (const { node: q } of walkNodes(node)) {
          if (hasType(q, "Question")) questions.add(q);
        }
      }
      const findings = [];
      for (const q of questions) {
        if (typeof q.name !== "string" || isBlank(q.name)) continue;
        const name = compactText(decodeEntities(q.name));
        if (!visibleText(page).includes(name)) {
          findings.push(
            `question not in the visible text: ${JSON.stringify(q.name.trim())}`,
          );
        }
      }
      return findings;
    },
  },
  {
    id: "breadcrumb-shape",
    severity: "error",
    check(page) {
      const isHome = new URL(page.url).pathname === "/";
      const findings = [];
      for (const { block, node, path } of nodesOf(page)) {
        if (!hasType(node, "BreadcrumbList")) continue;
        const items = node.itemListElement;
        const count = Array.isArray(items)
          ? items.length
          : items == null
            ? 0
            : 1;
        const problems = [];
        if (isHome) problems.push("the home page must have no BreadcrumbList");
        if (count < 2) {
          problems.push(
            `${plural(count, "item")} in itemListElement, expected at least 2`,
          );
        }
        if (problems.length) {
          findings.push(`${where(block, path)}: ${problems.join("; ")}`);
        }
      }
      return findings;
    },
  },
  {
    id: "local-address",
    severity: "error",
    check(page) {
      const findings = [];
      for (const { block, node, path } of nodesOf(page)) {
        const types = typesOf(node).filter((t) =>
          LOCAL_BUSINESS_TYPES.includes(t),
        );
        if (types.length === 0) continue;
        const address = node.address;
        let problem = null;
        if (address === undefined) {
          problem = "no address";
        } else if (!isObject(address)) {
          const kind =
            address === null
              ? "null"
              : Array.isArray(address)
                ? "an array"
                : `a ${typeof address}`;
          problem = `address is ${kind}, not an object`;
        } else {
          const missing = ADDRESS_FIELDS.filter(
            (f) => typeof address[f] !== "string" || isBlank(address[f]),
          );
          if (missing.length) {
            problem = `address has no non-empty string ${missing.join(", ")}`;
          }
        }
        if (problem) {
          findings.push(
            `${where(block, path)}: @type ${types.join(", ")}: ${problem}`,
          );
        }
      }
      return findings;
    },
  },
  {
    id: "url-lowercase",
    severity: "error",
    check: (page, site) =>
      uppercasePageUrls([ownUrlOccurrence(page), ...urlsOf(page)], site),
    checkSitemap: (site, occurrences) => uppercasePageUrls(occurrences, site),
  },
  {
    id: "asset-missing",
    severity: "warning",
    async check(page, site) {
      const assets = urlsOf(page).filter(
        (o) => isSameSite(o.url, site.origin) && pathKind(o.url) === "asset",
      );
      const findings = [];
      for (const u of distinctUrls(assets)) {
        const r = await site.resolve(u.url);
        if (!r.exists)
          findings.push(`${describe(u)} does not exist: ${r.reason}`);
      }
      return findings;
    },
  },
  {
    id: "placeholder-text",
    severity: placeholderSeverity,
    check(page) {
      const findings = [];
      for (const { text, anyCase = false } of PLACEHOLDERS) {
        const count = countOccurrences(page.html, text, anyCase);
        if (count)
          findings.push(`contains "${text}" (${plural(count, "time")})`);
      }
      return findings;
    },
  },
  {
    id: "404-empty",
    severity: "warning",
    check(page) {
      if (page.kind !== "404" || !isBlank(page.html)) return [];
      return [
        page.html.length === 0
          ? "the 404 page is empty (0 bytes)"
          : "the 404 page contains only whitespace",
      ];
    },
  },
  {
    id: "deprecated-type",
    severity: "warning",
    check(page) {
      const findings = [];
      for (const { block, node, path } of nodesOf(page)) {
        for (const type of typesOf(node)) {
          if (DEPRECATED_TYPES.includes(type)) {
            findings.push(`${where(block, path)}: @type ${type}`);
          }
        }
      }
      return findings;
    },
  },
  {
    id: "external-url-http",
    severity: "warning",
    check(page, site) {
      const external = urlsOf(page).filter(
        (o) => o.jsonld && !isSameSite(o.url, site.origin),
      );
      return distinctUrls(external)
        .filter((u) => new URL(u.url).protocol !== "https:")
        .map((u) => `${describe(u)} uses http:, not https:`);
    },
  },
  {
    id: "llms-links-resolve",
    severity: "error",
    async checkSite(site) {
      const findings = [];
      for (const doc of site.llmsDocs) {
        for (const raw of markdownLinks(doc.text)) {
          let url;
          try {
            url = new URL(raw, site.origin).href;
          } catch {
            continue;
          }
          if (!isSameSite(url, site.origin) || pathKind(url) !== "page")
            continue;
          const r = await site.resolve(url);
          if (!r.exists) {
            findings.push({
              label: doc.label,
              message: `${raw} (in ${doc.label}) leads to no page: ${r.reason}`,
            });
          }
        }
      }
      return findings;
    },
  },
  {
    id: "searchaction",
    severity: "error",
    check(page) {
      return nodesOf(page)
        .filter(({ node }) => hasType(node, "SearchAction"))
        .map(
          ({ block, path }) =>
            `${where(block, path)}: SearchAction (the sitelinks search box was retired in 2024)`,
        );
    },
  },
  {
    id: "img-alt",
    severity: "error",
    check(page) {
      return elements(page, "img")
        .filter((t) => t.attrs.alt === undefined)
        .map((t) => `<img src="${t.attrs.src ?? ""}"> has no alt attribute`);
    },
  },
  {
    id: "title-unique",
    severity: "error",
    checkSite: uniqueCheck(titleOf, "<title>"),
  },
  {
    id: "sitemap-coverage",
    severity: "error",
    checkSite(site) {
      if (!site.sitemap) {
        return [
          {
            label: "sitemap",
            message: "the build has no sitemap-index.xml or sitemap.xml",
          },
        ];
      }
      const findings = [];
      const locs = new Map(); // URL → the sitemap file that lists it
      for (const { loc, source } of site.sitemap.pageLocs) {
        try {
          locs.set(withoutHash(loc), source);
        } catch {
          // an unparsable <loc> is url-resolves' business
        }
      }
      for (const page of site.pages) {
        const listedIn = locs.get(page.url);
        if (page.kind === "indexable" && listedIn === undefined) {
          findings.push({
            label: page.label,
            message: `an indexable page that is not in the sitemap: ${page.url}`,
          });
        } else if (page.kind !== "indexable" && listedIn !== undefined) {
          const who = page.kind === "404" ? "the 404" : "a noindex page";
          findings.push({
            label: listedIn,
            message: `lists ${page.url}, which is ${who}`,
          });
        }
      }
      return findings;
    },
  },
  {
    id: "h1",
    severity: "warning",
    check(page) {
      if (page.kind !== "indexable") return [];
      const count = elements(page, "h1").length;
      if (count === 1) return [];
      return [count === 0 ? "no <h1>" : `${count} <h1> elements, expected 1`];
    },
  },
  {
    id: "title-length",
    severity: "warning",
    check: lengthCheck(titleOf, "<title>", TITLE_LENGTH),
  },
  {
    id: "description-length",
    severity: "warning",
    check: lengthCheck(descriptionOf, '<meta name="description">', DESCRIPTION_LENGTH),
  },
  {
    id: "description-unique",
    severity: "warning",
    checkSite: uniqueCheck(descriptionOf, '<meta name="description">'),
  },
];

export { RULES };
