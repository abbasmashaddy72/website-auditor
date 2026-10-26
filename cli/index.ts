import 'dotenv/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEvidence } from '../src/lib/storage';
import { parseImportedRoutes } from '../src/lib/routes-import';
import { ObjectId } from 'mongodb';
import { database, ensureIndexes } from '../src/lib/db';
import { normalizeUrl, effectivePort, assertTargetAllowed } from '../src/lib/scope';
import { enqueueScan } from '../src/lib/queue';
import { ensureBucket } from '../src/lib/storage';
import type { Site, PageResult, Scan } from '../src/lib/types';
const args = process.argv.slice(3),
  command = process.argv[2] || '';
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0
    ? args[i + 1]
    : args
        .find((a) => a.startsWith(`--${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');
}
const has = (name: string) => args.includes(`--${name}`);
function number(name: string): number | undefined {
  const s = flag(name);
  if (!s) return;
  const n = Number(s);
  if (!Number.isFinite(n)) throw Error(`Invalid --${name}`);
  return n;
}
async function waitAndExport(scanId: string) {
  if (!has('wait')) {
    if (flag('format'))
      console.log('Export format was specified. Add --wait to export after the worker completes.');
    return;
  }
  const db = await database();
  const format = flag('format') || 'html';
  if (!['html', 'csv', 'json'].includes(format)) throw Error('--format must be html, csv or json');
  while (true) {
    const scan = await db.collection<Scan>('scans').findOne({ _id: new ObjectId(scanId) });
    if (!scan) throw Error('Scan not found');
    if (
      ['completed', 'completed_partial', 'completed_with_errors', 'failed', 'cancelled'].includes(scan.status)
    ) {
      if (!scan.reportKeys) throw Error(`Scan ${scan.status}: no generated report`);
      const key = scan.reportKeys[format];
      const evidence = await getEvidence(key);
      await mkdir('exports', { recursive: true });
      const output = flag('output') || join('exports', `${scanId}.${format}`);
      await writeFile(output, evidence.bytes);
      console.log(`Saved ${format.toUpperCase()} report: ${output}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
function help() {
  console.log(`Website Auditor CLI
 npm run scan -- --site https://site.test [--authorize --allow-local] [--profile PROFILE_ID] [--depth N] [--max-pages N] [--concurrency N] [--timeout MS] [--wait --format html|json|csv]
 npm run routes:import -- --site https://site.test --file routes.json
 npm run scan:status -- [--id SCAN_ID]
 npm run scan:retry -- --scan SCAN_ID
 npm run doctor -- [--site https://site.test]

Notes: an unregistered --site requires --authorize to confirm ownership/permission.
       .test and localhost also require --allow-local; private LAN requires --allow-private.
       The separate worker must be running for queued scans to execute.
`);
}
async function run() {
  if (has('help') || !command) {
    help();
    return;
  }
  await ensureIndexes();
  const db = await database();
  if (command === 'doctor') {
    const hello = await db.command({ ping: 1 });
    console.log('MongoDB:', hello.ok === 1 ? 'OK' : 'Unavailable');
    await ensureBucket();
    console.log('RustFS:', 'Bucket reachable');
    const siteUrl = flag('site');
    if (siteUrl) {
      const url = normalizeUrl(siteUrl),
        u = new URL(url);
      const fake: Site = {
        name: 'CLI doctor',
        baseUrl: url,
        environment: 'local',
        allowedHosts: [u.hostname],
        allowedPorts: [effectivePort(u)],
        allowLocalhost: has('allow-local'),
        allowPrivateNetwork: has('allow-private'),
        ignoreHTTPSErrors: false,
        maxPages: 1,
        maxDepth: 0,
        concurrency: 1,
        timeoutMs: 10000,
        authProfileIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      console.log('Target resolution:', (await assertTargetAllowed(url, fake)).host);
    }
    return;
  }
  if (command === 'status') {
    const q = flag('id') ? { _id: new ObjectId(flag('id')) } : {};
    const scans = await db.collection<Scan>('scans').find(q).sort({ createdAt: -1 }).limit(25).toArray();
    console.table(
      scans.map((s) => ({
        id: s._id?.toString(),
        siteId: s.siteId,
        status: s.status,
        visited: s.progress.visited,
        failed: s.progress.failed,
        queued: s.createdAt.toISOString(),
      })),
    );
    return;
  }
  if (command === 'retry') {
    const scanId = flag('scan');
    if (!scanId) throw Error('--scan SCAN_ID is required');
    const scan = await db.collection<Scan>('scans').findOne({ _id: new ObjectId(scanId) });
    if (!scan) throw Error('Original scan not found');
    const pages = await db
      .collection<PageResult>('pages')
      .find({ scanId, classification: 'failed' })
      .toArray();
    if (!pages.length) {
      console.log('No failed pages to retry');
      return;
    }
    const { scanId: retryId } = await enqueueScan(
      scan.siteId,
      scan.authProfileId,
      pages.map((p) => p.url),
    );
    console.log(`Queued ${pages.length} failed pages for verification. New scan ID: ${retryId}`);
    await waitAndExport(retryId);
    return;
  }
  if (command === 'import') {
    const rawSite = flag('site'),
      file = flag('file');
    if (!rawSite || !file) throw Error('--site and --file required');
    const site = await db.collection<Site>('sites').findOne({ baseUrl: normalizeUrl(rawSite) });
    if (!site?._id) throw Error('Register the website before importing');
    const ext = file.split('.').pop()?.toLowerCase();
    if (!['json', 'csv', 'txt'].includes(ext || '')) throw Error('Expected .json, .csv or .txt');
    const routes = parseImportedRoutes(
      await readFile(file, 'utf8'),
      ext as 'json' | 'csv' | 'txt',
      site.baseUrl,
    );
    const valid: string[] = [];
    for (const url of routes.urls)
      try {
        await assertTargetAllowed(url, site);
        valid.push(url);
      } catch {
        routes.skipped.push(url);
      }
    if (!valid.length) throw Error('No eligible safe routes found');
    const { scanId } = await enqueueScan(site._id.toString(), flag('profile'), valid, undefined, 'import');
    console.log(`Imported ${valid.length} routes; skipped ${routes.skipped.length}. Queued scan ${scanId}`);
    return;
  }
  if (command === 'scan') {
    const requested = flag('site');
    if (!requested) throw Error('--site URL is required');
    const url = normalizeUrl(requested),
      u = new URL(url);
    const existingSite = await db.collection<Site>('sites').findOne({ baseUrl: url });
    let site: Site;
    if (existingSite) {
      site = existingSite;
    } else {
      if (!has('authorize'))
        throw Error(
          `Website is not registered. Run with --authorize after confirming explicit permission: ${url}`,
        );
      const newSite: Site = {
        name: u.hostname,
        baseUrl: url,
        environment: 'local',
        allowedHosts: [u.hostname],
        allowedPorts: [effectivePort(u)],
        allowLocalhost: has('allow-local'),
        allowPrivateNetwork: has('allow-private'),
        ignoreHTTPSErrors: has('ignore-https-errors'),
        maxPages: 50,
        maxDepth: 3,
        concurrency: 2,
        timeoutMs: 30000,
        authProfileIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await assertTargetAllowed(url, newSite);
      const inserted = await db.collection<Site>('sites').insertOne(newSite);
      site = { ...newSite, _id: inserted.insertedId };
    }
    const options = {
      maxDepth: number('depth'),
      maxPages: number('max-pages'),
      concurrency: number('concurrency'),
      timeoutMs: number('timeout'),
    };
    for (const [key, value] of Object.entries(options))
      if (
        value !== undefined &&
        (!Number.isInteger(value) ||
          value < (key === 'maxDepth' || key === 'maxPages' ? 0 : 1) ||
          value > (key === 'maxDepth' ? 10 : key === 'concurrency' ? 6 : key === 'maxPages' ? 10000 : 120000))
      )
        throw Error(`Invalid ${key} override`);
    if (!site._id) throw Error('Website does not have a database identifier');
    const profile = flag('profile');
    const { scanId: id, existing } = await enqueueScan(
      site._id.toString(),
      profile,
      undefined,
      Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as Scan['options'],
    );
    console.log(
      `${existing ? 'Reused active' : 'Queued'} scan ${id} for ${site.baseUrl}. Start worker with: npm run worker`,
    );
    await waitAndExport(id);
    return;
  }
  help();
  process.exitCode = 1;
}
run().catch((e) => {
  console.error('Auditor CLI:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
