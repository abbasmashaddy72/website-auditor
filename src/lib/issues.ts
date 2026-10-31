import { database } from './db';
import { createHash } from 'node:crypto';
import type { Issue, PageResult } from './types';
import { activeFindingsForVerification, canVerifyResolution, verifiedSnapshot } from './resolution';
import { pageFindings } from './finding-records';
function fingerprint(url: string, category: string, message: string): string {
  return createHash('sha256')
    .update([url, category, message.slice(0, 160)].join('|'))
    .digest('hex');
}
export async function recordPageIssues(page: PageResult): Promise<void> {
  const db = await database();
  if (canVerifyResolution(page)) {
    // Resolve only issues for the exact route and authentication profile; never for unvisited pages.
    await db.collection<Issue>('issues').updateMany(activeFindingsForVerification(page), {
      $set: {
        status: 'verified_resolved',
        lastVerifiedAt: page.capturedAt,
        latestHttpStatus: page.status,
        lastResolution: verifiedSnapshot(page),
      },
      $push: {
        history: {
          at: page.capturedAt,
          scanId: page.scanId,
          pageId: page._id!.toString(),
          status: page.status,
          classification: 'passed',
        },
      },
    });
    return;
  }
  // Warning-only page diagnostics also need durable issue records so the Active Warnings
  // badge, review queue and summary all count the same source of truth.
  const findings = pageFindings(page);
  if (findings.length === 0) return;
  for (const item of findings) {
    const fp = fingerprint(page.url, item.category, item.message),
      collection = db.collection<Issue>('issues');
    const where = { siteId: page.siteId, authProfileId: page.authProfileId, fingerprint: fp };
    const old = await collection.findOne(where);
    if (old?.lastDetectedAt && old.lastDetectedAt.getTime() > page.capturedAt.getTime()) continue;
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
          firstScanId: page.scanId,
          firstPageId: page._id!.toString(),
        },
        $inc: { occurrences: 1 },
        $push: {
          // Append without truncation. Historical failures must remain available for comparison.
          history: {
            at: page.capturedAt,
            scanId: page.scanId,
            pageId: page._id!.toString(),
            status: page.status,
            classification: page.classification,
          },
        },
      },
      { upsert: true },
    );
  }
}
