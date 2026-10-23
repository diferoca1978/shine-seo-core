// Head tags and JSON-LD generators. Every input is a parameter: the project passes its
// own data and its siteUrl()/mediaUrl() to createSeo() once, in src/config/seo.ts.
//
// The JSON-LD follows the reference (seo-schema-org-buenas-practicas-2026.md):
// - one @graph per page (§12): the generators return nodes, graph() wraps them;
// - WebSite only on the home, without SearchAction (§6.1, §5.2);
// - the full business node only on the home or the about page; every other page
//   references it by @id with its name and url (§7.1);
// - the most specific LocalBusiness subtype, never ProfessionalService (§6.3, §6.7);
// - every @id and url built with siteUrl(), so it equals the canonical (§7.1).
// FAQPage is not generated: the FAQ rich result stopped showing on 2026-05-07 (§5.2).

import type { SiteUrl } from './url.ts';
import type {
  Author,
  BreadcrumbItem,
  Company,
  DayOfWeek,
  HeadData,
  JsonLdNode,
  OpeningHours,
  PageSeo,
} from './types.ts';

export interface SeoOptions extends SiteUrl {
  company: Company;
  authors?: Author[];
  locale: string; // BCP 47, e.g. 'es-CO'
}

export interface PageHeadInput extends Pick<PageSeo, 'path' | 'title' | 'description' | 'noindex'> {
  image?: string; // a path on this site or an https:// URL; default: company.image
}

function sameAs(socialMedia: Record<string, string> = {}): { sameAs?: string[] } {
  const urls = Object.values(socialMedia);
  return urls.length > 0 ? { sameAs: urls } : {};
}

const DAYS_OF_WEEK: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// One OpeningHoursSpecification (reference §6.3). It throws on a value Google would
// misread: `astro build` does not type-check, so a 'Lunes' or a '9am' would ship silently.
function openingHoursNode(hours: OpeningHours): JsonLdNode {
  const fail = (message: string): never => {
    throw new Error(`businessNode(): ${message} in hours ${JSON.stringify(hours)}`);
  };
  if (!hours.days?.length) fail('no days');
  for (const day of hours.days) {
    if (!DAYS_OF_WEEK.includes(day)) fail(`'${day}' is not a DayOfWeek`);
  }
  for (const key of ['opens', 'closes'] as const) {
    if (!TIME.test(hours[key])) fail(`${key} is not HH:MM`);
  }
  if (Boolean(hours.validFrom) !== Boolean(hours.validThrough)) {
    fail('validFrom and validThrough go together');
  }
  for (const key of ['validFrom', 'validThrough'] as const) {
    const date = hours[key];
    if (date !== undefined && !DATE.test(date)) fail(`${key} is not YYYY-MM-DD`);
  }

  return {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: hours.days,
    opens: hours.opens,
    closes: hours.closes,
    ...(hours.validFrom && { validFrom: hours.validFrom, validThrough: hours.validThrough }),
  };
}

export function createSeo(options: SeoOptions) {
  const { company, authors = [], locale, siteUrl, mediaUrl } = options;
  const businessType = company.business.kind === 'local' ? company.business.type : 'Organization';
  const businessId = siteUrl('/#organization');
  const websiteId = siteUrl('/#website');
  const personId = (slug: string) => siteUrl(`/#person-${slug}`);

  // The page title: `<title> | <company name>`, unless the title already holds the name.
  function fullTitle(title: string): string {
    return title.includes(company.name) ? title : `${title} | ${company.name}`;
  }

  // An indexable or noindex page. canonical and og:url are the page's own URL.
  function pageHead(page: PageHeadInput): HeadData {
    const title = fullTitle(page.title);
    const url = siteUrl(page.path);
    const image = mediaUrl(page.image ?? company.image);

    return {
      title,
      description: page.description,
      canonical: url,
      robots: page.noindex ? 'noindex, follow' : 'index, follow',
      openGraph: {
        type: 'website',
        title,
        description: page.description,
        url,
        image,
        siteName: company.name,
        locale: locale.replaceAll('-', '_'),
      },
      twitter: { card: 'summary_large_image', title, description: page.description, image },
    };
  }

  // The 404: a title and noindex only. No canonical, no description, no Open Graph, and
  // SeoHead emits no JSON-LD on a noindex page.
  function notFoundHead(options: { title: string }): HeadData {
    return { title: fullTitle(options.title), robots: 'noindex, follow' };
  }

  // The full business node: Organization when `remote`, its LocalBusiness subtype when
  // `local`. Only on the home or the about page; elsewhere use businessRef().
  function businessNode(): JsonLdNode {
    const { business } = company;
    const founders = company.founders ?? [];
    const alternateNames = company.alternateName ?? [];
    const hours = business.kind === 'local' ? (business.hours ?? []) : [];

    return {
      '@type': businessType,
      '@id': businessId,
      name: company.name,
      ...(alternateNames.length > 0 && { alternateName: alternateNames }),
      description: company.description,
      url: siteUrl('/'),
      logo: mediaUrl(company.logo),
      image: mediaUrl(company.image),
      telephone: company.phone,
      email: company.email,
      ...sameAs(company.socialMedia),
      ...(business.address && {
        address: {
          '@type': 'PostalAddress',
          ...(business.kind === 'local' && { streetAddress: business.address.street }),
          addressLocality: business.address.city,
          addressRegion: business.address.region,
          ...(business.kind === 'local' &&
            business.address.postalCode && { postalCode: business.address.postalCode }),
          addressCountry: business.address.countryCode,
        },
      }),
      ...(business.kind === 'local' &&
        business.geo && {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: business.geo.latitude,
            longitude: business.geo.longitude,
          },
        }),
      ...(hours.length > 0 && { openingHoursSpecification: hours.map(openingHoursNode) }),
      ...(company.foundingDate && { foundingDate: company.foundingDate }),
      ...(founders.length > 0 && { founder: founders.map((slug) => ({ '@id': personId(slug) })) }),
    };
  }

  // The business on any other page: its @id plus name and url, so that page's graph
  // reads on its own (reference §7.1). Always typed Organization, which every
  // LocalBusiness subtype is: a LegalService node with no address would fail
  // check-seo's local-address (and Google's required `address`, reference §6.3).
  function businessRef(): JsonLdNode {
    return { '@type': 'Organization', '@id': businessId, name: company.name, url: siteUrl('/') };
  }

  // Only on the home (reference §6.1).
  function websiteNode(): JsonLdNode {
    return {
      '@type': 'WebSite',
      '@id': websiteId,
      name: company.name,
      url: siteUrl('/'),
      inLanguage: locale,
      publisher: { '@id': businessId },
    };
  }

  function findAuthor(slug: string): Author {
    const author = authors.find((candidate) => candidate.slug === slug);
    if (!author) throw new Error(`createSeo(): no Author with the slug '${slug}'`);
    return author;
  }

  // A person, anchored to the business via worksFor. The address belongs to the
  // business, not the person.
  function personNode(authorOrSlug: Author | string): JsonLdNode {
    const author = typeof authorOrSlug === 'string' ? findAuthor(authorOrSlug) : authorOrSlug;
    return {
      '@type': 'Person',
      '@id': personId(author.slug),
      name: author.name,
      jobTitle: author.role,
      description: author.bio,
      ...(author.image && { image: mediaUrl(author.image) }),
      ...(author.url && { url: siteUrl(author.url) }),
      ...sameAs(author.socialMedia),
      worksFor: { '@id': businessId },
    };
  }

  // The home's nodes: the business, the WebSite and one Person per founder.
  function homeNodes(): JsonLdNode[] {
    return [businessNode(), websiteNode(), ...(company.founders ?? []).map(personNode)];
  }

  // Only when the breadcrumbs are visible on the page (reference §6.5), never on the
  // home, and with at least 2 items (check-seo's breadcrumb-shape).
  function breadcrumbNode(items: BreadcrumbItem[]): JsonLdNode {
    if (items.length < 2) {
      throw new Error(`breadcrumbNode(): a BreadcrumbList needs at least 2 items, got ${items.length}`);
    }
    return {
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: siteUrl(item.path),
      })),
    };
  }

  return {
    pageHead,
    notFoundHead,
    businessNode,
    businessRef,
    websiteNode,
    personNode,
    homeNodes,
    breadcrumbNode,
  };
}

// One JSON-LD document per page: every node in a single @graph (reference §12).
export function graph(nodes: JsonLdNode[]): JsonLdNode {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
