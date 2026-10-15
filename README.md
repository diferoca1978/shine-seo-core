# @shine/seo-core

The SEO core shared by a set of Astro sites. It covers the part of SEO that fails
silently: a canonical that points to the wrong URL, an internal link without its trailing
slash that redirects, JSON-LD that references a node nobody defines, a `noindex` page
listed in the sitemap. Nothing looks broken on screen, and the site loses indexing for
weeks before anyone notices.

The package handles this in two ways:

1. **It generates those pieces correctly**: absolute URLs, head tags, JSON-LD and
   robots.txt, all built from one set of project data.
2. **It checks the HTML the build actually published** and fails `astro build` on any
   error, so a broken page never reaches production. The same checker also runs against
   a live site.

Everything that fails visibly (folders, layout, components, styles) stays in each
project.

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Setting up a site](#setting-up-a-site)
- [The build gate](#the-build-gate)
- [check-seo on its own](#check-seo-on-its-own)
- [The rules](#the-rules)
- [Limits](#limits)
- [Versions and upgrades](#versions-and-upgrades)
- [Development](#development)
- [License](#license)

## How it works

```
 project data                    the package                       result
 ────────────                    ───────────                       ──────
 astro.config.mjs ─────────────► createSiteUrl() ─► siteUrl() / mediaUrl()
   (site, trailingSlash)                                    │
 src/config/company.ts ──┐                                  │
 src/config/authors.ts ──┼─────► createSeo() ◄──────────────┘
 src/config/pages.ts ────┘         pageHead(), businessNode(), …
                                          │
                                          ▼
                                    <SeoHead> ─────────────► <head> tags + one @graph

 astro build ─► dist/ (HTML + sitemap) ─► shineSeo() gate ─► check-seo rules
                                                              ├─ no errors: build passes
                                                              └─ errors: build exits 1

 live site ─► robots.txt, sitemaps ─────► check-seo --url ──► the same rules
```

Three ideas hold it together:

- **One source per fact.** The domain and the trailing-slash policy live in
  `astro.config.mjs`. Every absolute URL comes from `siteUrl()`, so a canonical, a
  JSON-LD `@id`, a sitemap `<loc>` and an internal link always agree. A page's title,
  description, h1 and `noindex` flag live in `pages.ts`, and the head, the page body and
  the sitemap all read them from there.
- **The generators and the rules agree.** Each generator emits what the matching rule
  requires. For example, `breadcrumbNode()` refuses fewer than 2 items, which
  `breadcrumb-shape` would reject anyway. The rules catch what a project writes by hand,
  and anything a later change breaks.
- **The check reads the published HTML**, not the source. It sees what a crawler sees,
  whatever component, CMS or integration produced it (see [Limits](#limits) for the
  exceptions).

## Requirements

- **Astro 6.1 or later** (a peer dependency), with any adapter or none. The end-to-end
  test builds a site with Astro 6.1 and 7.3, with no adapter, with `@astrojs/netlify` and
  with `@astrojs/cloudflare`.
- **Node 22.12 or later**, the same as Astro 6.
- **`@astrojs/sitemap`**: the gate reads the sitemap, and `sitemap-coverage` checks it.

## Install

```sh
pnpm add github:diferoca1978/shine-seo-core#v0.1.1
```

Pin an exact tag, never a branch. A client site upgrades by changing the tag (see
[Versions and upgrades](#versions-and-upgrades)).

The package has no build step: no `prepare`, no `postinstall`. Recent versions of pnpm
ask you to approve, in `allowBuilds`, every git dependency that builds on install. This
package needs no approval, on a laptop or on a host.

## Setting up a site

A site needs these files. Only `llms.txt.ts` and `authors.ts` are optional.

| File | What it holds |
|---|---|
| `astro.config.mjs` | `site`, `trailingSlash`, the sitemap and the gate |
| `src/utils/url.ts` | `siteUrl()` and `mediaUrl()`: the only file that reads the Astro config |
| `src/config/company.ts` | the business: name, contact, address, logo, profiles |
| `src/config/authors.ts` | the people who appear on the site (optional) |
| `src/config/pages.ts` | the SEO of every page: title, description, h1, `noindex` |
| `src/config/seo.ts` | `createSeo()`, called once |
| `src/layouts/Layout.astro` | `<SeoHead>` inside `<head>` |
| `src/pages/robots.txt.ts` | `robotsTxt()` |
| `src/pages/llms.txt.ts` | the `llms` builders (optional) |

### 1. `astro.config.mjs`

```js
// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import shineSeo from '@shine/seo-core/integration';
import { sitemapFilter } from '@shine/seo-core/config';
import { PAGES } from './src/config/pages.ts';

export default defineConfig({
  site: 'https://example.com',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: sitemapFilter(PAGES) }), shineSeo()],
});
```

- **`site` is required.** The gate stops the build without it. Until the real domain
  exists, use `https://example.com`: `placeholder-text` is then only a warning. Once
  `site` is the real domain, any placeholder left in the HTML becomes an error.
- **`trailingSlash`** sets the form of every page URL. Pick the form the site already
  ranks with: `siteUrl()` follows it, and so does the check.
- **`shineSeo()` goes after `sitemap()`.** `@astrojs/sitemap` writes the sitemap when the
  build finishes, so a gate placed before it would run first. The gate stops the build
  if the order is wrong.
- **`sitemapFilter(PAGES)`** leaves every page marked `noindex` out of the sitemap, so the
  `noindex` flag in `pages.ts` decides both the meta robots tag and the sitemap.
  `astro.config.mjs` can import `pages.ts` as long as that file only imports types.

### 2. `src/utils/url.ts`

```ts
import { site, trailingSlash, base, build } from 'astro:config/client';
import { createSiteUrl } from '@shine/seo-core';

export const { siteUrl, mediaUrl } = createSiteUrl({ site, trailingSlash, base, build });
```

This is the only file that reads the Astro config. `createSiteUrl()` is a pure function,
so it reads nothing on its own and the tests can call it with any configuration.

**`siteUrl(path)`** builds the absolute URL of a page or a file on this site:

- `path` starts with `/` but not with `//`. Its `?query` and `#fragment` are kept.
- A page path, meaning one whose last segment has no extension, must be lowercase once
  percent-decoded, and it gets the trailing slash the project uses. With
  `trailingSlash: 'ignore'`, `build.format` decides: `'file'` means no slash, and any
  other format means a slash.
- A file path (`/guia.pdf`) is left as it is.
- `base` is prepended when the project sets it.

| Call | `trailingSlash: 'always'` | `trailingSlash: 'never'` |
|---|---|---|
| `siteUrl('/')` | `https://example.com/` | `https://example.com/` |
| `siteUrl('/nosotros')` | `https://example.com/nosotros/` | `https://example.com/nosotros` |
| `siteUrl('/servicios/#precios')` | `https://example.com/servicios/#precios` | `https://example.com/servicios#precios` |
| `siteUrl('/contacto?ref=menu')` | `https://example.com/contacto/?ref=menu` | `https://example.com/contacto?ref=menu` |
| `siteUrl('/guia.pdf')` | `https://example.com/guia.pdf` | `https://example.com/guia.pdf` |
| `siteUrl('/Nosotros/')` | throws: page paths must be lowercase | throws |

**`mediaUrl(src)`** is for media fields only: an image, a logo, a video. It accepts an
`https://` URL, a protocol-relative `//host/…` URL (some CMSs return those; it becomes
`https:`), or a path on this site. It never adds a slash and never checks case, so
`/_astro/Photo.webp` and `/.netlify/images?url=…` stay as they are. Anything else
throws, including `http:` URLs and bare file names.

### 3. `src/config/company.ts`

```ts
import type { Company } from '@shine/seo-core';

export const LOCALE = 'es-CO'; // BCP 47

export const COMPANY: Company = {
  name: 'Ejemplo Abogados', // also WebSite.name and the title suffix
  description: 'Asesoría legal para empresas en Bogotá.',
  phone: '+57 300 000 0000', // with the country code
  email: 'hola@example.com',
  business: {
    kind: 'local',
    type: 'LegalService',
    address: {
      street: 'Calle 1 # 2-3',
      city: 'Bogotá',
      region: 'Bogotá D.C.',
      postalCode: '110111', // optional
      countryCode: 'CO', // ISO 3166-1 alpha-2
    },
    geo: { latitude: 4.60971, longitude: -74.08175 }, // optional; at least 5 decimals
  },
  logo: '/logo.png', // at least 112 px
  image: '/og-image.png', // the default og:image
  foundingDate: '2015', // optional
  founders: ['ana-gomez'], // optional; Author slugs, not names
  socialMedia: { linkedin: 'https://www.linkedin.com/company/ejemplo' }, // → sameAs
};
```

`business` takes one of two shapes:

- **`kind: 'remote'`**: the business receives no visitors at an address. It is emitted as
  an `Organization` with no street, postal code or geo. A city, a region and a country
  are optional:
  `business: { kind: 'remote', address: { city: 'Bogotá', region: 'Bogotá D.C.', countryCode: 'CO' } }`.
- **`kind: 'local'`**: a real address that the site shows. It is emitted as the most
  specific `LocalBusiness` subtype listed in `LOCAL_BUSINESS_TYPES` (currently
  `LocalBusiness`, `LegalService` and `Dentist`), never as `ProfessionalService`. Adding
  a subtype is a change to this package (`src/shared/business-types.mjs` and its
  `.d.mts`).

`logo` and `image` take a path on the site or an `https://` URL. `socialMedia` takes
official profile URLs only. Each one becomes a `sameAs` link.

### 4. `src/config/authors.ts` (optional)

```ts
import type { Author } from '@shine/seo-core';

export const AUTHORS: Author[] = [
  {
    slug: 'ana-gomez', // stable: the Person @id is <site>/#person-ana-gomez
    name: 'Ana Gómez', // no titles such as "Dr." in the name
    role: 'Abogada laboral', // → jobTitle
    bio: 'Quince años en derecho laboral.',
    image: '/equipo/ana.jpg', // optional
    url: '/equipo/ana-gomez/', // optional: the author's page on this site
    socialMedia: { linkedin: 'https://www.linkedin.com/in/ejemplo' }, // optional
  },
];
```

Every slug in `COMPANY.founders` must match an author here, or `homeNodes()` throws.

### 5. `src/config/pages.ts`

```ts
import type { PageSeo } from '@shine/seo-core';

export const PAGES = {
  home: {
    path: '/',
    keyword: 'abogados laborales bogotá', // from the brief; never published
    title: 'Abogados laborales para empresas en Bogotá',
    description: 'Asesoría laboral para empresas: contratos, despidos y procesos ante el Ministerio de Trabajo.',
    h1: 'Abogados laborales para empresas',
    source: 'textos-sitio.md §1', // where the copy comes from
  },
  privacidad: {
    path: '/politica-privacidad/',
    title: 'Política de privacidad',
    description: 'Cómo tratamos los datos personales de quienes nos escriben.',
    h1: 'Política de privacidad',
    source: 'textos-sitio.md §9',
    noindex: true, // meta robots noindex, out of the sitemap, no JSON-LD
  },
} satisfies Record<string, PageSeo>;
```

This file is the single source of each page's SEO. The page itself renders `PAGES.x.h1`
and passes `PAGES.x` to `pageHead()`, so the HTML always matches the manifest. `keyword`
and `source` are for whoever writes and reviews the copy, and are never published.

### 6. `src/config/seo.ts`

```ts
import { createSeo } from '@shine/seo-core';
import { COMPANY, LOCALE } from './company';
import { AUTHORS } from './authors';
import { mediaUrl, siteUrl } from '../utils/url';

export const seo = createSeo({ company: COMPANY, authors: AUTHORS, locale: LOCALE, siteUrl, mediaUrl });
```

`createSeo()` takes every input as a parameter and returns:

| Method | Returns |
|---|---|
| `pageHead(page)` | The head of an indexable or `noindex` page: the title (`<title> \| <company name>`, unless the title already contains the name), the description, a canonical equal to the page's own URL, robots, Open Graph and Twitter tags. `page.image` overrides `company.image`. |
| `notFoundHead({ title })` | The 404 head: a title and `noindex, follow`. No canonical, no description, no Open Graph. |
| `businessNode()` | The full business node: `Organization` or the `LocalBusiness` subtype, with logo, image, contact details, address, geo, founders and `sameAs`. Use it only on the home page or the about page. |
| `businessRef()` | The business on every other page: `@id`, `name` and `url`, always typed `Organization`, so the page's graph is complete without repeating the address. |
| `websiteNode()` | `WebSite`, for the home page only, without `SearchAction`. |
| `personNode(slugOrAuthor)` | A `Person`, linked to the business through `worksFor`. |
| `homeNodes()` | The home page's nodes: the business, the `WebSite` and one `Person` for each founder. |
| `breadcrumbNode(items)` | A `BreadcrumbList`. Only when the breadcrumbs are visible on the page, never on the home page, and with at least 2 items (it throws otherwise). |

Every `@id` and `url` is built with `siteUrl()`, so it equals the canonical. There is no
FAQPage generator: Google stopped showing the FAQ rich result in 2026.

### 7. The layout

```astro
---
import SeoHead from '@shine/seo-core/components/SeoHead.astro';
import type { HeadData, JsonLdNode } from '@shine/seo-core';
import { LOCALE } from '../config/company';

interface Props {
  head: HeadData;
  schemas?: JsonLdNode[];
}

const { head, schemas } = Astro.props;
---

<html lang={LOCALE}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <SeoHead head={head} schemas={schemas} />
  </head>
  <body>
    <slot />
  </body>
</html>
```

`<SeoHead>` emits its own tags (title, description, canonical, robots, Open Graph and
Twitter) and wraps every node in `schemas` into one `@graph`, in a single
`<script type="application/ld+json">`. On a `noindex` page it ignores `schemas` and emits
no JSON-LD. It escapes every `<` in the JSON, so a string that contains `</script>`
cannot close the script element early.

### 8. The pages

| Page | `head` | `schemas` |
|---|---|---|
| Home | `seo.pageHead(PAGES.home)` | `seo.homeNodes()` |
| About | `seo.pageHead(PAGES.nosotros)` | `seo.businessNode()`, plus `seo.personNode(slug)` for every founder and every other person shown |
| Any other indexable page | `seo.pageHead(PAGES.x)` | `seo.businessRef()`, plus `seo.breadcrumbNode(items)` when the breadcrumbs are visible |
| A `noindex` page | `seo.pageHead(PAGES.x)` with `noindex: true` | none (ignored if given) |
| 404 | `seo.notFoundHead({ title: 'Página no encontrada' })` | none |

Every `{ "@id": … }` reference must point to a node on the same page
(`jsonld-id-resolves`). `businessNode()` references each founder, so the page that
carries it also needs their `Person` nodes, and `personNode()` references the business,
so it needs `businessNode()` or `businessRef()` beside it.

```astro
---
// src/pages/index.astro
import Layout from '../layouts/Layout.astro';
import { PAGES } from '../config/pages';
import { seo } from '../config/seo';
const page = PAGES.home;
---

<Layout head={seo.pageHead(page)} schemas={seo.homeNodes()}>
  <h1>{page.h1}</h1>
</Layout>
```

```astro
---
// src/pages/servicios.astro
import Layout from '../layouts/Layout.astro';
import { PAGES } from '../config/pages';
import { seo } from '../config/seo';
const page = PAGES.servicios;
const crumbs = [{ name: 'Inicio', path: '/' }, { name: 'Servicios', path: page.path }];
---

<Layout head={seo.pageHead(page)} schemas={[seo.businessRef(), seo.breadcrumbNode(crumbs)]}>
  <nav aria-label="Migas"><a href="/">Inicio</a> › Servicios</nav>
  <h1>{page.h1}</h1>
</Layout>
```

Never write the domain by hand. Internal links can be relative (`href="/servicios/"`),
but they must match the canonical form exactly, slash included: `url-canonical-form`
catches the ones that do not. URLs inside JSON-LD must be absolute, so build them with
`siteUrl()`.

### 9. `src/pages/robots.txt.ts`

```ts
import type { APIRoute } from 'astro';
import { robotsTxt } from '@shine/seo-core';

export const GET: APIRoute = ({ site }) =>
  new Response(robotsTxt({ site: site! }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
```

The file lets every crawler crawl everything. It also names the AI search and
user-triggered fetch agents explicitly (`AI_SEARCH_AGENTS`: `ChatGPT-User`,
`OAI-SearchBot`, `Claude-User`, `Claude-SearchBot`, `Perplexity-User` and
`PerplexityBot`), and declares the sitemap (`sitemap-index.xml` by default, or
`robotsTxt({ site, sitemap: '/sitemap.xml' })`).

On Cloudflare, check the robots.txt the site actually serves. With Bot Preference Sync,
Cloudflare adds its own directives in front of this file.

### 10. `src/pages/llms.txt.ts` (optional)

Google Search ignores `llms.txt`, though other services may read it. The builders return
plain markdown strings:

```ts
import type { APIRoute } from 'astro';
import { llms } from '@shine/seo-core';
import { COMPANY } from '../config/company';
import { PAGES } from '../config/pages';
import { siteUrl } from '../utils/url';

export const GET: APIRoute = () => {
  const body = llms.llmsTxt(llms.header(COMPANY.name, COMPANY.description), [
    llms.linkList('Servicios', [
      { title: PAGES.servicios.title, url: siteUrl(PAGES.servicios.path), notes: 'Qué hacemos' },
    ]),
  ]);
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
```

`header(title, summary?)`, `doc(item)`, `linkList(heading, items)` (which returns `''`
for an empty list) and `llmsTxt(header, sections)` (which drops empty sections).
`llms-links-resolve` checks that every link on the site leads to a page.

## The build gate

`shineSeo()` is an Astro integration that runs check-seo on the build output at the end
of `astro build`.

- **When the config loads**, it stops the build if `site` is missing, if `shineSeo()`
  comes before `sitemap()`, or if an `ignore` entry is invalid.
- **When the build finishes**, it checks every HTML file in the folder Astro reports
  (`dist/`, or `dist/client/` on Cloudflare), the sitemaps and `llms.txt`. Routes with
  `prerender = false` produce no HTML, but the gate still counts them as pages, so links
  to them pass.
- **On any error**, it prints the report and throws, so `astro build` exits with 1 and
  Netlify, Cloudflare or any CI stops the deploy. Warnings are printed but never fail the
  build.
- **It behaves the same everywhere.** It reads no host variable (`CONTEXT`, `URL`…) and
  assumes no adapter folder, so a build that passes locally passes on the host.

A failing build prints something like this:

```
check-seo --dist dist · origin https://example.com (sitemap-index.xml)

index.html
  warning  title-length        <title> has 66 characters, expected about 30–60: "…"

servicios/index.html
  error    url-canonical-form  /nosotros (<a href>) is not the canonical form of the page it leads to: https://example.com/nosotros/

5 pages, 1 error, 1 warning
```

### `ignore`: the only valve

```js
shineSeo({
  ignore: [
    {
      rule: 'url-lowercase',
      path: '/quienesSomos/',
      reason: 'Ranks with this URL; a 301 to /quienes-somos/ is planned with the redesign',
    },
  ],
});
```

- `rule` is required and must be a real rule id (`RuleId` in the types).
- `path` is optional: a page's pathname (`/quienesSomos/`) or a file (`/sitemap-0.xml`).
  Without it, the rule is ignored everywhere.
- `reason` is required. The gate rejects an entry without one.

Every build prints what it ignored, with the reason. `ignore` is for findings that cannot
be fixed yet, such as a legacy URL that already ranks. It is not a way to make a build
pass.

## check-seo on its own

The same checker runs as a command, against a build or against a live site:

```sh
pnpm exec check-seo --dist dist                     # a build
pnpm exec check-seo --url https://example.com       # the live site
pnpm exec check-seo --url https://example.com --header "X-Check: <secret>"
```

| Option | Effect |
|---|---|
| `--dist <dir>` | Check every `*.html` file under `<dir>`, plus its sitemaps and `llms.txt` |
| `--site <origin>` | `--dist` only: use this origin instead of the one in the sitemap's `<loc>`s (required when the build has no sitemap) |
| `--url <origin>` | Check the live site: every page `<loc>` in its sitemaps |
| `--header "Name: value"` | `--url` only: send this header with every request to the site itself (for a WAF rule that lets the checker through). A sitemap on another host or a plain-http URL never gets it. Can be repeated |
| `--strict` | Warnings count as errors |
| `--report` | Exit with 0 even when there are errors |

Give exactly one of `--dist` and `--url`. Exit codes: `0` means no errors; `1` means at
least one error (`--report` turns this into `0`); `2` means a usage error or input that
cannot be read, such as a missing folder, no sitemap and no `--site`, or a sitemap that
cannot be fetched. `--report` never hides a `2`.

With `--url`, it finds the sitemaps through the `Sitemap:` lines in `robots.txt`, then
falls back to `/sitemap-index.xml` and `/sitemap.xml`, and follows sitemap indexes. It
sends at most 4 requests at a time, with a timeout, and identifies itself as
`shine-seo-core-check-seo`. On a live site, any 3xx on a page URL fails `url-resolves`,
whatever the host.

The same checks are available as a library:

```js
import { checkDist, checkUrl } from '@shine/seo-core/check-seo';

const result = await checkUrl({ origin: 'https://example.com' });
// { text, errors, warnings, failed, pageCount, results, ignored }
```

Both functions accept `ignore`, `strict` and `report`. `checkDist` also takes `dir`,
`origin`, `onDemand` and `label`, and `checkUrl` takes `headers`.

## The rules

A page is a 404 (`dist/404.html`, in `--dist` only), `noindex` (its meta robots tag
contains `noindex`) or indexable. The full definition of each rule is at the top of
[`check-seo/rules.mjs`](check-seo/rules.mjs).

**Head and indexing**

| Rule | Severity | Checks that |
|---|---|---|
| `title-description` | error | There is exactly one non-empty `<title>` and one non-empty meta description. The 404 needs only the title |
| `canonical-self` | error | An indexable page has exactly one canonical, equal to its own URL. A `noindex` page may have none. The 404 has none |
| `robots-single` | error | There is at most one meta robots tag |
| `title-unique` | error | No two indexable pages share a `<title>` |
| `title-length` | warning | The title has about 30–60 characters. This is an industry convention, since Google sets no number |
| `description-length` | warning | The description has about 70–160 characters. Same caveat |
| `description-unique` | warning | No two indexable pages share a description |

**URLs and links**

| Rule | Severity | Checks that |
|---|---|---|
| `url-resolves` | error | Every page URL on the site leads to a page. In `--dist`, that means a file or an on-demand route. In `--url`, it means a 200 with no redirect |
| `url-canonical-form` | error | Every page URL on the site equals the canonical of the page it leads to. A relative URL in JSON-LD always fails |
| `url-lowercase` | error | No uppercase letter appears in a page's URL, in links to the site's pages or in sitemap `<loc>`s |
| `asset-missing` | warning | Every file the site links to exists. Image-CDN URLs (Netlify, Astro's `/_image`, Cloudflare's `/cdn-cgi/image/`) are checked as the image they serve |

**Sitemap and llms.txt**

| Rule | Severity | Checks that |
|---|---|---|
| `sitemap-coverage` | error | Every indexable page is in the sitemap, and no `noindex` page and no 404 is. With `--url`, the pages come from the sitemap, so only the second half is checked |
| `llms-links-resolve` | error | Every link to the site's pages in `llms.txt`, and in the `llms/*.txt` files it links to, leads to a page |

**JSON-LD**

| Rule | Severity | Checks that |
|---|---|---|
| `jsonld-parse` | error | Every block parses, declares a schema.org `@context`, and gives each top-level node (or `@graph` member) a `@type` |
| `jsonld-id-resolves` | error | Every `{ "@id": … }` reference points to a node defined on the same page |
| `jsonld-noindex` | error | `noindex` pages and the 404 carry no JSON-LD |
| `breadcrumb-shape` | error | A `BreadcrumbList` has at least 2 items, and the home page has none |
| `local-address` | error | Every `LocalBusiness` subtype has a `streetAddress`, an `addressLocality` and an `addressCountry` |
| `faq-visible` | error | Every FAQPage question appears in the page's visible text |
| `searchaction` | error | There is no `SearchAction`. Google retired the sitelinks search box, and its `/search?q=` URL returned 404 on real sites |
| `deprecated-type` | warning | No node uses `ProfessionalService` or `HowTo` |
| `external-url-http` | warning | Every external URL in the JSON-LD uses `https:` |

**Content**

| Rule | Severity | Checks that |
|---|---|---|
| `img-alt` | error | Every `<img>` has an `alt` attribute (`alt=""` is fine for a decorative image) |
| `placeholder-text` | warning, then error | The HTML has no `[CLIENTE]`, `example.com`, `My Website`, `My Site`, `Nueva web app`, `tuagencia` or `lorem ipsum`. This is a warning while `site` is example.com, and an error once it is not |
| `h1` | warning | An indexable page has exactly one `<h1>`. A warning, because heading count does not affect ranking. It is about hygiene and accessibility |
| `404-empty` | warning | `dist/404.html` is not empty. An empty 404 gets this rule and no other |

## Limits

- check-seo checks form, not truth. It cannot tell whether a phone number, an address
  or a review is real.
- It cannot see text hidden with CSS, so `faq-visible` treats that text as visible.
- It does not replace Google's Rich Results Test, which decides whether a page is
  eligible for a rich result.
- In `--dist`, remote images are not fetched.
- On Cloudflare, the robots.txt the site serves can differ from the one the build wrote
  (see [robots.txt](#9-srcpagesrobotstxtts)).

## Versions and upgrades

Every release is a git tag `vX.Y.Z`, with its entry in [CHANGELOG.md](CHANGELOG.md).
To upgrade a site, read the CHANGELOG entries between the two versions, change the tag
in `package.json` and run the build:

```json
"@shine/seo-core": "github:diferoca1978/shine-seo-core#v0.2.0"
```

**Severity policy:** a new rule ships as a warning in a minor version. It becomes an
error only in a major version, announced in the CHANGELOG. A minor upgrade never breaks a
site's build.

## Development

```sh
pnpm install
pnpm test        # unit tests (node:test): every rule has a passing and a failing case
pnpm typecheck   # tsc over src/ and the tests
pnpm test:e2e    # builds a fixture site with each Astro configuration (needs network)
```

The unit tests need Node 22.18 or later, because they rely on Node stripping the types
of the `.ts` test files. The package itself runs on Node 22.12 or later.

`pnpm test:e2e` commits the working tree to a throwaway git repo with a tag and installs
it into a fixture site from `git+file://…#tag`, the same way a client installs it. It
builds that site with no adapter (plus `astro check`), with Netlify, with Cloudflare, and
with Astro 6. In each configuration, the clean build must pass, and adding a broken page
must make it fail.

```
src/           url.ts, seo.ts (head + JSON-LD), types.ts, robots.ts, llms.ts,
               components/ (SeoHead, JsonLd), config.mjs (for astro.config),
               shared/business-types.mjs
check-seo/     index.mjs (library), cli.mjs (bin), html.mjs (tag reader and page model),
               urls.mjs, rules.mjs (every rule, documented at the top), dist.mjs and
               live.mjs (the --dist and --url inputs), run.mjs (runner, ignore, report)
integration/   the gate
test/          unit tests, helpers.mjs (fixture builder), e2e/ (fixture site and runner)
```

Why some files are `.mjs` and others `.ts`: Node does not strip types inside
`node_modules`. Whatever Node runs (check-seo, the integration and `src/config.mjs`) is
plain `.mjs` with a `.d.mts` next to it. The `.ts` and `.astro` files live only where
Vite processes them.

The rules for changes are in [AGENTS.md](AGENTS.md). In short, a fix comes with its
regression test, and a change to the public API or a new rule needs a short spec
approved first. No client is named anywhere in this repo.

## License

[MIT](LICENSE) © 2026 Shine Agencia
