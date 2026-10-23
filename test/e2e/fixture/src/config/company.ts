import type { Company } from '@shine/seo-core';

export const LOCALE = 'es-CO';

export const COMPANY: Company = {
  name: 'Sitio de Prueba',
  alternateName: ['Sitio de Prueba Bogotá'],
  description:'Una empresa ficticia para la prueba de extremo a extremo del paquete.',
  phone: '+57 300 000 0000',
  email: 'hola@sitio-e2e.test',
  business: {
    kind: 'local',
    type: 'LegalService',
    address: { street: 'Calle 1 # 2-3', city: 'Bogotá', region: 'Bogotá D.C.', countryCode: 'CO' },
    geo: { latitude: 4.60971, longitude: -74.08175 },
    hours: [
      { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:00', closes: '18:00' },
      { days: ['Saturday'], opens: '09:00', closes: '13:00' },
    ],
  },
  logo: '/logo.png',
  image: '/og-image.png',
};
