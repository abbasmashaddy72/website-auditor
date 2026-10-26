import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ensureIndexes } from '../src/lib/db';
import { acquireScan, finishScan, heartbeat, enqueueScheduledSites } from '../src/lib/queue';
import { recordScanEvent, setWorkerInfo } from '../src/lib/telemetry';
import { ensureBucket } from '../src/lib/storage';
import { executeScan } from './scanner';
import { redactText } from '../src/lib/redact';

// Keep blank for an automatically unique identity per process; never share an identity between live processes.
const workerId = process.env.WORKER_ID?.trim() || `worker-${process.pid}-${randomUUID()}`;
const leaseSeconds = Math.max(45, Number(process.env.WORKER_LEASE_SECONDS || 120));
const pollMs = Math.max(500, Number(process.env.WORKER_POLL_MS || 1500));
let shutdown = false;
process.on('SIGINT', () => {
  shutdown = true;
});
process.on('SIGTERM', () => {
  shutdown = true;
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  await ensureIndexes();
  let lastStorageCheck = 0;
  const startedAt = new Date();
  await setWorkerInfo(workerId, { startedAt, status: 'initializing', pid: process.pid });
  console.log(`Website Auditor worker ${workerId}: initializing`);
  const statusTimer = setInterval(
    () => void setWorkerInfo(workerId, {}).catch((e) => console.error('Worker heartbeat:', e)),
    5000,
  );
  try {
    while (!shutdown) {
      try {
        if (Date.now() - lastStorageCheck > 60000) {
          await ensureBucket();
          lastStorageCheck = Date.now();
          await setWorkerInfo(workerId, { status: 'ready', error: undefined });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await setWorkerInfo(workerId, { status: 'unhealthy', error: redactText(message).slice(0, 500) });
        console.error('Worker startup dependency check failed:', message);
        await sleep(15000);
        continue;
      }
      try {
        await enqueueScheduledSites();
        const scan = await acquireScan(workerId, leaseSeconds);
        if (!scan) {
          await sleep(pollMs);
          continue;
        }
        const id = scan._id!.toString();
        await setWorkerInfo(workerId, { status: 'ready', currentScanId: id });
        await recordScanEvent(
          id,
          scan.siteId,
          'starting',
          'Worker claimed scan and is launching Playwright.',
          'info',
          workerId,
        );
        console.log(`Started scan ${id}`);
        const timer = setInterval(
          () =>
            void heartbeat(scan._id!, workerId, leaseSeconds).catch((e) =>
              console.error('Lease heartbeat:', e),
            ),
          Math.floor((leaseSeconds * 1000) / 3),
        );
        try {
          const status = await executeScan(scan, workerId);
          await finishScan(scan._id!, workerId, status);
          await recordScanEvent(id, scan.siteId, status, `Scan ${status}.`, 'info', workerId);
          console.log(`Scan ${id}: ${status}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`Scan ${id} failed`, e);
          await finishScan(scan._id!, workerId, 'failed', { error: redactText(message).slice(0, 1000) });
          await recordScanEvent(id, scan.siteId, 'failed', message, 'error', workerId);
        } finally {
          clearInterval(timer);
          await setWorkerInfo(workerId, { currentScanId: undefined });
        }
      } catch (e) {
        console.error('Worker poll error:', e);
        await setWorkerInfo(workerId, {
          status: 'unhealthy',
          error: redactText(e instanceof Error ? e.message : String(e)).slice(0, 500),
        }).catch(() => {});
        await sleep(5000);
      }
    }
  } finally {
    clearInterval(statusTimer);
    await setWorkerInfo(workerId, { status: 'stopping', currentScanId: undefined }).catch(() => {});
    console.log('Worker stopped');
  }
}
main().catch((e) => {
  console.error('Fatal worker error:', e);
  process.exitCode = 1;
});
