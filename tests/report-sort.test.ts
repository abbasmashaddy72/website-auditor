import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportSort } from '../src/lib/report-sort';

test('report sorting uses server-allowed primitive database fields', () => {
  assert.deepEqual(reportSort(new URLSearchParams()), { capturedAt: -1, _id: -1 });
  assert.deepEqual(reportSort(new URLSearchParams('sort=http&direction=asc')), { status: 1, _id: -1 });
  assert.deepEqual(reportSort(new URLSearchParams('sort=time&direction=desc')), { durationMs: -1, _id: -1 });
});

test('report sort rejects arbitrary MongoDB paths and directions', () => {
  assert.throws(() => reportSort(new URLSearchParams('sort=$where')), /Invalid report sort column/);
  assert.throws(() => reportSort(new URLSearchParams('sort=issues')), /Invalid report sort column/);
  assert.throws(() => reportSort(new URLSearchParams('sort=__proto__')), /Invalid report sort column/);
  assert.throws(() => reportSort(new URLSearchParams('direction=sideways')), /Invalid report sort direction/);
});
