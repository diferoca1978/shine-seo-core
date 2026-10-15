// End-to-end check of the package in real Astro builds (plan F1 exit criterion):
// the fixture site is installed with this package from a git tag, as a client would
// install it, and built with each configuration below. For each one:
//   1. the build passes and the gate reports 0 errors;
//   2. with a broken page added (a link without the trailing slash), the build fails;
//   3. (static only) `astro check` accepts the package's types.
//
// Usage: node test/e2e/run.mjs [config…]       (default: all of them)
// Needs network access for pnpm. Work files go to test/e2e/.work/ (git-ignored).

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixture/", import.meta.url));
const WORK = fileURLToPath(new URL("./.work/", import.meta.url));
const TAG = "v0.0.0-e2e";

const CONFIGS = {
  static: { astro: "7.3.8", check: true },
  netlify: { astro: "7.3.8", adapter: ["@astrojs/netlify", "8.2.9", "netlify"] },
  cloudflare: { astro: "7.3.8", adapter: ["@astrojs/cloudflare", "14.3.4", "cloudflare"] },
  "netlify-astro6": { astro: "6.1.8", adapter: ["@astrojs/netlify", "7.0.7", "netlify"] },
};

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function must(result, what) {
  if (result.code !== 0) {
    console.error(result.out);
    throw new Error(`${what} failed (exit ${result.code})`);
  }
  return result;
}

/** The working tree, committed and tagged in its own throwaway repo: what a client installs. */
async function packRepo() {
  const pkg = path.join(WORK, "pkg");
  await rm(pkg, { recursive: true, force: true });
  await mkdir(pkg, { recursive: true });
  for (const entry of ["package.json", "src", "check-seo", "integration"]) {
    await cp(path.join(ROOT, entry), path.join(pkg, entry), { recursive: true });
  }
  const git = (...args) => must(run("git", args, pkg), `git ${args[0]}`);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=e2e", "-c", "user.email=e2e@local", "commit", "-qm", "e2e");
  git("tag", TAG);
  return pkg;
}

async function makeSite(name, config, pkg) {
  const dir = path.join(WORK, name);
  await rm(dir, { recursive: true, force: true });
  await cp(FIXTURE, dir, { recursive: true });

  const dependencies = {
    astro: config.astro,
    "@astrojs/sitemap": "3.7.4",
    "@shine/seo-core": `git+file://${pkg}#${TAG}`,
  };
  const devDependencies = config.check ? { "@astrojs/check": "0.9.10", typescript: "6.0.3" } : {};
  let astroConfig = await readFile(path.join(dir, "astro.config.mjs"), "utf8");
  if (config.adapter) {
    const [name, version, id] = config.adapter;
    dependencies[name] = version;
    astroConfig = astroConfig
      .replace("/* ADAPTER_IMPORT */", `import ${id} from '${name}';`)
      .replace("/* ADAPTER_USE */", `adapter: ${id}(),`);
    // An on-demand page: the gate must know it exists without HTML in the build.
    await writeFile(
      path.join(dir, "src/pages/contacto.astro"),
      "---\nexport const prerender = false;\n---\n<html><head><title>Contacto</title></head><body><h1>Contacto</h1></body></html>\n",
    );
    // …and a link to it, which url-resolves must accept.
    const layout = path.join(dir, "src/layouts/Layout.astro");
    await writeFile(layout, (await readFile(layout, "utf8")).replace("</nav>", ' <a href="/contacto/">Contacto</a></nav>'));
  }
  await writeFile(path.join(dir, "astro.config.mjs"), astroConfig);
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `e2e-${name}`, private: true, type: "module", dependencies, devDependencies }, null, 2),
  );
  await writeFile(path.join(dir, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n  sharp: true\n  workerd: true\n");
  return dir;
}

const BROKEN_PAGE = `---
import Layout from '../layouts/Layout.astro';
import { seo } from '../config/seo';
---
<Layout head={seo.pageHead({ path: '/roto/', title: 'Una página rota a propósito para la prueba', description: 'Enlaza a nosotros sin la barra final, como hacían los sitios antes del hotfix de URLs.' })}>
  <h1>Página rota</h1>
  <a href="/nosotros">Nosotros sin barra</a>
</Layout>
`;

async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CONFIGS);
  const pkg = await packRepo();
  const summary = [];
  for (const name of names) {
    const config = CONFIGS[name];
    if (!config) throw new Error(`unknown config ${name}; one of ${Object.keys(CONFIGS).join(", ")}`);
    console.log(`\n=== ${name} (astro ${config.astro}${config.adapter ? `, ${config.adapter[0]} ${config.adapter[1]}` : ""})`);
    const dir = await makeSite(name, config, pkg);
    must(run("pnpm", ["install", "--reporter=append-only"], dir), "pnpm install");

    const ok = run("pnpm", ["exec", "astro", "build"], dir);
    const gate = ok.out.split("\n").filter((l) => /seo-core|pages?, \d+ errors?/.test(l));
    console.log(gate.join("\n"));
    if (ok.code !== 0) {
      console.error(ok.out);
      throw new Error(`${name}: the clean build failed`);
    }
    if (!/\d+ pages?, 0 errors/.test(ok.out)) throw new Error(`${name}: the gate did not report 0 errors`);
    const sitemapFile = path.join(dir, name === "cloudflare" ? "dist/client" : "dist", "sitemap-0.xml");
    const locs = [...(await readFile(sitemapFile, "utf8")).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (locs.some((loc) => loc.includes("politica-privacidad"))) throw new Error(`${name}: sitemapFilter(PAGES) let the noindex page in`);

    if (config.check) {
      must(run("pnpm", ["exec", "astro", "check"], dir), "astro check");
      console.log("astro check: 0 errors");
    }

    await writeFile(path.join(dir, "src/pages/roto.astro"), BROKEN_PAGE);
    const broken = run("pnpm", ["exec", "astro", "build"], dir);
    if (broken.code === 0) throw new Error(`${name}: the build with a broken page passed`);
    if (!/url-canonical-form/.test(broken.out)) {
      console.error(broken.out);
      throw new Error(`${name}: the broken build failed, but not on url-canonical-form`);
    }
    console.log(`broken page: build exits ${broken.code} on url-canonical-form`);
    summary.push(`${name}: ok`);
  }
  console.log(`\n${summary.join("\n")}`);
}

main().catch((err) => {
  console.error(`\ne2e: ${err.message}`);
  process.exitCode = 1;
});
