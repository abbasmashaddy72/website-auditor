import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchCompletion, batchSummaryPipeline } from '../src/lib/batch-summary';

test('batch counts are aggregated from the database, not the first 100 visible scans', () => {
  const pipeline = batchSummaryPipeline('site-a');
  assert.deepEqual(pipeline[0], { $match: { batchId: { $type: 'string', $ne: '' }, siteId: 'site-a' } });
  const group = (pipeline[1] as { $group: Record<string, unknown> }).$group;
  assert.deepEqual(group.completed, {
    $sum: {
      $cond: [{ $in: ['$status', ['completed', 'completed_with_errors', 'completed_partial']] }, 1, 0],
    },
  });
  assert.deepEqual(group.websites, { $addToSet: '$siteId' });
  assert.deepEqual(group.visited, { $sum: { $ifNull: ['$progress.visited', 0] } });
  assert.equal((pipeline[3] as { $limit: number }).$limit, 200);
});

test('batch completion never pretends unfinished or paused jobs have completed', () => {
  const summary = {
    _id: 'a',
    jobs: 4,
    completed: 2,
    failed: 1,
    cancelled: 0,
    queued: 0,
    running: 0,
    paused: 1,
    visited: 20,
    discovered: 40,
    websites: ['site-a'],
  };
  assert.deepEqual(batchCompletion(summary), { done: 3, active: 1, finished: false });
  assert.deepEqual(batchCompletion({ ...summary, paused: 0, cancelled: 1 }), {
    done: 4,
    active: 0,
    finished: true,
  });
});
