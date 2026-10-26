import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueExport } from '../src/lib/error-export';
import type { PageResult } from '../src/lib/types';

const page = {
  scanId: 'scan-1',
  siteId: 'site-1',
  authProfileId: 'profile-1',
  url: 'https://example.com/demo',
  classification: 'failed',
  status: 200,
  durationMs: 111,
  capturedAt: new Date('2026-10-26T00:00:00Z'),
  issues: [{ category: 'runtime', message: '=SUSPICIOUS_FORMULA' }],
} as PageResult;

test('bulk error export preserves the selected source metadata', () => {
  const rows = JSON.parse(buildIssueExport([page], 'json'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].profileId, 'profile-1');
  assert.equal(rows[0].category, 'runtime');
});
test('CSV export prevents spreadsheet formula execution', () => {
  const csv = buildIssueExport([page], 'csv');
  assert.match(csv, /'=?SUSPICIOUS_FORMULA/);
  assert.match(csv, /"Website ID"/);
});
