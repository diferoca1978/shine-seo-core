import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RULES } from '../check-seo/rules.mjs';

// check-seo/index.d.mts lists the rule ids for TypeScript; this keeps it in step.
test('RuleId in check-seo/index.d.mts lists every rule in RULES', async () => {
  const dts = await readFile(new URL('../check-seo/index.d.mts', import.meta.url), 'utf8');
  const union = dts.match(/export type RuleId =([^;]+);/)[1];
  const declared = [...union.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(declared, RULES.map((r) => r.id));
});
