// Absolute URLs. A project builds every absolute URL with siteUrl() or mediaUrl(); it
// never writes the domain by hand.
//
// createSiteUrl() is a pure function: it reads no configuration. Each project passes
// its own Astro config through a two-line wrapper in src/utils/url.ts:
//
//   import { site, trailingSlash, base, build } from 'astro:config/client';
//   export const { siteUrl, mediaUrl } = createSiteUrl({ site, trailingSlash, base, build });

export interface SiteUrlConfig {
  site: string | undefined;
  trailingSlash?: 'always' | 'never' | 'ignore';
  base?: string;
  build?: { format?: 'directory' | 'file' | 'preserve' };
}

export interface SiteUrl {
  siteUrl: (path: string) => string;
  mediaUrl: (src: string) => string;
}

// Same rule as path.posix.extname() in check-seo: a dot only at the start of the segment,
// or the segment '..', is not an extension.

function hasExtension(segment: string): boolean {
  const dot = segment.lastIndexOf('.');
  return dot > 0 && segment !== '..';
}

function checkPath(fn: string, path: string): void {
  if (!path.startsWith('/')) {
    throw new Error(`${fn}(): the path must start with '/', got '${path}'`);
  }
  if (path.startsWith('//')) {
    throw new Error(`${fn}(): the path must not start with '//' (another host), got '${path}'`);
  }
}

function splitSuffix(path: string): [pathname: string, suffix: string] {
  const cut = path.search(/[?#]/);
  return cut === -1 ? [path, ''] : [path.slice(0, cut), path.slice(cut)];
}

// Whether a page URL ends in '/'. It follows the project's trailingSlash, so a site that
// ranks without the slash keeps its URLs. With 'ignore', the URL the host serves depends
// on the output: build.format 'file' writes /about.html (served as /about), and
// 'directory' writes /about/index.html (served as /about/).

function wantsSlash(config: SiteUrlConfig): boolean {
  const trailingSlash = config.trailingSlash ?? 'ignore';
  if (trailingSlash === 'always') return true;
  if (trailingSlash === 'never') return false;
  return config.build?.format !== 'file';
}

export function createSiteUrl(config: SiteUrlConfig): SiteUrl {
  const { site } = config;
  if (!site) {
    throw new Error("createSiteUrl(): `site` is not set; define it in astro.config");
  }
  try {
    new URL(site);
  } catch {
    throw new Error(`createSiteUrl(): \`site\` is not an absolute URL, got '${site}'`);
  }

  const slash = wantsSlash(config);
  const base = (config.base ?? '/').replace(/\/+$/, '');

  // `path` starts with '/', but not '//' (new URL would read that as another host). Its
  // ?query and #fragment are kept as they are. A page path (no extension in the last
  // segment) must be lowercase once percent-decoded (the same test as check-seo's
  // url-lowercase) and gets the trailing slash the project uses. An asset path (with an
  // extension) is left as it is.

  function siteUrl(path: string): string {
    checkPath('siteUrl', path);
    const [own, suffix] = splitSuffix(path);
    let pathname = base + own;
    const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);

    if (!hasExtension(lastSegment)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        throw new Error(`siteUrl(): malformed percent-escape in the path '${path}'`);
      }
      if (/\p{Lu}/u.test(decoded)) {
        throw new Error(`siteUrl(): page paths must be lowercase, got '${path}'`);
      }
      if (slash && !pathname.endsWith('/')) pathname += '/';
      if (!slash && pathname !== '/') pathname = pathname.replace(/\/+$/, '');
    }

    return new URL(pathname + suffix, site).href;
  }

  // For media fields only (an image, a logo, a video). It never adds a slash and never
  // checks case: /_astro/Photo.webp and /.netlify/images?url=… are left as they are.
  // `src` is an https:// URL, a protocol-relative '//host/…' (some CMSs return it; it
  // becomes https:), or a path on this site. Anything else throws, http: included.

  function mediaUrl(src: string): string {
    if (src.startsWith('https://')) return absoluteUrl(src, src);
    if (src.startsWith('//')) return absoluteUrl(`https:${src}`, src);
    if (src.startsWith('/')) return new URL(base + src, site).href;

    throw new Error(`mediaUrl(): expected a path on this site or an https:// URL, got '${src}'`);
  }

  return { siteUrl, mediaUrl };
}

function absoluteUrl(href: string, src: string): string {
  try {
    return new URL(href).href;
  } catch {
    throw new Error(`mediaUrl(): not a valid URL, got '${src}'`);
  }
}
