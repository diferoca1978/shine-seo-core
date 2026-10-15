// Runner and output: every rule over a site context, the `ignore` valve, and the report.

import { RULES } from "./rules.mjs";
import { InputError, isBlank, plural } from "./util.mjs";

/** A label's path on the site, for `ignore`: a page's pathname, or "/" + a file name. */
function pathOf(labelOrUrl) {
  try {
    return new URL(labelOrUrl).pathname;
  } catch {
    return `/${labelOrUrl.replace(/^\/+/, "")}`;
  }
}

/** The sitemaps' page <loc>s as URL occurrences, grouped by the sitemap that lists them. */
function sitemapOccurrences(site) {
  const bySource = new Map();
  for (const { loc, source } of site.sitemap?.pageLocs ?? []) {
    let u;
    try {
      u = new URL(loc);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({
      raw: loc,
      url: u.href,
      where: "sitemap <loc>",
      jsonld: false,
      relative: false,
    });
  }
  return bySource;
}

/**
 * Runs every rule on every page, then the sitemap checks on each sitemap's page <loc>s,
 * then every checkSite rule once against the whole site. Returns
 * [{ label, path, findings: [{ rule, severity, message }], alwaysShow }]: the pages
 * first, then one entry per sitemap file, then one per llms doc or other site label.
 */
async function runRules(pages, site) {
  const results = [];
  const byLabel = new Map();
  const entry = (label, path, alwaysShow = false) => {
    let e = byLabel.get(label);
    if (!e) {
      e = { label, path, findings: [], alwaysShow };
      byLabel.set(label, e);
      results.push(e);
    }
    return e;
  };
  const severityOf = (rule) =>
    typeof rule.severity === "function" ? rule.severity(site) : rule.severity;
  const add = (e, rule, message) =>
    e.findings.push({ rule: rule.id, severity: severityOf(rule), message });

  for (const page of pages) {
    const e = entry(page.label, pathOf(page.url));
    const empty404 = page.kind === "404" && isBlank(page.html);
    for (const rule of RULES) {
      if (!rule.check) continue;
      if (empty404 && rule.id !== "404-empty") continue;
      for (const message of await rule.check(page, site)) add(e, rule, message);
    }
  }
  for (const [source, occurrences] of sitemapOccurrences(site)) {
    const e = entry(source, pathOf(source));
    for (const rule of RULES) {
      if (!rule.checkSitemap) continue;
      for (const message of await rule.checkSitemap(site, occurrences)) add(e, rule, message);
    }
  }
  for (const doc of site.llmsDocs) entry(doc.label, pathOf(doc.label), true);
  for (const rule of RULES) {
    if (!rule.checkSite) continue;
    for (const { label, message } of await rule.checkSite(site)) {
      add(entry(label, pathOf(label)), rule, message);
    }
  }
  return results;
}

const withoutSlash = (p) => p.replace(/\/+$/, "") || "/";

/**
 * Checks the `ignore` list: [{ rule, path?, reason }]. `rule` is a rule id, `path` (a
 * page path such as '/quienesSomos/', or a file such as '/sitemap-0.xml') limits it to
 * one place, and `reason` is required, so every exception says why (plan Q2.3).
 */
function validateIgnore(ignore) {
  if (!Array.isArray(ignore)) throw new InputError("ignore must be an array");
  const ids = new Set(RULES.map((r) => r.id));
  ignore.forEach((item, i) => {
    const at = `ignore[${i}]`;
    if (item === null || typeof item !== "object") throw new InputError(`${at} is not an object`);
    if (!ids.has(item.rule)) throw new InputError(`${at}: unknown rule ${JSON.stringify(item.rule)}`);
    if (typeof item.reason !== "string" || isBlank(item.reason)) {
      throw new InputError(`${at} (${item.rule}) has no reason: every ignored finding needs one`);
    }
    if (item.path !== undefined && (typeof item.path !== "string" || !item.path.startsWith("/"))) {
      throw new InputError(`${at}: path must start with "/", got ${JSON.stringify(item.path)}`);
    }
  });
}

/** Removes the ignored findings. Returns { results, ignored: [{ label, rule, message, reason }] }. */
function applyIgnore(results, ignore = []) {
  validateIgnore(ignore);
  const ignored = [];
  const kept = results.map((r) => ({
    ...r,
    findings: r.findings.filter((f) => {
      const match = ignore.find(
        (item) =>
          item.rule === f.rule &&
          (item.path === undefined || withoutSlash(item.path) === withoutSlash(r.path)),
      );
      if (match) ignored.push({ label: r.label, rule: f.rule, message: f.message, reason: match.reason });
      return !match;
    }),
  }));
  return { results: kept, ignored };
}

/**
 * The report text and its counts. failed: any error, or any warning with `strict`.
 * opts: { strict, report (the CLI's --report: say that it exits 0), ignored }.
 */
function formatReport(heading, results, pageCount, opts = {}) {
  const ruleWidth = Math.max(...RULES.map((r) => r.id.length));
  const lines = [heading, ""];
  let errors = 0;
  let warnings = 0;
  for (const { label, findings, alwaysShow } of results) {
    if (findings.length === 0 && !alwaysShow) continue;
    lines.push(label);
    if (findings.length === 0) lines.push("  0 findings");
    for (const f of findings) {
      if (f.severity === "error") errors++;
      else warnings++;
      lines.push(`  ${f.severity.padEnd(7)}  ${f.rule.padEnd(ruleWidth)}  ${f.message}`);
    }
    lines.push("");
  }
  const ignored = opts.ignored ?? [];
  if (ignored.length > 0) {
    lines.push(`ignored (${ignored.length}):`);
    for (const i of ignored) {
      lines.push(`  ${i.rule.padEnd(ruleWidth)}  ${i.label}: ${i.message}`, `  ${"".padEnd(ruleWidth)}  reason: ${i.reason}`);
    }
    lines.push("");
  }
  let summary = `${plural(pageCount, "page")}, ${plural(errors, "error")}, ${plural(warnings, "warning")}`;
  if (ignored.length > 0) summary += `, ${ignored.length} ignored`;
  if (opts.strict && warnings > 0) summary += " (--strict: warnings count as errors)";
  const failed = errors > 0 || (opts.strict && warnings > 0);
  if (failed && opts.report) summary += " (--report: exit 0)";
  lines.push(summary);
  return { text: lines.join("\n"), errors, warnings, failed };
}

export { applyIgnore, formatReport, runRules, validateIgnore };
