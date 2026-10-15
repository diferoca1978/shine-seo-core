import { site, trailingSlash, base, build } from 'astro:config/client';
import { createSiteUrl } from '@shine/seo-core';

export const { siteUrl, mediaUrl } = createSiteUrl({ site, trailingSlash, base, build });
