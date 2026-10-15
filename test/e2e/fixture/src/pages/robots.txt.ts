import type { APIRoute } from 'astro';
import { robotsTxt } from '@shine/seo-core';

export const GET: APIRoute = ({ site }) =>
  new Response(robotsTxt({ site: site! }), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
