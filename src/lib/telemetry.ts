import { ObjectId } from 'mongodb';
import { database } from './db';
import { redactText, redactUrl } from './redact';
import type { ScanEvent, WorkerInfo } from './types';

export async function recordScanEvent(
  scanId: string,
  siteId: string,
  phase: string,
  message: string,
  level: ScanEvent['level'] = 'info',
  workerId?: string,
  url?: string,
) {
  const db = await database();
  const event: ScanEvent = {
    scanId,
    siteId,
    phase,
    level,
    message: redactText(message).slice(0, 700),
    at: new Date(),
    workerId,
  };
  if (url) event.url = redactUrl(url);
  await Promise.all([
    db.collection<ScanEvent>('scan_events').insertOne(event),
    db
      .collection('scans')
      .updateOne({ _id: new ObjectId(scanId) }, { $set: { lastActivityAt: event.at, phase } }),
  ]);
}
export async function setWorkerInfo(id: string, changes: Partial<WorkerInfo>) {
  const db = await database();
  await db
    .collection<WorkerInfo>('workers')
    .updateOne({ _id: id }, { $set: { ...changes, heartbeatAt: new Date() } }, { upsert: true });
}
