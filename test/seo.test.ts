import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteUrl } from '../src/url.ts';
import { createSeo, graph } from '../src/seo.ts';
import type { Company } from '../src/types.ts';

const urls = createSiteUrl({ site: 'https://example.com', trailingSlash: 'always' });

const remote: Company = {
  name: 'Ejemplo',
  description: 'Una empresa de ejemplo',
  phone: '+57 300 000 0000',
  email: 'hola@example.com',
  business: { kind: 'remote', address: { city: 'Bogotá', region: 'Bogotá D.C.', countryCode: 'CO' } },
  logo: '/images/logo.png',
  image: '/images/og-image.png',
  founders: ['ana'],
  socialMedia: { linkedin: 'https://www.linkedin.com/company/ejemplo' },
};

const local: Company = {
  ...remote,
  business: {
    kind: 'local',
    type: 'LegalService',
    address: { street: 'Calle 1 # 2-3', city: 'Bogotá', region: 'Bogotá D.C.', countryCode: 'CO' },
    geo: { latitude: 4.60971, longitude: -74.08175 },
  },
};

const authors = [{ slug: 'ana', name: 'Ana Gómez', role: 'Directora', bio: 'Abogada', url: '/nosotros' }];
const seo = createSeo({ company: remote, authors, locale: 'es-CO', ...urls });

test('pageHead: canonical and og:url are the page URL, with the slash', () => {
  const head = seo.pageHead({ path: '/servicios/x', title: 'Servicio X', description: 'Desc' });
  assert.equal(head.canonical, 'https://example.com/servicios/x/');
  assert.equal(head.openGraph?.url, 'https://example.com/servicios/x/');
  assert.equal(head.title, 'Servicio X | Ejemplo');
  assert.equal(head.robots, 'index, follow');
  assert.equal(head.openGraph?.image, 'https://example.com/images/og-image.png');
  assert.equal(head.openGraph?.locale, 'es_CO');
});

test('pageHead: the home canonical is / (regression: /home/)', () => {
  assert.equal(seo.pageHead({ path: '/', title: 'Ejemplo', description: 'd' }).canonical, 'https://example.com/');
});

test('pageHead: does not repeat the company name already in the title', () => {
  assert.equal(seo.pageHead({ path: '/', title: 'Ejemplo | Abogados', description: 'd' }).title, 'Ejemplo | Abogados');
});

test('pageHead: noindex', () => {
  const head = seo.pageHead({ path: '/privacidad', title: 'Privacidad', description: 'd', noindex: true });
  assert.equal(head.robots, 'noindex, follow');
  assert.equal(head.canonical, 'https://example.com/privacidad/');
});

test('notFoundHead: title and noindex only', () => {
  assert.deepEqual(seo.notFoundHead({ title: 'Página no encontrada' }), {
    title: 'Página no encontrada | Ejemplo',
    robots: 'noindex, follow',
  });
});

test('businessNode: remote is an Organization, with no street', () => {
  const node = seo.businessNode();
  assert.equal(node['@type'], 'Organization');
  assert.equal(node['@id'], 'https://example.com/#organization');
  assert.equal(node.url, 'https://example.com/');
  assert.deepEqual(node.address, {
    '@type': 'PostalAddress',
    addressLocality: 'Bogotá',
    addressRegion: 'Bogotá D.C.',
    addressCountry: 'CO',
  });
  assert.deepEqual(node.founder, [{ '@id': 'https://example.com/#person-ana' }]);
  assert.deepEqual(node.sameAs, ['https://www.linkedin.com/company/ejemplo']);
});

test('businessNode: local uses its specific subtype, street and geo', () => {
  const node = createSeo({ company: local, authors, locale: 'es-CO', ...urls }).businessNode();
  assert.equal(node['@type'], 'LegalService');
  assert.equal((node.address as Record<string, unknown>).streetAddress, 'Calle 1 # 2-3');
  assert.deepEqual(node.geo, { '@type': 'GeoCoordinates', latitude: 4.60971, longitude: -74.08175 });
});

test('businessRef: @id, name and url, typed Organization even for a local business', () => {
  const ref = createSeo({ company: local, authors, locale: 'es-CO', ...urls }).businessRef();
  assert.deepEqual(ref, {
    '@type': 'Organization',
    '@id': 'https://example.com/#organization',
    name: 'Ejemplo',
    url: 'https://example.com/',
  });
});

test('websiteNode: no SearchAction (regression: /search?q= gave 404)', () => {
  const node = seo.websiteNode();
  assert.equal(node.potentialAction, undefined);
  assert.equal(node.url, 'https://example.com/');
  assert.deepEqual(node.publisher, { '@id': 'https://example.com/#organization' });
});

test('homeNodes: business, website and the founders; every reference resolves', () => {
  const nodes = seo.homeNodes();
  assert.deepEqual(nodes.map((n) => n['@type']), ['Organization', 'WebSite', 'Person']);
  const person = nodes[2];
  assert.equal(person.url, 'https://example.com/nosotros/');
  assert.deepEqual(person.worksFor, { '@id': 'https://example.com/#organization' });
});

test('homeNodes: a founder with no Author throws', () => {
  const broken = createSeo({ company: { ...remote, founders: ['nadie'] }, locale: 'es-CO', ...urls });
  assert.throws(() => broken.homeNodes(), /no Author/);
});

test('breadcrumbNode: absolute items (regression: relative item), at least 2', () => {
  const node = seo.breadcrumbNode([
    { name: 'Inicio', path: '/' },
    { name: 'Blog', path: '/blog' },
  ]);
  const items = node.itemListElement as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((i) => i.item), ['https://example.com/', 'https://example.com/blog/']);
  assert.throws(() => seo.breadcrumbNode([{ name: 'Inicio', path: '/' }]), /at least 2/);
});

test('graph: one @context and every node in @graph', () => {
  const doc = graph(seo.homeNodes());
  assert.equal(doc['@context'], 'https://schema.org');
  assert.equal((doc['@graph'] as unknown[]).length, 3);
});
