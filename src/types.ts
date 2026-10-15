// Types only. A project keeps its data in src/config/ (company.ts, authors.ts, pages.ts)
// and shapes it with these types.

import type { LOCAL_BUSINESS_TYPES } from './shared/business-types.mjs';

export type JsonLdNode = Record<string, unknown>;

// The LocalBusiness subtypes a `local` business may use (src/shared/business-types.mjs).
export type LocalBusinessType = (typeof LOCAL_BUSINESS_TYPES)[number];

// remote: the client receives no visitors at an address, so it cannot hold a street, a
// postal code or geo. local: a real address that the site shows.
export type Business =
  | {
      kind: 'remote';
      address?: { city: string; region: string; countryCode: string };
    }
  | {
      kind: 'local';
      type: LocalBusinessType;
      address: {
        street: string;
        city: string;
        region: string;
        postalCode?: string;
        countryCode: string; // ISO 3166-1 alpha-2 (reference §4.4)
      };
      geo?: { latitude: number; longitude: number }; // ≥ 5 decimals (reference §4.4)
    };

export interface Company {
  name: string; // the site name too: WebSite.name and the title suffix
  description: string;
  phone: string; // with the country code: +57…
  email: string;
  business: Business;
  logo: string; // a path on this site or an https:// URL; ≥ 112 px (reference §4.4)
  image: string; // the default og:image; a path on this site or an https:// URL
  foundingDate?: string;
  founders?: string[]; // Author slugs, not names
  socialMedia?: Record<string, string>; // official profile URLs only → sameAs
}

export interface Author {
  slug: string; // ASCII kebab-case, unique, stable: the Person @id is <site>/#person-<slug>
  name: string; // no titles ("Dr") inside the name; the role goes in `role` (reference §6.4)
  role: string;
  bio: string;
  image?: string; // a path on this site or an https:// URL
  socialMedia?: Record<string, string>; // official profile URLs only → sameAs
  url?: string; // the author's page on this site, as a path
}

// One entry of src/config/pages.ts: the single source of a page's SEO. The page reads
// its title, description and h1 from here, so the HTML matches the manifest.
export interface PageSeo {
  path: string;
  keyword?: string; // from the brief; never published
  title: string;
  description: string;
  h1: string;
  source: string; // where the copy comes from, e.g. 'textos-sitio.md §1'
  noindex?: boolean; // meta robots noindex and out of the sitemap
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

// What SeoHead renders. Built by createSeo().pageHead() or .notFoundHead().
export interface HeadData {
  title: string;
  description?: string;
  canonical?: string;
  robots: string;
  openGraph?: {
    type: string;
    title: string;
    description: string;
    url: string;
    image: string;
    siteName: string;
    locale: string;
  };
  twitter?: {
    card: 'summary' | 'summary_large_image';
    title: string;
    description: string;
    image: string;
  };
}
