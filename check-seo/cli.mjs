#!/usr/bin/env node
// check-seo — SEO check of the HTML a site actually publishes.
//
// Usage:
//   check-seo --dist <dir> [--site <origin>] [--strict] [--report]
//   check-seo --url <origin> [--header "Name: value"]... [--strict] [--report]
//
//   --dist <dir>       check every *.html under <dir> (a build, e.g. dist/)
//   --site <origin>    --dist only: use this origin instead of the one in the
//                      sitemaps' page <loc>s
//   --url <origin>     check the live site: every page <loc> in its sitemaps
//   --header "N: v"    --url only: send this header with every request to the site
//                      itself, never to another host or over plain http (repeatable)
//   --strict           warnings count as errors
//   --report           exit 0 even when there are errors (never hides exit 2)
//   Exactly one of --dist and --url.
//
// Exit codes:
//   0  no errors
//   1  at least one error (with --strict, warnings count as errors); --report turns
//      1 into 0
//   2  a usage error or input that cannot be read: a missing <dir>, no sitemap and no
//      --site, a sitemap that cannot be fetched…
//
// The rules and their severities are listed in rules.mjs.

import process from "node:process";
import { InputError, checkDist, checkUrl } from "./index.mjs";
import { httpOrigin } from "./util.mjs";

const USAGE = `Usage:
  check-seo --dist <dir> [--site <origin>] [--strict] [--report]
  check-seo --url <origin> [--header "Name: value"]... [--strict] [--report]`;

const VALUE_OPTIONS = { "--dist": "dist", "--url": "url", "--site": "site" };
const FLAG_OPTIONS = { "--strict": "strict", "--report": "report" };

function parseArgs(argv) {
  const opts = { dist: null, url: null, site: null, headers: {}, strict: false, report: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (Object.hasOwn(VALUE_OPTIONS, arg) || arg === "--header") {
      if (value === undefined || value.startsWith("--")) {
        throw new InputError(`${arg} needs a value`, { usage: true });
      }
      i++;
      if (arg === "--header") {
        const colon = value.indexOf(":");
        if (colon < 1) throw new InputError(`--header needs "Name: value", got "${value}"`, { usage: true });
        opts.headers[value.slice(0, colon).trim()] = value.slice(colon + 1).trim();
        continue;
      }
      const key = VALUE_OPTIONS[arg];
      if (opts[key] !== null) throw new InputError(`${arg} is given twice`, { usage: true });
      opts[key] = value;
    } else if (Object.hasOwn(FLAG_OPTIONS, arg)) {
      opts[FLAG_OPTIONS[arg]] = true;
    } else {
      throw new InputError(`unknown argument: ${arg}`, { usage: true });
    }
  }
  if (opts.dist === null && opts.url === null) {
    throw new InputError("give exactly one of --dist and --url", { usage: true });
  }
  if (opts.dist !== null && opts.url !== null) {
    throw new InputError("--dist and --url cannot be used together", { usage: true });
  }
  if (opts.site !== null && opts.url !== null) {
    throw new InputError("--site only works with --dist", { usage: true });
  }
  if (Object.keys(opts.headers).length > 0 && opts.url === null) {
    throw new InputError("--header only works with --url", { usage: true });
  }
  if (opts.site !== null) opts.site = parseOrigin(opts.site, "--site");
  if (opts.url !== null) opts.url = parseOrigin(opts.url, "--url");
  return opts;
}

function parseOrigin(value, flag) {
  const origin = httpOrigin(value);
  if (!origin) {
    throw new InputError(
      `${flag} needs an absolute http(s) URL, such as https://<domain> (got "${value}")`,
      { usage: true },
    );
  }
  return origin;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const result =
    opts.dist !== null
      ? await checkDist({ dir: opts.dist, origin: opts.site, strict: opts.strict, report: opts.report })
      : await checkUrl({ origin: opts.url, headers: opts.headers, strict: opts.strict, report: opts.report });
  console.log(result.text);
  return result.failed && !opts.report ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (err instanceof InputError) {
      console.error(`check-seo: ${err.message}`);
      if (err.usage) console.error(`\n${USAGE}`);
    } else {
      console.error(`check-seo: internal error: ${err?.stack ?? err}`);
    }
    process.exitCode = 2;
  },
);
