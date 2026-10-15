// robots.txt: every crawler may crawl everything, the AI search and user-fetch agents
// are named explicitly, and the sitemap is declared (reference §10.1). The route itself
// lives in each project:
//
//   // src/pages/robots.txt.ts
//   import type { APIRoute } from 'astro';
//   import { robotsTxt } from '@shine/seo-core';
//   export const GET: APIRoute = ({ site }) =>
//     new Response(robotsTxt({ site: site! }), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
//
// On Cloudflare, check the robots.txt the site serves, not this one: with Bot Preference
// Sync, Cloudflare puts its own directives in front of it (plan §4.7).

export const AI_SEARCH_AGENTS = [
  'ChatGPT-User',
  'OAI-SearchBot',
  'Claude-User',
  'Claude-SearchBot',
  'Perplexity-User',
  'PerplexityBot',
];

export function robotsTxt(options: { site: URL | string; sitemap?: string }): string {
  const sitemap = new URL(options.sitemap ?? 'sitemap-index.xml', options.site).href;
  const groups = ['*', ...AI_SEARCH_AGENTS].map((agent) => `User-agent: ${agent}\nAllow: /`);
  return `${groups.join('\n\n')}\n\nSitemap: ${sitemap}\n`;
}
