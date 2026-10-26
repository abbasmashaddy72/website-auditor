import { database } from './db';
import { createHash } from 'node:crypto';
import type { Issue, PageResult } from './types';
function fingerprint(url: string, category: string, message: string): string {
  return createHash('sha256')
    .update([url, category, message.slice(0, 160)].join('|'))
    .digest('hex');
}
export async function recordPageIssues(page: PageResult): Promise<void> {
  const db = await database();
  if (page.issues.length === 0 && page.classification === 'passed') {
    // Resolve only issues for the exact route and authentication profile; never for unvisited pages.
    await db.collection<Issue>('issues').updateMany(
      {
        siteId: page.siteId,
        authProfileId: page.authProfileId || { $exists: false },
        url: page.url,
        status: { $in: ['open', 'reopened'] },
      },
      {
        $set: {
          status: 'verified_resolved',
          lastVerifiedAt: page.capturedAt,
          latestHttpStatus: page.status,
        },
        $push: {
          history: {
            at: page.capturedAt,
            scanId: page.scanId,
            status: page.status,
            classification: 'passed',
          },
        },
      },
    );
    return;
  }
  if (page.issues.length === 0) return; // warnings do not verify an earlier failure as resolved
  for (const item of page.issues) {
    const fp = fingerprint(page.url, item.category, item.message),
      collection = db.collection<Issue>('issues');
    const where = { siteId: page.siteId, authProfileId: page.authProfileId, fingerprint: fp };
    const old = await collection.findOne(where);
    await collection.updateOne(
      where,
      {
        $set: {
          status:
            old?.status === 'verified_resolved'
              ? 'reopened'
              : old?.status === 'manual_review'
                ? 'manual_review'
                : 'open',
          latestHttpStatus: page.status,
          lastDetectedAt: page.capturedAt,
          scanId: page.scanId,
          pageId: page._id!.toString(),
        },
        $setOnInsert: {
          siteId: page.siteId,
          authProfileId: page.authProfileId,
          url: page.url,
          fingerprint: fp,
          category: item.category,
          message: item.message,
          firstDetectedAt: page.capturedAt,
        },
        $inc: { occurrences: 1 },
        $push: {
          history: {
            $each: [
              {
                at: page.capturedAt,
                scanId: page.scanId,
                status: page.status,
                classification: page.classification,
              },
            ],
            $slice: -30,
          },
        },
      },
      { upsert: true },
    );
  }
}
