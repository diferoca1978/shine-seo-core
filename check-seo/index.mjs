// check-seo as a library: the integration (the build gate) and the CLI both call it.
// Checks the HTML a site actually publishes against SEO rules (see rules.mjs). Two
// inputs, one page model, the same rules:
//   checkDist   a build folder (what astro build wrote)
//   checkUrl    the live site, from its sitemaps
// Limits: it cannot tell whether the data is true, it cannot see text hidden with CSS,
// and it does not replace the Rich Results Test (reference §9).

import { loadDist } from "./dist.mjs";
import { loadUrl } from "./live.mjs";
import { RULES } from "./rules.mjs";
import { applyIgnore, formatReport, runRules, validateIgnore } from "./run.mjs";
import { InputError } from "./util.mjs";

async function check(input, { ignore = [], strict = false, report = false }) {
  const raw = await runRules(input.pages, input.site);
  const { results, ignored } = applyIgnore(raw, ignore);
  const pageCount = input.pages.length;
  const summary = formatReport(input.heading, results, pageCount, { strict, report, ignored });
  return { ...summary, results, ignored, pageCount };
}

/**
 * Checks a build.
 * @param {{ dir: string, origin?: string, onDemand?: string[], label?: string,
 *   ignore?: { rule: string, path?: string, reason: string }[], strict?: boolean,
 *   report?: boolean }} options
 */
export async function checkDist(options) {
  validateIgnore(options.ignore ?? []);
  const input = await loadDist(options);
  return check(input, options);
}

/**
 * Checks the live site at `origin`.
 * @param {{ origin: string, headers?: Record<string, string>,
 *   ignore?: { rule: string, path?: string, reason: string }[], strict?: boolean,
 *   report?: boolean }} options
 */
export async function checkUrl(options) {
  validateIgnore(options.ignore ?? []);
  const input = await loadUrl(options.origin, { headers: options.headers });
  return check(input, options);
}

export { InputError, RULES };
