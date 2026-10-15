import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCAL_BUSINESS_TYPES, LEGACY_LOCAL_BUSINESS_TYPES } from '../src/shared/business-types.mjs';

// The .d.mts repeats the lists for TypeScript; this keeps the two in step.
test('business-types.d.mts declares the same lists as business-types.mjs', async () => {
  const dts = await readFile(new URL('../src/shared/business-types.d.mts', import.meta.url), 'utf8');
  const declared = (name) =>
    JSON.parse(dts.match(new RegExp(`${name}: readonly (\\[[^\\]]*\\])`))[1].replaceAll("'", '"'));
  assert.deepEqual(declared('LOCAL_BUSINESS_TYPES'), LOCAL_BUSINESS_TYPES);
  assert.deepEqual(declared('LEGACY_LOCAL_BUSINESS_TYPES'), LEGACY_LOCAL_BUSINESS_TYPES);
});
