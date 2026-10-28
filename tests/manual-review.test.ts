import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewTransition } from '../src/lib/review';

test('old active findings can enter review without losing original history', () => {
  const original = { status: 'open' as const };
  assert.deepEqual(reviewTransition(original, 'submit', ''), {
    status: 'manual_review',
    reviewState: 'pending',
  });
  assert.equal(original.status, 'open');
});
test('false positive and accepted decisions require a reason', () => {
  for (const decision of ['false_positive', 'accepted', 'reopen', 'return_active'] as const)
    assert.throws(
      () => reviewTransition({ status: 'manual_review', reviewState: 'pending' }, decision, ''),
      /reason/,
    );
});
test('review decisions can be reopened without erasing prior decisions', () => {
  const history = [{ decision: 'accepted', comment: 'Documented' }];
  const record = { status: 'manual_review' as const, reviewState: 'accepted' as const };
  assert.deepEqual(reviewTransition(record, 'reopen', 'New evidence received'), {
    status: 'reopened',
    reviewState: 'reopened',
  });
  assert.deepEqual(history, [{ decision: 'accepted', comment: 'Documented' }]);
  assert.deepEqual(reviewTransition({ status: 'reopened', reviewState: 'reopened' }, 'submit', 'Again'), {
    status: 'manual_review',
    reviewState: 'pending',
  });
});
test('invalid workflow transitions are rejected', () => {
  assert.throws(() => reviewTransition({ status: 'verified_resolved' }, 'submit', ''), /active/);
  assert.throws(() => reviewTransition({ status: 'open' }, 'confirmed', ''), /Manual Review/);
  assert.throws(
    () => reviewTransition({ status: 'manual_review', reviewState: 'reviewed' }, 'reviewed', ''),
    /already/,
  );
});

test('overriding a prior review decision requires a comment', () => {
  assert.throws(
    () => reviewTransition({ status: 'manual_review', reviewState: 'accepted' }, 'reviewed', ''),
    /reason/,
  );
  assert.deepEqual(
    reviewTransition({ status: 'manual_review', reviewState: 'accepted' }, 'reviewed', 'Found new evidence'),
    { status: 'manual_review', reviewState: 'reviewed' },
  );
});

test('rollback restores previous workflow state while retaining audit events', () => {
  const events = [
    {
      id: 'e1',
      at: new Date(),
      actor: 'admin',
      decision: 'accepted' as const,
      from: 'manual_review' as const,
      to: 'manual_review' as const,
      previousReviewState: 'reviewed' as const,
      reviewState: 'accepted' as const,
      comment: 'accepted',
    },
  ];
  const record = {
    status: 'manual_review' as const,
    reviewState: 'accepted' as const,
    reviewHistory: events,
  };
  assert.deepEqual(reviewTransition(record, 'rollback', 'New evidence invalidates acceptance'), {
    status: 'manual_review',
    reviewState: 'reviewed',
  });
  assert.equal(events.length, 1);
});
