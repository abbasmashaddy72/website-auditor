/** Server-owned batch aggregation. Never infer batch totals from a paginated scan list. */
import type { ScanState } from './types';

export interface BatchSummary {
  _id: string;
  jobs: number;
  queued: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  visited: number;
  discovered: number;
  websites: string[];
  newestAt?: Date;
  attemptCounts?: {
    selected: number;
    newJobs: number;
    reused: number;
    ineligible: number;
    rejected: number;
  } | null;
}

/** MongoDB aggregation, including scans outside the dashboard's current result window. */
export function batchSummaryPipeline(siteId?: string): Record<string, unknown>[] {
  const activeMatch: Record<string, unknown> = { batchId: { $type: 'string', $ne: '' } };
  if (siteId) activeMatch.siteId = siteId;
  const count = (states: ScanState[]) => ({ $sum: { $cond: [{ $in: ['$status', states] }, 1, 0] } });
  return [
    { $match: activeMatch },
    {
      $group: {
        _id: '$batchId',
        jobs: { $sum: 1 },
        queued: count(['queued']),
        running: count(['running']),
        paused: count(['paused']),
        completed: count(['completed', 'completed_with_errors', 'completed_partial']),
        failed: count(['failed']),
        cancelled: count(['cancelled']),
        visited: { $sum: { $ifNull: ['$progress.visited', 0] } },
        discovered: { $sum: { $ifNull: ['$progress.discovered', 0] } },
        websites: { $addToSet: '$siteId' },
        newestAt: { $max: '$createdAt' },
      },
    },
    { $sort: { newestAt: -1, _id: -1 } },
    { $limit: 200 },
  ];
}

/** A real batch may have jobs for multiple websites; count only confirmed terminal jobs. */
export function batchCompletion(batch: BatchSummary): { done: number; active: number; finished: boolean } {
  const done = batch.completed + batch.failed + batch.cancelled;
  const active = batch.queued + batch.running + batch.paused;
  return { done, active, finished: active === 0 && done === batch.jobs };
}
