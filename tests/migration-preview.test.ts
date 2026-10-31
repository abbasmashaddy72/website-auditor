import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/migrate-http-warnings.ts', import.meta.url), 'utf8');

test('migration preview plans both reclassifications and warning-only backfills before applying', () => {
  const planning = source.indexOf('const pendingWarningBackfills:');
  const report = source.indexOf('const report = {');
  const write = source.indexOf('if (apply) {');
  assert.ok(planning >= 0 && report > planning && write > report);
  assert.match(source.slice(report, write), /warningsBackfillPlanned:\s*pendingWarningBackfills\.length/);
});

test('migration keeps preview read-only and records intended warning backfills in backup', () => {
  const write = source.indexOf('if (apply) {');
  assert.ok(write > 0);
  const preview = source.slice(0, write);
  assert.doesNotMatch(
    preview,
    /(?:pages|scans|issues)\.(?:updateOne|updateMany|insertOne|deleteOne|deleteMany)\(/,
  );
  assert.match(source.slice(write), /warningBackfillPlan:/);
  assert.match(source.slice(write), /\$setOnInsert:\s*data/);
});

test('ambiguous successes are reported for review but never silently downgraded', () => {
  assert.match(source, /ambiguousPages/);
  assert.match(source, /categories: \[\.\.\.new Set\(page\.issues\.map/);
  assert.match(source, /isFatalWarning\(warning\)/);
});
