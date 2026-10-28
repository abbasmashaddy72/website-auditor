import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { issueListFilter } from '../src/lib/issue-list-filter';
test('manual review history remains accessible after return to active errors', () => {
  const query = issueListFilter('review_history');
  assert.deepEqual(query.$or, [{ status: 'manual_review' }, { reviewHistory: { $exists: true } }]);
});
test('active finding query excludes reviewed and resolved findings', () => {
  const query = issueListFilter('active');
  assert.deepEqual(query.status, { $in: ['open', 'reopened'] });
});
