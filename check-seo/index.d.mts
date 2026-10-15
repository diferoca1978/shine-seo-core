// Types for check-seo/index.mjs. test/types.test.mjs fails if RuleId and RULES differ.

export type RuleId =
  | 'jsonld-parse'
  | 'jsonld-id-resolves'
  | 'jsonld-noindex'
  | 'title-description'
  | 'canonical-self'
  | 'robots-single'
  | 'url-resolves'
  | 'url-canonical-form'
  | 'faq-visible'
  | 'breadcrumb-shape'
  | 'local-address'
  | 'url-lowercase'
  | 'asset-missing'
  | 'placeholder-text'
  | '404-empty'
  | 'deprecated-type'
  | 'external-url-http'
  | 'llms-links-resolve'
  | 'searchaction'
  | 'img-alt'
  | 'title-unique'
  | 'sitemap-coverage'
  | 'h1'
  | 'title-length'
  | 'description-length'
  | 'description-unique';

export interface IgnoreEntry {
  rule: RuleId;
  /** One page ('/quienesSomos/') or file ('/sitemap-0.xml'); omitted: everywhere. */
  path?: string;
  /** Required: why this finding cannot be fixed now. */
  reason: string;
}

export interface Finding {
  rule: RuleId;
  severity: 'error' | 'warning';
  message: string;
}

export interface CheckResult {
  text: string;
  errors: number;
  warnings: number;
  failed: boolean;
  pageCount: number;
  results: { label: string; path: string; findings: Finding[]; alwaysShow: boolean }[];
  ignored: { label: string; rule: RuleId; message: string; reason: string }[];
}

interface CommonOptions {
  ignore?: IgnoreEntry[];
  strict?: boolean;
  report?: boolean;
}

export declare function checkDist(
  options: CommonOptions & { dir: string; origin?: string; onDemand?: string[]; label?: string },
): Promise<CheckResult>;

export declare function checkUrl(
  options: CommonOptions & { origin: string; headers?: Record<string, string> },
): Promise<CheckResult>;

export declare class InputError extends Error {
  usage: boolean;
}

export declare const RULES: readonly { id: RuleId }[];
