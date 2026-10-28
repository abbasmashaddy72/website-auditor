/** Persist each selected finding independently of whether it creates a new worker job. */
import type { Db } from 'mongodb';
export type BatchAttemptOutcome = 'queued' | 'reused' | 'ineligible' | 'failed';
export interface BatchAttempt {
  batchId: string;
  source: 'issue' | 'page';
  sourceId: string;
  outcome: BatchAttemptOutcome;
  scanId?: string;
  reason?: string;
  createdAt: Date;
}
export interface BatchAttemptCounts {
  selected: number;
  newJobs: number;
  reused: number;
  ineligible: number;
  failed: number;
}
export function countBatchAttempts(items: Pick<BatchAttempt, 'outcome'>[]): BatchAttemptCounts {
  return {
    selected: items.length,
    newJobs: items.filter((v) => v.outcome === 'queued').length,
    reused: items.filter((v) => v.outcome === 'reused').length,
    ineligible: items.filter((v) => v.outcome === 'ineligible').length,
    failed: items.filter((v) => v.outcome === 'failed').length,
  };
}
export async function recordBatchAttempts(db: Db, attempts: BatchAttempt[]): Promise<void> {
  if (!attempts.length) return;
  await db.collection<BatchAttempt>('batch_requests').bulkWrite(
    attempts.map((item) => ({
      updateOne: {
        filter: { batchId: item.batchId, source: item.source, sourceId: item.sourceId },
        update: { $setOnInsert: item },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}
