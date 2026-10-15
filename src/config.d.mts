export declare function sitemapFilter(
  pages: Record<string, { path: string; noindex?: boolean }>,
): (page: string) => boolean;
