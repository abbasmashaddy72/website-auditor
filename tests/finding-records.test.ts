import test from 'node:test';
import assert from 'node:assert/strict';
import { pageFindings } from '../src/lib/finding-records';

test('warning-only page creates a durable warning finding without losing its text', () => {
  assert.deepEqual(
    pageFindings({ classification: 'warning', issues: [], warnings: ['Page readiness budget reached'] }),
    [{ category: 'warning', message: 'Page readiness budget reached' }],
  );
});
test('mixed failures and warnings preserve both categories without duplicating a note', () => {
  const issues = [{ category: 'javascript', message: 'Uncaught TypeError' }];
  assert.deepEqual(
    pageFindings({
      classification: 'failed',
      issues,
      warnings: ['Slower than expected', 'Slower than expected', ''],
    }),
    [...issues, { category: 'warning', message: 'Slower than expected' }],
  );
  assert.deepEqual(issues, [{ category: 'javascript', message: 'Uncaught TypeError' }]);
});
test('fatal warning text cannot be hidden in the nonfatal warning counter', () => {
  assert.deepEqual(
    pageFindings({ classification: 'failed', issues: [], warnings: ['Uncaught exception during Livewire'] }),
    [{ category: 'framework', message: 'Uncaught exception during Livewire' }],
  );
});
test('do not duplicate structured warning already present or produce fake healthy issues', () => {
  const issues = [{ category: 'warning', message: 'Extra note' }];
  assert.deepEqual(pageFindings({ classification: 'warning', issues, warnings: ['Extra note'] }), issues);
  assert.deepEqual(pageFindings({ classification: 'passed', issues: [], warnings: [] }), []);
});
