# @shine/seo-core: instructions for agents

The shared SEO core of the agency's Astro sites: what fails silently. Absolute URLs,
JSON-LD, head tags, robots.txt, and the build gate that runs check-seo on the published
HTML. Everything that fails visibly (folders, layout, components, styles) is not here.

## Rules of this public repo

- **No client is named anywhere**: not in code, commits, issues, fixtures or docs.
  Regression cases are anonymized (`sitio.test`, made-up names). The client registry
  lives in a private repo.
- **No build step** (no `prepare`, no `postinstall`): clients install this package from
  a git tag, and pnpm would ask each one to approve a build.
  - Node does not strip types inside `node_modules`, so whatever Node runs (check-seo,
    the integration, `src/config.mjs`) is plain `.mjs`, with a `.d.mts` beside it.
  - `.ts` and `.astro` only where Vite processes them (`src/`), with erasable syntax
    only (`erasableSyntaxOnly`), so `node --test` runs them too.
  - A list both sides need lives once, in a `.mjs` (`src/shared/business-types.mjs`).
    Its `.d.mts` repeats it for TypeScript, and a test fails if they differ.
- **Host- and adapter-agnostic**: never read `CONTEXT`, `URL` or any host variable;
  never assume an adapter's folders. The integration takes the HTML from
  `astro:build:done`'s `dir` and the on-demand routes from its `assets`.
- **Every rule and generator agrees with the SEO reference**
  (`seo-schema-org-buenas-practicas-2026.md`, the maintainer's research notes, cited as
  "reference §n"). If they disagree, change the rule or update the reference with its
  source. Comments citing "plan Qn" refer to the maintainer's design decisions; the
  comment always restates the reason.

## Process

- A patch: the fix plus its regression test, nothing more.
- A change to the public API or a new rule: a one-page spec first (problem, decision,
  API change, tests), approved by the maintainer in chat.
- **Severity policy:** a new rule enters as a `warning` in a minor version, and becomes
  an `error` only in a major version, announced in CHANGELOG.md. A minor update must
  never break a client's build.
- **Version numbers in 0.x:** until 1.0.0, each level shifts down one place. A fix or an
  addition that cannot break a build bumps the patch (`0.1.2` → `0.1.3`); anything that
  can, such as a rule becoming an error, bumps the minor (`0.1.x` → `0.2.0`). So in the
  severity policy, read "minor" as patch and "major" as minor. That is how npm reads
  0.x: `^0.1.2` accepts `0.1.3` but not `0.2.0`.
- Release: bump `version`, add the CHANGELOG entry, tag `vX.Y.Z`. Clients pin the exact
  tag: `"@shine/seo-core": "github:diferoca1978/shine-seo-core#vX.Y.Z"`.

## Commands

- `pnpm test`: unit tests (`node:test`; every rule has a passing and a failing case).
  Needs Node 22.18+, which strips the types of the `.ts` tests; the package itself
  runs on Node 22.12+, like Astro 6.
- `pnpm typecheck`: `tsc` over `src/` and the tests.
- `pnpm test:e2e`: installs the working tree from a git tag into a fixture site and
  builds it with no adapter, with Netlify, with Cloudflare, and with Astro 6. The clean
  build must pass and a broken page must fail it. Needs network access.

## Layout

```
src/            url.ts, seo.ts (head + JSON-LD), types.ts, robots.ts, llms.ts,
                components/ (SeoHead, JsonLd), config.mjs (for astro.config),
                shared/business-types.mjs
check-seo/      index.mjs (library), cli.mjs (bin), html.mjs (tag reader + page model),
                urls.mjs, rules.mjs (every rule, documented at the top), dist.mjs and
                live.mjs (the --dist and --url adapters), run.mjs (runner, ignore, report)
integration/    the gate
test/           unit tests, helpers.mjs (fixture builder), e2e/ (fixture site + runner)
```
