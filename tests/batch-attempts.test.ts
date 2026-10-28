import test from 'node:test';
import assert from 'node:assert/strict';
import { countBatchAttempts } from '../src/lib/batch-attempts';

test('five selected findings may create only two new jobs without losing accounting', () => {
  const result = countBatchAttempts([
    { outcome: 'queued' },
    { outcome: 'queued' },
    { outcome: 'reused' },
    { outcome: 'ineligible' },
    { outcome: 'failed' },
  ]);
  assert.deepEqual(result, { selected: 5, newJobs: 2, reused: 1, ineligible: 1, failed: 1 });
  assert.equal(result.newJobs + result.reused + result.ineligible + result.failed, result.selected);
});
