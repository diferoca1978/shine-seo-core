// Fixtures for the check-seo tests: a fake build in a temp folder, written from a map
// of files. Every fixture is made up; no client is named (AGENTS.md).

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkDist } from "../check-seo/index.mjs";

export const ORIGIN = "https://sitio.test";

export const TITLE = "Asesoría de prueba para empresas en Bogotá";
export const DESCRIPTION =
  "Una descripción de prueba con la longitud justa para que ninguna regla de longitud avise.";

/**
 * One page of HTML. Every part has a default that passes every rule, so a test changes
 * only what it is about. `jsonld` is a list of blocks (objects, or strings written as is).
 */
export function page({
  url = `${ORIGIN}/`,
  title = TITLE,
  description = DESCRIPTION,
  canonical = url,
  robots = "index, follow",
  jsonld = [],
  head = "",
  body = "<h1>Título</h1>",
} = {}) {
  const tags = [
    title === null ? "" : `<title>${title}</title>`,
    description === null ? "" : `<meta name="description" content="${description}">`,
    canonical === null ? "" : `<link rel="canonical" href="${canonical}">`,
    robots === null ? "" : `<meta name="robots" content="${robots}">`,
    ...jsonld.map(
      (block) =>
        `<script type="application/ld+json">${typeof block === "string" ? block : JSON.stringify(block)}</script>`,
    ),
    head,
  ];
  return `<!doctype html><html lang="es"><head>${tags.join("")}</head><body>${body}</body></html>`;
}

/** A sitemap index and one sitemap listing `paths` on ORIGIN. */
export function sitemap(paths, origin = ORIGIN) {
  const urls = paths.map((p) => `<url><loc>${origin}${p}</loc></url>`).join("");
  return {
    "sitemap-index.xml": `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
    "sitemap-0.xml": `<?xml version="1.0"?><urlset>${urls}</urlset>`,
  };
}

/** Writes `files` ({ 'nosotros/index.html': '…' }) to a new temp folder. */
export async function writeBuild(files) {
  const dir = await mkdtemp(path.join(tmpdir(), "check-seo-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return dir;
}

/** Writes the build and checks it. */
export async function check(files, options = {}) {
  const dir = await writeBuild(files);
  return checkDist({ dir, origin: ORIGIN, ...options });
}

/** The findings of one rule: [{ label, severity, message }]. */
export function findings(result, rule) {
  return result.results.flatMap((r) =>
    r.findings.filter((f) => f.rule === rule).map((f) => ({ label: r.label, ...f })),
  );
}

/** A home and an inner page that pass every rule, plus their sitemap. */
export function cleanSite() {
  return {
    "index.html": page({ body: '<h1>Inicio</h1><a href="/nosotros/">Nosotros</a>' }),
    "nosotros/index.html": page({
      url: `${ORIGIN}/nosotros/`,
      title: "Quiénes somos: el equipo de asesoría de prueba",
      description: "Otra descripción de prueba, distinta de la home y con longitud suficiente para las reglas.",
      body: '<h1>Nosotros</h1><img src="/logo.png" alt="Logo">',
    }),
    "logo.png": "png",
    ...sitemap(["/", "/nosotros/"]),
  };
}
