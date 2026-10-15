import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteUrl } from '../src/url.ts';

const always = createSiteUrl({ site: 'https://example.com', trailingSlash: 'always' });

test('siteUrl: page paths get the trailing slash with trailingSlash always', () => {
  assert.equal(always.siteUrl('/'), 'https://example.com/');
  assert.equal(always.siteUrl('/nosotros'), 'https://example.com/nosotros/');
  assert.equal(always.siteUrl('/nosotros/'), 'https://example.com/nosotros/');
  assert.equal(always.siteUrl('/nosotros#equipo'), 'https://example.com/nosotros/#equipo');
  assert.equal(always.siteUrl('/blog?page=2'), 'https://example.com/blog/?page=2');
});

test('siteUrl: a site with a trailing slash never yields // (regression: x.com//ruta)', () => {
  const { siteUrl } = createSiteUrl({ site: 'https://example.com/', trailingSlash: 'always' });
  assert.equal(siteUrl('/ruta'), 'https://example.com/ruta/');
  assert.equal(siteUrl('/'), 'https://example.com/');
});

test('siteUrl: the home is / and never /home/ (regression)', () => {
  assert.equal(always.siteUrl('/'), 'https://example.com/');
});

test('siteUrl: asset paths are left as they are', () => {
  assert.equal(always.siteUrl('/images/logo.png'), 'https://example.com/images/logo.png');
  assert.equal(always.siteUrl('/sitemap-index.xml'), 'https://example.com/sitemap-index.xml');
});

test('siteUrl: trailingSlash never drops the slash, except on the root', () => {
  const { siteUrl } = createSiteUrl({ site: 'https://example.com', trailingSlash: 'never' });
  assert.equal(siteUrl('/nosotros/'), 'https://example.com/nosotros');
  assert.equal(siteUrl('/nosotros'), 'https://example.com/nosotros');
  assert.equal(siteUrl('/'), 'https://example.com/');
});

test('siteUrl: trailingSlash ignore follows build.format', () => {
  const directory = createSiteUrl({ site: 'https://example.com', trailingSlash: 'ignore' });
  assert.equal(directory.siteUrl('/nosotros'), 'https://example.com/nosotros/');
  const file = createSiteUrl({ site: 'https://example.com', trailingSlash: 'ignore', build: { format: 'file' } });
  assert.equal(file.siteUrl('/nosotros/'), 'https://example.com/nosotros');
});

test('siteUrl: base is prefixed', () => {
  const { siteUrl } = createSiteUrl({ site: 'https://example.com', trailingSlash: 'always', base: '/docs/' });
  assert.equal(siteUrl('/'), 'https://example.com/docs/');
  assert.equal(siteUrl('/guia'), 'https://example.com/docs/guia/');
});

test('siteUrl: rejects uppercase page paths (regression: camelCase routes)', () => {
  assert.throws(() => always.siteUrl('/quienesSomos'), /lowercase/);
  assert.throws(() => always.siteUrl('/%C3%89xito'), /lowercase/);
  assert.equal(always.siteUrl('/%C3%A9xito'), 'https://example.com/%C3%A9xito/');
});

test('siteUrl: rejects relative paths and other hosts', () => {
  assert.throws(() => always.siteUrl('ruta'), /must start with '\/'/);
  assert.throws(() => always.siteUrl('//evil.com/x'), /another host/);
  assert.throws(() => always.siteUrl('/%E0%A4%A'), /malformed/);
});

test('mediaUrl: CDN URLs pass through; site paths keep case and get no slash', () => {
  assert.equal(always.mediaUrl('https://cdn.example.net/a/B.jpg'), 'https://cdn.example.net/a/B.jpg');
  assert.equal(always.mediaUrl('//cdn.example.net/x.jpg'), 'https://cdn.example.net/x.jpg');
  assert.equal(always.mediaUrl('/_astro/Photo.abc.webp'), 'https://example.com/_astro/Photo.abc.webp');
  assert.equal(
    always.mediaUrl('/.netlify/images?url=/a.jpg&w=400'),
    'https://example.com/.netlify/images?url=/a.jpg&w=400',
  );
  assert.throws(() => always.mediaUrl('http://insecure.com/x.jpg'), /https/);
  assert.throws(() => always.mediaUrl('images/x.jpg'), /https/);
});

test('createSiteUrl: site is required and absolute', () => {
  assert.throws(() => createSiteUrl({ site: undefined }), /not set/);
  assert.throws(() => createSiteUrl({ site: 'example.com' }), /absolute/);
});
