import { createSeo } from '@shine/seo-core';
import { COMPANY, LOCALE } from './company';
import { mediaUrl, siteUrl } from '../utils/url';

export const seo = createSeo({ company: COMPANY, locale: LOCALE, siteUrl, mediaUrl });
