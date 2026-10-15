import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robotsTxt } from '../src/robots.ts';
import { header, linkList, llmsTxt } from '../src/llms.ts';
import { sitemapFilter } from '../src/config.mjs';

test('robotsTxt: no leading blank lines, allows all, declares the sitemap', () => {
  const txt = robotsTxt({ site: new URL('https://example.com/') });
  assert.ok(txt.startsWith('User-agent: *\nAllow: /\n'));
  assert.ok(txt.endsWith('\nSitemap: https://example.com/sitemap-index.xml\n'));
  assert.ok(txt.includes('User-agent: Claude-SearchBot\nAllow: /'));
  assert.ok(!txt.includes('Disallow'));
});

test('llmsTxt: header, sections, empty sections dropped', () => {
  const doc = llmsTxt(header('Ejemplo', 'Resumen'), [
    linkList('Páginas', [{ title: 'Inicio', url: 'https://example.com/' }]),
    linkList('Vacía', []),
  ]);
  assert.equal(doc, '# Ejemplo\n\n> Resumen\n\n\n## Páginas\n\n- [Inicio](https://example.com/)\n');
});

test('sitemapFilter: leaves out noindex pages, with or without the slash', () => {
  const filter = sitemapFilter({
    home: { path: '/' },
    privacidad: { path: '/politica-privacidad/', noindex: true },
    gracias: { path: '/gracias', noindex: true },
  });
  assert.equal(filter('https://example.com/'), true);
  assert.equal(filter('https://example.com/politica-privacidad/'), false);
  assert.equal(filter('https://example.com/gracias/'), false);
  assert.equal(filter('https://example.com/servicios/'), true);
});
