// One passing and one failing case per rule, plus the regression cases from the
// 2026-10-07 audit of live sites, anonymized (plan §4.3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { DESCRIPTION, ORIGIN, check, cleanSite, findings, page, sitemap } from "./helpers.mjs";
import { InputError } from "../check-seo/index.mjs";

const org = { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Sitio", url: `${ORIGIN}/` };
const graph = (...nodes) => ({ "@context": "https://schema.org", "@graph": nodes });

/** A clean site with one file replaced or added. */
const siteWith = (files) => ({ ...cleanSite(), ...files });
const inner = (options) => page({ url: `${ORIGIN}/nosotros/`, title: "Quiénes somos: el equipo de asesoría de prueba", description: "Otra descripción de prueba, distinta de la home y con longitud suficiente para las reglas.", ...options });

test("baseline: the clean site has no findings", async () => {
  const result = await check(cleanSite());
  assert.equal(result.errors, 0, result.text);
  assert.equal(result.warnings, 0, result.text);
  assert.equal(result.failed, false);
  assert.equal(result.pageCount, 2);
});

// --- JSON-LD ---------------------------------------------------------------

test("jsonld-parse", async () => {
  assert.equal(findings(await check(siteWith({ "index.html": page({ jsonld: [graph(org)] }) })), "jsonld-parse").length, 0);
  const bad = await check(siteWith({ "index.html": page({ jsonld: [{ "@type": "Organization" }, "{not json"] }) }));
  const messages = findings(bad, "jsonld-parse").map((f) => f.message);
  assert.match(messages[0], /has no @context/);
  assert.match(messages[1], /not valid JSON/);
});

test("jsonld-id-resolves", async () => {
  const website = { "@type": "WebSite", "@id": `${ORIGIN}/#website`, url: `${ORIGIN}/`, publisher: { "@id": `${ORIGIN}/#organization` } };
  assert.equal(findings(await check(siteWith({ "index.html": page({ jsonld: [graph(org, website)] }) })), "jsonld-id-resolves").length, 0);
  const bad = await check(siteWith({ "index.html": page({ jsonld: [graph(website)] }) }));
  assert.match(findings(bad, "jsonld-id-resolves")[0].message, /which no typed node on this page defines/);
});

test("jsonld-noindex", async () => {
  const files = siteWith({
    "privacidad/index.html": page({ url: `${ORIGIN}/privacidad/`, robots: "noindex, follow", title: "Política de privacidad del sitio de prueba", jsonld: [graph(org)] }),
  });
  assert.match(findings(await check(files), "jsonld-noindex")[0].message, /a noindex page must carry no JSON-LD/);
});

test("searchaction: an error (regression: /search?q= gave 404)", async () => {
  const website = { "@type": "WebSite", "@id": `${ORIGIN}/#website`, url: `${ORIGIN}/`, potentialAction: { "@type": "SearchAction", target: `${ORIGIN}/search?q={q}`, "query-input": "required name=q" } };
  const result = await check(siteWith({ "index.html": page({ jsonld: [graph(website)] }) }));
  assert.equal(findings(result, "searchaction")[0].severity, "error");
  assert.equal(findings(result, "deprecated-type").length, 0, "SearchAction is reported once, by searchaction");
});

test("deprecated-type: ProfessionalService is a warning", async () => {
  const node = { ...org, "@type": "ProfessionalService", address: { "@type": "PostalAddress", streetAddress: "Calle 1", addressLocality: "Bogotá", addressCountry: "CO" } };
  const result = await check(siteWith({ "index.html": page({ jsonld: [graph(node)] }) }));
  assert.equal(findings(result, "deprecated-type")[0].severity, "warning");
});

test("local-address: the shared list (Dentist) and the legacy types", async () => {
  const full = { ...org, "@type": "Dentist", address: { "@type": "PostalAddress", streetAddress: "Calle 1", addressLocality: "Bogotá", addressCountry: "CO" } };
  assert.equal(findings(await check(siteWith({ "index.html": page({ jsonld: [graph(full)] }) })), "local-address").length, 0);
  const noStreet = { ...org, "@type": "Dentist", address: { "@type": "PostalAddress", addressLocality: "Bogotá", addressCountry: "CO" } };
  assert.match(findings(await check(siteWith({ "index.html": page({ jsonld: [graph(noStreet)] }) })), "local-address")[0].message, /streetAddress/);
  const attorney = { ...org, "@type": "Attorney" };
  assert.match(findings(await check(siteWith({ "index.html": page({ jsonld: [graph(attorney)] }) })), "local-address")[0].message, /no address/);
});

test("faq-visible", async () => {
  const faq = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "¿Pregunta oculta?", acceptedAnswer: { "@type": "Answer", text: "Sí" } }] };
  const result = await check(siteWith({ "index.html": page({ jsonld: [graph(faq)] }) }));
  assert.match(findings(result, "faq-visible")[0].message, /not in the visible text/);
});

test("breadcrumb-shape: at least 2 items, never on the home", async () => {
  const crumbs = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p, item: `${ORIGIN}${p}` })) });
  const ok = siteWith({ "nosotros/index.html": inner({ jsonld: [graph(crumbs(["/", "/nosotros/"]))] }) });
  assert.equal(findings(await check(ok), "breadcrumb-shape").length, 0);
  const home = siteWith({ "index.html": page({ jsonld: [graph(crumbs(["/"]))] }) });
  assert.match(findings(await check(home), "breadcrumb-shape")[0].message, /home page must have no BreadcrumbList; 1 item/);
});

test("external-url-http", async () => {
  const node = { ...org, sameAs: ["http://perfil.test/sitio"] };
  assert.match(findings(await check(siteWith({ "index.html": page({ jsonld: [graph(node)] }) })), "external-url-http")[0].message, /uses http:/);
});

// --- Head and canonical ----------------------------------------------------

test("title-description", async () => {
  const result = await check(siteWith({ "index.html": page({ description: null }) }));
  assert.match(findings(result, "title-description")[0].message, /no <meta name="description">/);
});

test("canonical-self: the home declares /home/ (regression)", async () => {
  const result = await check(siteWith({ "index.html": page({ canonical: `${ORIGIN}/home/` }) }));
  assert.match(findings(result, "canonical-self")[0].message, /canonical is https:\/\/sitio\.test\/home\/, expected https:\/\/sitio\.test\//);
  assert.match(findings(result, "url-resolves")[0].message, /\/home\/ .* leads to no page/);
});

test("canonical-self: https://x//ruta (regression: domain with a trailing slash + concatenation)", async () => {
  const result = await check(siteWith({ "nosotros/index.html": inner({ canonical: `${ORIGIN}//nosotros/` }) }));
  assert.match(findings(result, "canonical-self")[0].message, /canonical is https:\/\/sitio\.test\/\/nosotros\//);
});

test("canonical-self: a canonical on another domain (regression)", async () => {
  const result = await check(siteWith({ "nosotros/index.html": inner({ canonical: "https://otro-dominio.test/nosotros/" }) }));
  assert.match(findings(result, "canonical-self")[0].message, /otro-dominio/);
});

test("canonical-self: the 404 has none", async () => {
  const result = await check(siteWith({ "404.html": page({ url: `${ORIGIN}/404`, robots: "noindex, follow", description: null }) }));
  assert.match(findings(result, "canonical-self")[0].message, /the 404 must have no/);
});

test("robots-single", async () => {
  const result = await check(siteWith({ "index.html": page({ head: '<meta name="robots" content="index, follow">' }) }));
  assert.match(findings(result, "robots-single")[0].message, /2 <meta name="robots">/);
});

// --- Links -----------------------------------------------------------------

test("url-canonical-form: /ruta without the slash (regression: 301 on the host)", async () => {
  const result = await check(siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/nosotros">Nosotros</a>' }) }));
  assert.match(findings(result, "url-canonical-form")[0].message, /\/nosotros .* is not the canonical form .*: https:\/\/sitio\.test\/nosotros\//);
});

test("url-canonical-form: a relative breadcrumb item (regression)", async () => {
  const crumbs = { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Inicio", item: "/" }, { "@type": "ListItem", position: 2, name: "Nosotros", item: "/nosotros/" }] };
  const result = await check(siteWith({ "nosotros/index.html": inner({ jsonld: [graph(crumbs)] }) }));
  assert.match(findings(result, "url-canonical-form")[0].message, /is relative; JSON-LD needs the absolute URL/);
});

test("url-lowercase: camelCase routes (regression)", async () => {
  const result = await check(siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/quienesSomos/">Q</a>' }) }));
  assert.match(findings(result, "url-lowercase")[0].message, /uppercase letter in its path: \/quienesSomos\//);
});

test("url-resolves: an on-demand route exists without HTML in the build", async () => {
  const files = siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/nosotros/">N</a><a href="/contacto/">C</a>' }) });
  assert.match(findings(await check(files), "url-resolves")[0].message, /\/contacto\/ .* leads to no page/);
  assert.equal(findings(await check(files, { onDemand: ["/contacto"] }), "url-resolves").length, 0);
});

test("llms-links-resolve", async () => {
  const result = await check(siteWith({ "llms.txt": `# Sitio\n\n- [Falta](${ORIGIN}/no-existe/)\n- [Nosotros](${ORIGIN}/nosotros/)\n` }));
  const found = findings(result, "llms-links-resolve");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /no-existe/);
});

// --- Assets ----------------------------------------------------------------

test("asset-missing: a missing file is a warning", async () => {
  const result = await check(siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/nosotros/">N</a><img src="/falta.png" alt="">' }) }));
  assert.equal(findings(result, "asset-missing")[0].severity, "warning");
});

test("asset-missing: image-CDN URLs of any host are checked as the image they serve", async () => {
  const body = [
    '<h1>Inicio</h1><a href="/nosotros/">N</a>',
    '<img alt="" src="/.netlify/images?url=_astro/foto.webp&w=400">',
    '<img alt="" src="/_image?href=%2F_astro%2Ffoto.webp&w=400">',
    '<img alt="" src="/cdn-cgi/image/width=400,format=auto/_astro/foto.webp">',
    '<img alt="" src="/.netlify/images?url=https%3A%2F%2Fcdn.remoto.test%2Fx.jpg&w=400">',
  ].join("");
  const ok = await check(siteWith({ "index.html": page({ body }), "_astro/foto.webp": "img" }));
  assert.equal(findings(ok, "asset-missing").length, 0, ok.text);
  const missing = await check(siteWith({ "index.html": page({ body }) }));
  assert.equal(findings(missing, "asset-missing").length, 3, missing.text);
});

test("img-alt: alt is required, alt=\"\" is fine", async () => {
  const result = await check(siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/nosotros/">N</a><img src="/logo.png"><img src="/logo.png" alt="">' }) }));
  const found = findings(result, "img-alt");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
});

test("placeholder-text: an error with the real domain, a warning on example.com (plan Q2.2)", async () => {
  const files = siteWith({ "index.html": page({ body: '<h1>[CLIENTE] nombre</h1><a href="/nosotros/">N</a>' }) });
  assert.equal(findings(await check(files), "placeholder-text")[0].severity, "error");
  const preview = await check(files, { origin: "https://example.com" });
  assert.ok(findings(preview, "placeholder-text").every((f) => f.severity === "warning"));
});

test("404-empty: an empty 404 gets only 404-empty", async () => {
  const result = await check(siteWith({ "404.html": "  " }));
  const on404 = result.results.find((r) => r.label === "404.html").findings;
  assert.deepEqual(on404.map((f) => f.rule), ["404-empty"]);
});

test("partytown's sandbox page is not a page of the site", async () => {
  const result = await check(siteWith({ "~partytown/partytown-sandbox-sw.html": "<html><head><meta name=robots content=noindex></head></html>" }));
  assert.equal(result.pageCount, 2);
  assert.equal(result.errors, 0, result.text);
});

// --- New rules in v0.1 -----------------------------------------------------

test("h1: none or more than one is a warning on indexable pages", async () => {
  const none = await check(siteWith({ "index.html": page({ body: '<a href="/nosotros/">N</a>' }) }));
  assert.equal(findings(none, "h1")[0].message, "no <h1>");
  assert.equal(findings(none, "h1")[0].severity, "warning");
  const two = await check(siteWith({ "index.html": page({ body: '<h1>A</h1><h1>B</h1><a href="/nosotros/">N</a>' }) }));
  assert.match(findings(two, "h1")[0].message, /2 <h1>/);
  const svg = await check(siteWith({ "index.html": page({ body: '<h1>A</h1><template><h1>B</h1></template><a href="/nosotros/">N</a>' }) }));
  assert.equal(findings(svg, "h1").length, 0);
});

test("title-length and description-length: warnings only", async () => {
  const result = await check(siteWith({ "index.html": page({ title: "Corto", description: "Corta" }) }));
  assert.match(findings(result, "title-length")[0].message, /5 characters, expected about 30–60/);
  assert.equal(findings(result, "title-length")[0].severity, "warning");
  assert.match(findings(result, "description-length")[0].message, /5 characters, expected about 70–160/);
});

test("title-unique (error) and description-unique (warning)", async () => {
  const result = await check(siteWith({ "nosotros/index.html": page({ url: `${ORIGIN}/nosotros/`, description: DESCRIPTION }) }));
  const titles = findings(result, "title-unique");
  assert.deepEqual(titles.map((f) => f.label).sort(), ["index.html", "nosotros/index.html"]);
  assert.equal(titles[0].severity, "error");
  assert.equal(findings(result, "description-unique")[0].severity, "warning");
});

test("title-unique: noindex pages may share a title", async () => {
  const legal = (p) => page({ url: `${ORIGIN}${p}`, robots: "noindex, follow", title: "Texto legal del sitio de prueba" });
  const result = await check(siteWith({ "a/index.html": legal("/a/"), "b/index.html": legal("/b/") }));
  assert.equal(findings(result, "title-unique").length, 0);
});

test("sitemap-coverage: indexable pages in, noindex pages and the 404 out", async () => {
  const missing = await check({ ...cleanSite(), ...sitemap(["/"]) });
  assert.match(findings(missing, "sitemap-coverage")[0].message, /indexable page that is not in the sitemap: https:\/\/sitio\.test\/nosotros\//);
  const noindex = await check({
    ...cleanSite(),
    "privacidad/index.html": page({ url: `${ORIGIN}/privacidad/`, robots: "noindex, follow", title: "Política de privacidad del sitio de prueba" }),
    ...sitemap(["/", "/nosotros/", "/privacidad/"]),
  });
  const found = findings(noindex, "sitemap-coverage");
  assert.equal(found[0].label, "sitemap-0.xml");
  assert.match(found[0].message, /privacidad\/, which is a noindex page/);
  const none = await check({ "index.html": cleanSite()["index.html"], "nosotros/index.html": cleanSite()["nosotros/index.html"], "logo.png": "" });
  assert.match(findings(none, "sitemap-coverage")[0].message, /no sitemap-index\.xml or sitemap\.xml/);
});

// --- ignore (plan Q2.3) ----------------------------------------------------

test("ignore: removes the finding, lists it with its reason", async () => {
  const files = siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/quienesSomos/">Q</a><a href="/nosotros/">N</a>' }), "quienesSomos/index.html": inner({ url: `${ORIGIN}/quienesSomos/`, title: "Una tercera página con su propio título", description: "Una tercera descripción distinta de las otras, con longitud suficiente para las reglas." }), ...sitemap(["/", "/nosotros/", "/quienesSomos/"]) });
  const before = await check(files);
  assert.ok(findings(before, "url-lowercase").length > 0);
  const after = await check(files, { ignore: [{ rule: "url-lowercase", reason: "ruta heredada que posiciona" }] });
  assert.equal(findings(after, "url-lowercase").length, 0);
  assert.ok(after.ignored.length > 0);
  assert.match(after.text, /reason: ruta heredada que posiciona/);
});

test("ignore: path limits it to one place", async () => {
  const files = siteWith({ "index.html": page({ body: '<h1>Inicio</h1><a href="/nosotros/">N</a><img src="/a.png"><img src="/b.png" alt="">' }), "a.png": "", "b.png": "" });
  const scoped = await check(files, { ignore: [{ rule: "img-alt", path: "/nosotros/", reason: "otra página" }] });
  assert.equal(findings(scoped, "img-alt").length, 1);
  const home = await check(files, { ignore: [{ rule: "img-alt", path: "/", reason: "imagen decorativa en revisión" }] });
  assert.equal(findings(home, "img-alt").length, 0);
});

test("ignore: an entry with no reason, or an unknown rule, is refused", async () => {
  await assert.rejects(check(cleanSite(), { ignore: [{ rule: "img-alt" }] }), InputError);
  await assert.rejects(check(cleanSite(), { ignore: [{ rule: "img-alt", reason: "  " }] }), /has no reason/);
  await assert.rejects(check(cleanSite(), { ignore: [{ rule: "no-such-rule", reason: "x" }] }), /unknown rule/);
});
