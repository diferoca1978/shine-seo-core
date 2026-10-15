# Changelog

## 0.1.1 (2026-10-15)

- check-seo `--url`: the `--header` headers go only to the site itself (same host,
  `www.` aside) over the origin's scheme. Before, a `Sitemap:` line or a sitemap index
  pointing to another host sent them there too, and those headers may carry a WAF
  secret.

## 0.1.0 (2026-10-15)

First version. Rescued from `astro-harness@1915d59` (`src/utils/url.ts`,
`src/config/seo.ts`, `JsonLd.astro`, `SeoHead.astro`, `src/utils/llms.ts`,
`src/pages/robots.txt.ts`, `harness/check-seo.mjs`) and reworked as a package.

- `createSiteUrl({ site, trailingSlash, base, build })`: a pure function. It follows
  each project's `trailingSlash` (and `build.format` when it is `ignore`), so a site
  that ranks without the trailing slash keeps its URLs.
- `createSeo({ company, authors, locale, siteUrl, mediaUrl })`: `pageHead`,
  `notFoundHead`, `businessNode`, `businessRef`, `websiteNode`, `personNode`,
  `homeNodes`, `breadcrumbNode`, and `graph()` for one `@graph` per page. No
  `SearchAction`; no FAQPage generator (the FAQ rich result stopped showing in 2026).
- `SeoHead` emits its own tags (title, description, canonical, robots, Open Graph,
  Twitter) and the page's `@graph`; no `astro-seo` dependency. No JSON-LD on noindex
  pages.
- `robotsTxt()`, `llms` builders, `sitemapFilter(PAGES)` for `@astrojs/sitemap`.
- check-seo: the 18 rules of astro-harness, split into modules and covered by tests,
  plus `searchaction`, `img-alt`, `title-unique` and `sitemap-coverage` (errors) and
  `h1`, `title-length`, `description-length` and `description-unique` (warnings).
  `placeholder-text` is an error once `site` is not example.com.
  - Host-agnostic: image-CDN URLs of Netlify, Astro (`/_image`) and Cloudflare
    (`/cdn-cgi/image/`) are checked as the image they serve; remote images are not
    looked for in the build.
  - On-demand routes count as existing pages in `--dist`.
  - Partytown's `~partytown/` sandbox page is not a page of the site.
  - `--url` accepts `--header` (for a WAF rule that lets the checker through).
- The `shineSeo()` integration: runs check-seo at the end of `astro build` and fails
  the build on any error. The only valve is `ignore`, with a reason per entry.
