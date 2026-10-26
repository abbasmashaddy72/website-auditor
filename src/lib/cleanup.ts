import { createHmac, timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { database } from './db';
import { deleteScanEvidence } from './storage';
import type { Scan } from './types';

export type CleanupMode = 'scans' | 'resolved_issues' | 'events' | 'workers';
export type CleanupRequest = { mode: CleanupMode; days: number; siteId?: string };
type AuthorizedCleanup = CleanupRequest & { cutoff: string; expires: number };
const DONE: Scan['status'][] = [
  'completed',
  'completed_with_errors',
  'completed_partial',
  'failed',
  'cancelled',
];
export function cleanupCutoff(days: number, now = Date.now()): Date {
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw Error('Retention period must be between 1 and 3650 days');
  return new Date(now - days * 86400000);
}
export function cleanupRequest(input: unknown): CleanupRequest {
  if (!input || typeof input !== 'object') throw Error('Invalid cleanup request');
  const item = input as Record<string, unknown>;
  if (!['scans', 'resolved_issues', 'events', 'workers'].includes(String(item.mode)))
    throw Error('Invalid cleanup mode');
  const days = Number(item.days);
  cleanupCutoff(days);
  const siteId = item.siteId === undefined || item.siteId === '' ? undefined : String(item.siteId);
  if (siteId && !ObjectId.isValid(siteId)) throw Error('Invalid website identifier');
  return { mode: item.mode as CleanupMode, days, siteId };
}
function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw Error('SESSION_SECRET must be configured for cleanup authorization');
  return value;
}
function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}
export function makeCleanupToken(params: CleanupRequest, now = Date.now()): string {
  const payload: AuthorizedCleanup = {
    ...params,
    cutoff: cleanupCutoff(params.days, now).toISOString(),
    expires: now + 5 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function validateCleanupToken(token: string, now = Date.now()): AuthorizedCleanup {
  const [body, sig, ...extra] = token.split('.');
  if (!body || !sig || extra.length || body.length > 2048) throw Error('Invalid cleanup confirmation');
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw Error('Cleanup confirmation signature mismatch');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthorizedCleanup;
  const options = cleanupRequest(payload);
  if (!Number.isFinite(payload.expires) || payload.expires <= now || payload.expires > now + 5 * 60 * 1000)
    throw Error('Cleanup preview expired; preview again');
  if (!Number.isFinite(Date.parse(payload.cutoff))) throw Error('Invalid cleanup cutoff');
  return { ...options, cutoff: payload.cutoff, expires: payload.expires };
}
function siteFilter(siteId?: string): Record<string, unknown> {
  return siteId ? { siteId } : {};
}
async function candidateScans(siteId: string | undefined, cutoff: Date, limit = 50) {
  const db = await database();
  const scans = await db
    .collection<Scan>('scans')
    .find({ ...siteFilter(siteId), status: { $in: DONE }, endedAt: { $lt: cutoff } })
    .sort({ endedAt: 1 })
    .limit(limit)
    .toArray();
  const ids = scans.map((s) => s._id!.toString());
  const referenced = ids.length
    ? await db.collection('issues').distinct('scanId', { scanId: { $in: ids } })
    : [];
  const keep = new Set(referenced.map(String));
  return scans.filter((s) => s._id && !keep.has(s._id.toString()));
}
export async function previewCleanup(params: CleanupRequest, cutoff = cleanupCutoff(params.days)) {
  const db = await database(),
    where = siteFilter(params.siteId);
  if (params.mode === 'scans') {
    const scans = await candidateScans(params.siteId, cutoff, 50);
    const ids = scans.map((s) => s._id!.toString());
    return {
      count: scans.length,
      pages: ids.length ? await db.collection('pages').countDocuments({ scanId: { $in: ids } }) : 0,
      limit: 50,
      note: 'Only the oldest 50 eligible finished scans per operation. Scans referenced by issue records are preserved. RustFS evidence is deleted first.',
    };
  }
  if (params.mode === 'resolved_issues')
    return {
      count: await db
        .collection('issues')
        .countDocuments({ ...where, status: 'verified_resolved', lastVerifiedAt: { $lt: cutoff } }),
      note: 'Only verified resolved issues; open and manual-review issues are retained.',
    };
  if (params.mode === 'events')
    return {
      count: await db.collection('scan_events').countDocuments({ ...where, at: { $lt: cutoff } }),
      note: 'Diagnostic activity events only. Scan and page records remain.',
    };
  return {
    count: await db.collection('workers').countDocuments({ heartbeatAt: { $lt: cutoff } }),
    note: 'Stale worker heartbeats only. Active workers remain.',
  };
}
export async function performCleanup(token: string) {
  const params = validateCleanupToken(token),
    cutoff = new Date(params.cutoff),
    db = await database(),
    where = siteFilter(params.siteId);
  if (params.mode === 'resolved_issues') {
    const result = await db
      .collection('issues')
      .deleteMany({ ...where, status: 'verified_resolved', lastVerifiedAt: { $lt: cutoff } });
    return { deleted: result.deletedCount, objects: 0 };
  }
  if (params.mode === 'events') {
    const result = await db.collection('scan_events').deleteMany({ ...where, at: { $lt: cutoff } });
    return { deleted: result.deletedCount, objects: 0 };
  }
  if (params.mode === 'workers') {
    const result = await db.collection('workers').deleteMany({ heartbeatAt: { $lt: cutoff } });
    return { deleted: result.deletedCount, objects: 0 };
  }
  const scans = await candidateScans(params.siteId, cutoff, 50);
  let deleted = 0,
    objects = 0;
  for (const scan of scans) {
    const scanId = scan._id!.toString();
    // Re-check to protect scans that resumed or became issue-referenced since preview.
    const activeIssue = await db.collection('issues').findOne({ scanId });
    const stillDone = await db
      .collection<Scan>('scans')
      .findOne({ _id: scan._id, status: { $in: DONE }, endedAt: { $lt: cutoff } });
    if (activeIssue || !stillDone) continue;
    objects += await deleteScanEvidence(scan.siteId, scanId); // abort on RustFS failure; preserve Mongo reference
    await db.collection('pages').deleteMany({ scanId });
    await db.collection('scan_events').deleteMany({ scanId });
    const result = await db.collection<Scan>('scans').deleteOne({ _id: scan._id, status: { $in: DONE } });
    deleted += result.deletedCount;
  }
  return { deleted, objects };
}
