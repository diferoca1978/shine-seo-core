// check-seo --url against local servers: which requests carry the --header headers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { checkUrl } from "../check-seo/index.mjs";
import { sendsHeaders } from "../check-seo/live.mjs";
import { page } from "./helpers.mjs";

/** A server that answers from `routes` (path → body, or a function of the origins) and records each request's headers. */
async function serve(routes) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers });
    const body = routes[req.url];
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": req.url.endsWith(".xml") ? "application/xml" : "text/html" });
    res.end(typeof body === "function" ? body() : body);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, seen, port: server.address().port };
}

const urlset = (...locs) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const sitemapIndex = (...locs) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;

test("--header goes only to the site itself (regression: a sitemap on another host got the WAF secret)", async (t) => {
  let site = "";
  let other = "";
  const ext = await serve({
    "/sitemap.xml": () => urlset(`${other}/externa/`),
    "/sitemap-1.xml": () => urlset(`${other}/otra/`),
  });
  const own = await serve({
    "/robots.txt": () => `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap-index.xml\nSitemap: ${other}/sitemap.xml\n`,
    "/sitemap-index.xml": () => sitemapIndex(`${site}/sitemap-0.xml`, `${other}/sitemap-1.xml`),
    "/sitemap-0.xml": () => urlset(`${site}/`),
    "/": () => page({ url: `${site}/`, body: `<h1>Título</h1><a href="${other}/enlace/">fuera</a>` }),
  });
  t.after(() => {
    own.server.close();
    ext.server.close();
  });
  // Same machine, two hosts: the site on 127.0.0.1, the other one on localhost.
  site = `http://127.0.0.1:${own.port}`;
  other = `http://localhost:${ext.port}`;

  await checkUrl({ origin: site, headers: { "X-Check": "secreto" } });

  assert.ok(own.seen.length > 0);
  for (const { path, headers } of own.seen) {
    assert.equal(headers["x-check"], "secreto", `${path} on the site should carry the header`);
    assert.equal(headers["user-agent"], "shine-seo-core-check-seo");
  }
  assert.deepEqual(ext.seen.map((r) => r.path).sort(), ["/sitemap-1.xml", "/sitemap.xml"]);
  for (const { path, headers } of ext.seen) {
    assert.equal(headers["x-check"], undefined, `${path} on another host got the header`);
    assert.equal(headers["user-agent"], "shine-seo-core-check-seo");
  }
});

test("sendsHeaders: same host and scheme only, www. aside", () => {
  const origin = "https://sitio.test";
  assert.equal(sendsHeaders("https://sitio.test/a/", origin), true);
  assert.equal(sendsHeaders("https://www.sitio.test/a/", origin), true);
  assert.equal(sendsHeaders("http://sitio.test/a/", origin), false);
  assert.equal(sendsHeaders("https://otro.test/sitemap.xml", origin), false);
  assert.equal(sendsHeaders("https://cdn.sitio.test/a.png", origin), false);
});

const CLI = new URL("../check-seo/cli.mjs", import.meta.url).pathname;
const run = (args) =>
  new Promise((resolve) =>
    execFile(process.execPath, [CLI, ...args], (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    ),
  );

test("--ignore-file: the CLI drops the ignored finding and says why", async (t) => {
  let site = "";
  // /b/ canonicalizes to /, so the link to it is not the canonical form of where it leads.
  const own = await serve({
    "/robots.txt": () => `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`,
    "/sitemap.xml": () => urlset(`${site}/`),
    "/": () => page({ url: `${site}/`, body: `<h1>Título</h1><a href="/b/">b</a>` }),
    "/b/": () => page({ url: `${site}/b/`, canonical: `${site}/` }),
  });
  const dir = await mkdtemp(path.join(tmpdir(), "ignore-"));
  t.after(() => own.server.close());
  site = `http://127.0.0.1:${own.port}`;

  const without = await run(["--url", site]);
  assert.equal(without.code, 1);
  assert.match(without.stdout, /url-canonical-form/);

  const file = path.join(dir, "ignore.json");
  await writeFile(file, JSON.stringify([{ rule: "url-canonical-form", path: "/", reason: "Canonical a propósito (spec 15)" }]));
  const withIgnore = await run(["--url", site, "--ignore-file", file]);
  assert.equal(withIgnore.code, 0);
  assert.doesNotMatch(withIgnore.stdout, /error\s+url-canonical-form/);
  assert.match(withIgnore.stdout, /Canonical a propósito \(spec 15\)/);
});

test("--ignore-file: a missing file, bad JSON, a non-array or an entry without reason exit 2", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ignore-"));
  const bad = async (name, content) => {
    const file = path.join(dir, name);
    if (content !== undefined) await writeFile(file, content);
    return run(["--url", "http://127.0.0.1:9", "--ignore-file", file]);
  };
  for (const r of [
    await bad("missing.json"),
    await bad("syntax.json", "{"),
    await bad("object.json", "{}"),
    await bad("no-reason.json", JSON.stringify([{ rule: "url-canonical-form" }])),
  ]) {
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /^check-seo: /m);
  }
});
