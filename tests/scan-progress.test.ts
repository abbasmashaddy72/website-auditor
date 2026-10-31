import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeScanProgress } from '../src/lib/scan-progress';

test('progress partitions visited pages without confusing individual findings or queued routes', () => {
  const pages = [
    { classification: 'passed' },
    { classification: 'warning' },
    { classification: 'failed' },
    { classification: 'warning' },
  ] as const;
  assert.deepEqual(summarizeScanProgress(pages, 7, 1), {
    discovered: 7,
    visited: 4,
    passed: 1,
    failed: 1,
    warnings: 2,
    skipped: 1,
  });
  assert.equal(summarizeScanProgress(pages, 2, 1).discovered, 5);
  assert.equal(summarizeScanProgress([], 0).visited, 0);
});
