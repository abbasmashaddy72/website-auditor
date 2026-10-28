import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { reviewTransition, type ReviewableFinding } from '../src/lib/review';
test('Manual Review active finding can be confirmed, dismissed with reason, and reopened', () => {
  const active: ReviewableFinding = { status: 'open' };
  const submitted = reviewTransition(active, 'submit', 'Investigate');
  assert.equal(submitted.status, 'manual_review');
  const confirmed = reviewTransition(submitted, 'confirmed', 'Verified');
  assert.equal(confirmed.reviewState, 'confirmed');
  assert.throws(() => reviewTransition(confirmed, 'false_positive', ''), /reason/i);
  const reop = reviewTransition(confirmed, 'return_active', 'Manual verification passed');
  assert.equal(reop.status, 'reopened');
});
