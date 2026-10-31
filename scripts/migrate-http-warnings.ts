/** Local-only, explicit, idempotent correction of legacy misclassified HTTP 2xx observations.
 * Preview is default; --apply writes a private backup before changing any row.
 * No historical Issue review state/history or evidence is replaced.
 */
import 'dotenv/config';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { database } from '../src/lib/db';
import { historicalWarningCandidate, isFatalWarning } from '../src/lib/page-classification';
import type { PageResult, Scan, Issue } from '../src/lib/types';

const MIGRATION = 'http-2xx-nonfatal-warning-v1';
const apply = process.argv.includes('--apply');
if (process.argv.some((arg) => arg.startsWith('--') && !['--apply', '--preview'].includes(arg)))
  throw Error('Supported options: --preview (default) or --apply');
if (apply && process.argv.includes('--preview')) throw Error('Choose one migration mode');
const db = await database();
const pages = db.collection<PageResult>('pages');
const scans = db.collection<Scan>('scans');
const issues = db.collection<Issue>('issues');
const now = new Date();
const candidates: PageResult[] = [];
let ambiguous = 0;
const ambiguousPages: Array<{
  pageId: string;
  scanId: string;
  httpStatus?: number;
  categories: string[];
  warningCount: number;
}> = [];
const cursor = pages.find({ classification: 'failed', status: { $gte: 200, $lte: 299 } });
for await (const page of cursor) {
  if (historicalWarningCandidate(page)) candidates.push(page);
  else {
    ambiguous++;
    if (ambiguousPages.length < 100)
      ambiguousPages.push({
        pageId: page._id!.toString(),
        scanId: page.scanId,
        httpStatus: page.status,
        categories: [...new Set(page.issues.map((issue) => issue.category))],
        warningCount: page.warnings?.length ?? 0,
      });
  }
}
const scanIds = [...new Set(candidates.map((page) => page.scanId))];
const impactedScans: Scan[] = [];
for (const scanId of scanIds) {
  if (!ObjectId.isValid(scanId)) continue;
  const scan = await scans.findOne({ _id: new ObjectId(scanId) });
  if (scan && !['queued', 'running', 'paused'].includes(scan.status)) impactedScans.push(scan);
}
const allowedScanIds = new Set(impactedScans.map((scan) => scan._id!.toString()));
const eligible = candidates.filter((page) => allowedScanIds.has(page.scanId));

// Preview must include every prospective write, not just failed -> warning pages.
// Determining the latest historical observation per route/profile is read-only.
const latest = new Map<string, PageResult>();
const history = pages
  .find({ classification: { $in: ['failed', 'warning', 'passed'] } })
  .sort({ capturedAt: -1, _id: -1 });
for await (const page of history) {
  const key = JSON.stringify([page.siteId, page.authProfileId || '', page.url]);
  if (!latest.has(key)) latest.set(key, page);
}
const pendingWarningBackfills: Array<{ page: PageResult; warning: string; fingerprint: string }> = [];
for (const page of latest.values()) {
  if (page.classification === 'passed' || !page.warnings?.length) continue;
  for (const warning of new Set(page.warnings)) {
    // Fatal signals require review; backfill only unambiguous non-fatal notes.
    if (isFatalWarning(warning)) continue;
    const fingerprint = createHash('sha256')
      .update([page.url, 'warning', warning.slice(0, 160)].join('|'))
      .digest('hex');
    const existing = await issues.findOne(
      { siteId: page.siteId, authProfileId: page.authProfileId, fingerprint },
      { projection: { _id: 1 } },
    );
    if (!existing) pendingWarningBackfills.push({ page, warning, fingerprint });
  }
}
const report = {
  migration: MIGRATION,
  mode: apply ? 'apply' : 'preview',
  scannedAt: now.toISOString(),
  candidates: candidates.length,
  eligible: eligible.length,
  skippedActiveScan: candidates.length - eligible.length,
  ambiguousRequireReview: ambiguous,
  ambiguousPages, // Identifiers and category names only; no private URLs or evidence are exposed.
  pagesUpdated: 0,
  scansRecomputed: 0,
  warningsBackfillPlanned: pendingWarningBackfills.length,
  warningsBackfilled: 0,
  backup: null as string | null,
};
if (apply) {
  const running = await scans.countDocuments({ status: { $in: ['queued', 'running', 'paused'] } });
  if (running)
    throw Error(
      `Migration blocked: ${running} active/queued scan(s). Stop or complete scans before applying.`,
    );
  const folder = 'storage/test-reports/migrations';
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const backupPath = join(
    folder,
    `${MIGRATION}-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`,
  );
  const previous = {
    migration: MIGRATION,
    pages: eligible.map((page) => ({
      _id: page._id,
      scanId: page.scanId,
      originalClassification: page.classification,
      evidence: page.evidence,
    })),
    scans: impactedScans.map((scan) => ({ _id: scan._id, status: scan.status, progress: scan.progress })),
    warningBackfillPlan: pendingWarningBackfills.map(({ page, fingerprint }) => ({
      siteId: page.siteId,
      pageId: page._id,
      scanId: page.scanId,
      fingerprint,
    })),
  };
  const file = await open(backupPath, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(previous));
  } finally {
    await file.close();
  }
  report.backup = backupPath;
  for (const page of eligible) {
    const changed = await pages.updateOne(
      { _id: page._id, classification: 'failed', status: { $gte: 200, $lte: 299 } },
      {
        $set: { classification: 'warning' },
        $push: {
          classificationHistory: {
            at: now,
            from: 'failed',
            to: 'warning',
            migration: MIGRATION,
            reason: 'Conclusive non-fatal findings under successful HTTP response',
          },
        },
      },
    );
    report.pagesUpdated += changed.modifiedCount;
  }
  // Existing warning-only page observations were not always recorded as findings.
  // Only backfill the latest observation per route/profile, and never reopen an old
  // verified/resolved review record. This does not mutate historical scans.
  for (const { page, warning, fingerprint } of pendingWarningBackfills) {
    // Recheck after preview planning: concurrent workers or reruns may have created it.
    const existing = await issues.findOne({
      siteId: page.siteId,
      authProfileId: page.authProfileId,
      fingerprint,
    });
    if (existing) continue;
    const data: Issue = {
      siteId: page.siteId,
      authProfileId: page.authProfileId,
      url: page.url,
      fingerprint,
      category: 'warning',
      message: warning,
      status: 'open',
      latestHttpStatus: page.status,
      firstDetectedAt: page.capturedAt,
      lastDetectedAt: page.capturedAt,
      firstScanId: page.scanId,
      firstPageId: page._id!.toString(),
      scanId: page.scanId,
      pageId: page._id!.toString(),
      occurrences: 1,
      history: [
        {
          at: page.capturedAt,
          scanId: page.scanId,
          pageId: page._id!.toString(),
          status: page.status,
          classification: 'warning',
        },
      ],
    };
    try {
      const write = await issues.updateOne(
        { siteId: data.siteId, authProfileId: data.authProfileId, fingerprint },
        { $setOnInsert: data },
        { upsert: true },
      );
      if (write.upsertedCount) report.warningsBackfilled++;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    }
  }
  for (const scan of impactedScans) {
    const observations = await pages
      .find({ scanId: scan._id!.toString() })
      .project({ classification: 1 })
      .toArray();
    const passed = observations.filter((page) => page.classification === 'passed').length;
    const failed = observations.filter((page) => page.classification === 'failed').length;
    const warnings = observations.filter((page) => page.classification === 'warning').length;
    const nextStatus = scan.status === 'completed_with_errors' && failed === 0 ? 'completed' : scan.status;
    const update = await scans.updateOne(
      { _id: scan._id, status: scan.status },
      {
        $set: {
          'progress.passed': passed,
          'progress.failed': failed,
          'progress.warnings': warnings,
          status: nextStatus,
        },
        $push: {
          classificationHistory: {
            at: now,
            migration: MIGRATION,
            previousStatus: scan.status,
            previousProgress: scan.progress,
            updatedStatus: nextStatus,
          },
        },
      },
    );
    report.scansRecomputed += update.modifiedCount;
  }
}
console.log(JSON.stringify(report, null, 2));
if (apply) {
  const folder = 'storage/test-reports/migrations';
  const output = join(
    folder,
    `${MIGRATION}-report-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`,
  );
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
}
process.exit(0);
