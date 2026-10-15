import type { PageSeo } from '@shine/seo-core';

export const PAGES = {
  home: {
    path: '/',
    keyword: 'asesoría legal de prueba',
    title: 'Asesoría legal de prueba para empresas en Bogotá',
    description: 'Una descripción de la home con la longitud suficiente para que las reglas de longitud no avisen.',
    h1: 'Asesoría legal de prueba',
    source: 'brief §1',
  },
  nosotros: {
    path: '/nosotros/',
    title: 'Quiénes somos: el equipo del sitio de prueba',
    description: 'Una descripción distinta para la página de nosotros, también con la longitud suficiente.',
    h1: 'Quiénes somos',
    source: 'brief §2',
  },
  privacidad: {
    path: '/politica-privacidad/',
    title: 'Política de privacidad',
    description: 'La política de privacidad del sitio de prueba, que no se indexa ni va en el sitemap.',
    h1: 'Política de privacidad',
    source: 'brief §9',
    noindex: true,
  },
} satisfies Record<string, PageSeo>;
