import { createHash } from 'node:crypto';
import { ObjectId, MongoServerError } from 'mongodb';
import { database } from './db';
import { recordScanEvent } from './telemetry';
import type { Scan, Site } from './types';

const activeStatuses: Scan['status'][] = ['queued', 'running', 'paused'];
function canonicalOptions(options?: Scan['options']): Record<string, number> {
  return Object.fromEntries(
    Object.entries(options || {})
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, number>;
}
export function scanKey(
  siteId: string,
  authProfileId?: string,
  urls?: string[],
  options?: Scan['options'],
  mode?: Scan['mode'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        siteId,
        authProfileId: authProfileId || null,
        mode: mode || (urls ? 'retry' : 'crawl'),
        urls: urls ? [...new Set(urls)].sort() : null,
        options: canonicalOptions(options),
      }),
    )
    .digest('hex');
}
let ensureQueueIndex: Promise<string> | undefined;
export async function enqueueScan(
  siteId: string,
  authProfileId?: string,
  urls?: string[],
  options?: Scan['options'],
  mode?: Scan['mode'],
): Promise<{ scanId: string; existing: boolean }> {
  const db = await database();
  ensureQueueIndex ??= db
    .collection<Scan>('scans')
    .createIndex(
      { activeKey: 1 },
      { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } },
    )
    .catch((e) => {
      ensureQueueIndex = undefined;
      throw e;
    });
  await ensureQueueIndex;
  if (!ObjectId.isValid(siteId)) throw Error('Invalid site identifier');
  const site = await db.collection<Site>('sites').findOne({ _id: new ObjectId(siteId) });
  if (!site) throw Error('Unknown website');
  let authProfileName: string | undefined;
  if (authProfileId) {
    if (!ObjectId.isValid(authProfileId)) throw Error('Invalid authentication profile');
    const profile = await db.collection('profiles').findOne({ _id: new ObjectId(authProfileId), siteId });
    if (!profile) throw Error('Authentication profile does not belong to website');
    authProfileName = String(profile.name || 'Authenticated');
  }
  const activeKey = scanKey(siteId, authProfileId, urls, options, mode);
  const current = await db.collection<Scan>('scans').findOne({ activeKey, status: { $in: activeStatuses } });
  if (current?._id) return { scanId: current._id.toString(), existing: true };
  // Upgrade compatibility: scans queued by older versions did not have activeKey.
  // Reuse an equivalent active legacy scan rather than creating a fifth duplicate.
  const legacy = await db
    .collection<Scan>('scans')
    .find({ siteId, status: { $in: activeStatuses }, activeKey: { $exists: false } })
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray();
  const wanted = scanKey(siteId, authProfileId, urls, options, mode);
  for (const old of legacy)
    if (old._id && scanKey(old.siteId, old.authProfileId, old.urls, old.options, old.mode) === wanted)
      return { scanId: old._id.toString(), existing: true };
  const now = new Date();
  const scan: Scan = {
    siteId,
    authProfileId,
    authProfileName,
    mode: mode || (urls ? 'retry' : 'crawl'),
    urls,
    options,
    activeKey,
    status: 'queued',
    createdAt: now,
    lastActivityAt: now,
    phase: 'queued',
    progress: { discovered: 0, visited: 0, passed: 0, failed: 0, warnings: 0 },
  };
  try {
    const record = await db.collection<Scan>('scans').insertOne(scan);
    await recordScanEvent(
      record.insertedId.toString(),
      siteId,
      'queued',
      authProfileName
        ? `Scan queued with authentication profile ${authProfileName}. Waiting for an available worker.`
        : 'Unauthenticated scan queued. Waiting for an available worker.',
    );
    return { scanId: record.insertedId.toString(), existing: false };
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      const duplicate = await db.collection<Scan>('scans').findOne({ activeKey });
      if (duplicate?._id) return { scanId: duplicate._id.toString(), existing: true };
    }
    throw e;
  }
}
export async function acquireScan(owner: string, seconds = 120): Promise<Scan | null> {
  const db = await database();
  const now = new Date();
  await db.collection<Scan>('scans').updateMany(
    { cancelRequested: true, status: { $in: ['running', 'paused'] }, leaseUntil: { $lt: now } },
    {
      $set: { status: 'cancelled', phase: 'cancelled', endedAt: now },
      $unset: { activeKey: '', leaseUntil: '', leaseOwner: '' },
    },
  );
  const result = await db.collection<Scan>('scans').findOneAndUpdate(
    {
      cancelRequested: { $ne: true },
      $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lt: now } }],
    },
    {
      $set: {
        status: 'running',
        phase: 'starting',
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + seconds * 1000),
        startedAt: now,
        lastActivityAt: now,
      },
      $unset: { error: '' },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
  return result;
}
export async function heartbeat(id: ObjectId, owner: string, seconds = 120) {
  const db = await database();
  return (
    (
      await db
        .collection<Scan>('scans')
        .updateOne(
          { _id: id, leaseOwner: owner, status: { $in: ['running', 'paused'] } },
          { $set: { leaseUntil: new Date(Date.now() + seconds * 1000) } },
        )
    ).matchedCount > 0
  );
}
export async function updateProgress(id: ObjectId, owner: string, values: Partial<Scan['progress']>) {
  const db = await database();
  const fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [`progress.${k}`, v]));
  await db
    .collection<Scan>('scans')
    .updateOne({ _id: id, leaseOwner: owner }, { $set: { ...fields, lastActivityAt: new Date() } });
}
export async function finishScan(
  id: ObjectId,
  owner: string,
  status: Scan['status'],
  extra: Partial<Scan> = {},
) {
  const db = await database();
  await db.collection<Scan>('scans').updateOne(
    { _id: id, leaseOwner: owner },
    {
      $set: { ...extra, status, phase: status, endedAt: new Date(), lastActivityAt: new Date() },
      $unset: { leaseOwner: '', leaseUntil: '', activeKey: '' },
    },
  );
}
export async function enqueueScheduledSites(): Promise<number> {
  const db = await database();
  let created = 0;
  while (created < 20) {
    const now = new Date();
    const site = await db.collection<Site>('sites').findOneAndUpdate(
      { scheduleMinutes: { $gt: 0 }, nextAutoScanAt: { $lte: now } },
      [
        {
          $set: {
            nextAutoScanAt: {
              $dateAdd: { startDate: '$$NOW', unit: 'minute', amount: '$scheduleMinutes' },
            },
          },
        },
      ],
      { returnDocument: 'before' },
    );
    if (!site?._id) break;
    const result = await enqueueScan(site._id.toString());
    if (!result.existing) created++;
  }
  return created;
}
