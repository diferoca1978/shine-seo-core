// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import shineSeo from '@shine/seo-core/integration';
import { sitemapFilter } from '@shine/seo-core/config';
import { PAGES } from './src/config/pages.ts';
/* ADAPTER_IMPORT */

export default defineConfig({
  site: 'https://sitio-e2e.test',
  trailingSlash: 'always',
  /* ADAPTER_USE */
  integrations: [sitemap({ filter: sitemapFilter(PAGES) }), shineSeo()],
});
