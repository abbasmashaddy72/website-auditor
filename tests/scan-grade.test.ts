import test from 'node:test';
import assert from 'node:assert/strict';
import { gradePageWithPolicy, normalizeBrowserError } from '../src/lib/scan-grade';

test('Livewire-policy disruption is inconclusive, not a verified failure', () => {
  const graded = gradePageWithPolicy(
    [
      {
        category: 'framework',
        message: 'Visible temporary-unavailable error displayed despite HTTP success',
      },
      { category: 'javascript', message: 'Object' },
    ],
    [],
    ['https://insure360.test/livewire-84119ac4/update'],
  );
  assert.equal(graded.classification, 'warning');
  assert.equal(graded.issues.length, 0);
  assert.match(graded.warnings[0], /Inconclusive/);
});
test('genuine failures are not suppressed', () => {
  const graded = gradePageWithPolicy(
    [{ category: 'http', message: 'Main document HTTP 500' }],
    [],
    ['https://insure360.test/livewire-84119ac4/update'],
  );
  assert.equal(graded.classification, 'failed');
  assert.equal(graded.issues.length, 1);
});
test('unblocked temporary-unavailable screen is a failure', () => {
  const graded = gradePageWithPolicy(
    [
      {
        category: 'framework',
        message: 'Visible temporary-unavailable error displayed despite HTTP success',
      },
    ],
    [],
    [],
  );
  assert.equal(graded.classification, 'failed');
});
test('browser exception contains useful details, not Object', () => {
  assert.match(normalizeBrowserError(new Error('Details')), /Error: Details/);
  assert.match(normalizeBrowserError({ code: 'FAILED' }), /FAILED/);
});

test('opaque object exceptions use an actionable description', () => {
  assert.match(normalizeBrowserError(new Error('Object')), /Unstructured JavaScript exception/);
});
