import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findingSeverity, groupActiveFindings, countFindingSeverities } from '../src/lib/finding-severity';
const row = (category: string, status = 200, message = 'Test failure', id = 'one') => ({
  _id: id,
  url: 'https://example.test/path',
  message,
  category,
  latestHttpStatus: status,
});
test('HTTP 200 does not downgrade functional JavaScript failure', () =>
  assert.equal(findingSeverity(row('javascript')), 'error'));
test('HTTP 500 is always an error and nonfatal audit findings remain warnings', () => {
  assert.equal(findingSeverity(row('accessibility', 500)), 'error');
  assert.equal(findingSeverity(row('performance', 200)), 'warning');
  assert.equal(findingSeverity(row('http', 404)), 'error');
});
test('similar findings group without dropping original issue identifiers', () => {
  const groups = groupActiveFindings([
    row('javascript', 200, 'Error 11', 'a'),
    row('javascript', 200, 'Error 22', 'b'),
  ]);
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].ids, ['a', 'b']);
});

test('global active counts stay mutually exclusive', () => {
  const counts = countFindingSeverities([row('javascript'), row('performance'), row('http', 503)]);
  assert.deepEqual(counts, { error: 2, warning: 1 });
});

test('console runtime failures remain actionable even with HTTP 200', () => {
  assert.equal(findingSeverity(row('console', 200, 'Uncaught TypeError')), 'error');
  assert.equal(findingSeverity(row('console', 200, 'Informational deprecation notice')), 'warning');
});
