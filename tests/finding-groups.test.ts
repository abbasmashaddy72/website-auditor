import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findingIssueSignature, groupActiveFindings } from '../src/lib/finding-severity';

const issue = (id: string, url: string, message: string, code: number, category = 'http') => ({
  _id: id,
  url,
  message,
  category,
  latestHttpStatus: code,
});

test('HTTP 500 findings from different routes form one issue group, preserving IDs', () => {
  const rows = [
    issue('a', 'https://one.test/users', 'Main document HTTP 500', 500),
    issue('b', 'https://one.test/roles', 'Main document HTTP 500', 500),
    issue('c', 'https://one.test/roles', 'Main document HTTP 500', 500),
  ];
  const groups = groupActiveFindings(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].routes, 2);
  assert.deepEqual(groups[0].ids, ['a', 'b', 'c']);
  assert.match(groups[0].label, /http: Main document HTTP 500/i);
});

test('HTTP 500 and 502 remain distinct groups; categories never mix', () => {
  const rows = [
    issue('a', 'https://one.test/x', 'Main document HTTP 500', 500),
    issue('b', 'https://one.test/y', 'Main document HTTP 502', 502),
    issue('c', 'https://one.test/z', 'Main document HTTP 500', 500, 'network'),
  ];
  assert.equal(groupActiveFindings(rows).length, 3);
});

test('volatile URLs and record IDs do not split otherwise identical findings', () => {
  const a = issue(
    'a',
    'https://one.test/x',
    'Uncaught error on https://one.test/users/19',
    200,
    'javascript',
  );
  const b = issue(
    'b',
    'https://one.test/y',
    'Uncaught error on https://one.test/users/22',
    200,
    'javascript',
  );
  assert.equal(findingIssueSignature(a), findingIssueSignature(b));
  assert.equal(groupActiveFindings([a, b])[0].count, 2);
});

test('source findings are not changed by grouping', () => {
  const rows = [issue('a', 'https://one.test/a', 'Main document HTTP 500', 500)];
  const copy = JSON.stringify(rows);
  groupActiveFindings(rows);
  assert.equal(JSON.stringify(rows), copy);
});

test('group titles do not repeat an existing issue-category prefix', () => {
  const [group] = groupActiveFindings([
    issue('a', 'https://one.test/x', 'http: Main document HTTP 500', 500),
  ]);
  assert.equal(group.label, 'http: Main document HTTP 500');
});
