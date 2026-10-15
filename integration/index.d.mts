import type { AstroIntegration } from 'astro';
import type { IgnoreEntry } from '../check-seo/index.d.mts';

export type { IgnoreEntry, RuleId } from '../check-seo/index.d.mts';

export interface ShineSeoOptions {
  /** The only valve: findings to ignore, each with its reason (plan Q2.3). */
  ignore?: IgnoreEntry[];
}

export default function shineSeo(options?: ShineSeoOptions): AstroIntegration;
