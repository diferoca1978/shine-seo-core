// Helpers for astro.config, which Node loads as is: plain .mjs, no TypeScript.

/**
 * A filter for @astrojs/sitemap that leaves out every page marked `noindex` in
 * src/config/pages.ts, so `noindex` is the one place that decides both the meta robots
 * and the sitemap (plan Q3). @astrojs/sitemap passes the full URL, with the domain.
 *
 *   sitemap({ filter: sitemapFilter(PAGES) })
 *
 * @param {Record<string, { path: string, noindex?: boolean }>} pages
 * @returns {(page: string) => boolean}
 */
export function sitemapFilter(pages) {
  const excluded = new Set(
    Object.values(pages)
      .filter((page) => page.noindex)
      .map((page) => withoutSlash(page.path)),
  );
  return (page) => !excluded.has(withoutSlash(new URL(page).pathname));
}

/** @param {string} pathname */
function withoutSlash(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}
