// The SEO gate: an Astro integration that runs check-seo on the build output at the
// end of `astro build` and fails the build when it finds an error (plan Q2). It works
// the same locally and on any host: Netlify, Cloudflare or any CI stops the deploy
// when the build fails. It reads nothing from the host or the adapter (plan Q15).
//
//   // astro.config.mjs
//   integrations: [sitemap(), shineSeo()]          // after sitemap(), always
//
// The only valve is `ignore`, with a reason for every entry (plan Q2.3):
//   shineSeo({ ignore: [{ rule: 'url-lowercase', path: '/quienesSomos/', reason: '…' }] })
// Every build prints what it ignored.
//
// Verified on 2026-10-14 (plan §4.2) with Astro 6.1 and 7.3, with no adapter, with
// @astrojs/netlify and with @astrojs/cloudflare:
// - `dir` is the folder with the HTML in all of them (dist/, or dist/client/ on
//   Cloudflare);
// - `assets` maps each route to its files; an on-demand route (prerender = false)
//   maps to none, so check-seo knows it exists without HTML in the build;
// - an error thrown here makes `astro build` exit with 1;
// - @astrojs/sitemap writes the sitemap in its own astro:build:done, so this
//   integration must come after it.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDist } from "../check-seo/index.mjs";
import { validateIgnore } from "../check-seo/run.mjs";

const NAME = "@shine/seo-core";
const SITEMAP = "@astrojs/sitemap";

/**
 * @param {{ ignore?: { rule: string, path?: string, reason: string }[] }} [options]
 * @returns {import('astro').AstroIntegration}
 */
export default function shineSeo(options = {}) {
  const ignore = options.ignore ?? [];
  let config;

  return {
    name: NAME,
    hooks: {
      "astro:config:done": ({ config: done }) => {
        config = done;
        validateIgnore(ignore);
        if (!done.site) {
          throw new Error(`${NAME}: set \`site\` in astro.config (https://example.com until the real domain exists)`);
        }
        const names = done.integrations.map((integration) => integration.name);
        if (names.includes(SITEMAP) && names.indexOf(SITEMAP) > names.indexOf(NAME)) {
          throw new Error(
            `${NAME}: shineSeo() must come after sitemap() in \`integrations\`, or the gate runs before the sitemap exists`,
          );
        }
      },

      "astro:build:done": async ({ dir, assets, logger }) => {
        const onDemand = [...assets]
          .filter(([, files]) => files.length === 0)
          .map(([route]) => route);
        const folder = fileURLToPath(dir);
        const result = await checkDist({
          dir: folder,
          origin: new URL(config.site).origin,
          onDemand,
          ignore,
          label: path.relative(fileURLToPath(config.root), folder) || ".",
        });

        if (result.failed) {
          logger.error(result.text);
          throw new Error(
            `check-seo found ${result.errors} error${result.errors === 1 ? "" : "s"}, so the build stops here. ` +
              "Fix them; if one cannot be fixed now, add it to shineSeo({ ignore }) with its reason.",
          );
        }
        if (result.warnings > 0 || result.ignored.length > 0) logger.warn(result.text);
        else logger.info(result.text);
      },
    },
  };
}
