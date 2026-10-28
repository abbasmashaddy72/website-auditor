import { countFindingSeverities } from '@/lib/finding-severity';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { Filter, UpdateFilter } from 'mongodb';
import { z } from 'zod';
import { database } from '@/lib/db';
import { normalizeUrl, effectivePort, assertTargetAllowed, parseAllowedHosts } from '@/lib/scope';
import { encrypt } from '@/lib/crypto';
import { configBackupApi } from '@/lib/config-backup-api';
import { profileNameKey } from '@/lib/profile-name';
import { inspectSource, validatePatch, applyApprovedPatch } from '@/lib/fixes';
import { assertApiAccess, setLoginCookie, clearLoginCookie, verifyPassword } from '@/lib/auth';
import { enqueueScan } from '@/lib/queue';
import { recordScanEvent } from '@/lib/telemetry';
import { getEvidence, deleteScanEvidence } from '@/lib/storage';
import { buildIssueExport } from '@/lib/error-export';
import { reviewDecisions, reviewTransition } from '@/lib/review';
import type { ReviewEvent } from '@/lib/review';
import { buildReviewExport, buildReviewWorkbook } from '@/lib/review-export';
import { buildDiagnosticExport, buildDiagnosticWorkbook } from '@/lib/diagnostic-export';
import { buildEvidenceBundle } from '@/lib/evidence-bundle';
import { distinctHttpStatuses, reportPageFilter } from '@/lib/report-filter';
import { reportSort } from '@/lib/report-sort';
import { batchSummaryPipeline } from '@/lib/batch-summary';
import { aggregateAnalytics } from '@/lib/analytics-query';
import { recordBatchAttempts, countBatchAttempts, type BatchAttempt } from '@/lib/batch-attempts';
import { issueListFilter } from '@/lib/issue-list-filter';
import { workerControlEnabled, workerService } from '@/lib/worker-control';
import { cleanupRequest, makeCleanupToken, performCleanup, previewCleanup } from '@/lib/cleanup';
import type { Site, Scan, AuthProfile, PageResult, Issue } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const loginAttempts = new Map<string, { count: number; until: number }>();
const id = (value: string) => {
  if (!ObjectId.isValid(value)) throw Error('Invalid identifier');
  return new ObjectId(value);
};
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return json(
    { error: msg },
    /^(Unknown|Invalid|Host out|Port out|Loopback|Private|Only HTTP|No site|Authentication profile)/.test(msg)
      ? 400
      : 500,
  );
}
const siteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().min(3),
  environment: z.enum(['local', 'staging', 'production']).default('local'),
  framework: z.string().max(80).optional(),
  sourcePath: z.string().max(500).optional(),
  allowedHosts: z.array(z.string().trim().toLowerCase().min(1)).max(50).default([]),
  allowedPorts: z.array(z.number().int().min(1).max(65535)).max(30).default([]),
  allowPrivateNetwork: z.boolean().default(false),
  allowLocalhost: z.boolean().default(false),
  ignoreHTTPSErrors: z.boolean().default(false),
  maxPages: z.number().int().min(0).max(10000).default(50),
  discoveryMode: z.enum(['navigation', 'all-links']).default('navigation'),
  maxDepth: z.number().int().min(0).max(10).default(3),
  concurrency: z.number().int().min(1).max(6).default(2),
  timeoutMs: z.number().int().min(3000).max(120000).default(30000),
  captureTraces: z.boolean().default(false),
  captureHealthy: z.boolean().default(false),
  allowPassiveLivewire: z.boolean().default(false),
  allowLivewireBackground: z.boolean().default(false),
  scheduleMinutes: z.number().int().min(0).max(10080).default(0),
  authorized: z.literal(true),
});
async function handle(request: NextRequest, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', route: string[]) {
  const endpoint = route[0] || '';
  try {
    if (method === 'POST' && endpoint === 'login') {
      const origin = request.headers.get('origin'),
        host = request.headers.get('host');
      if (!origin || !host || new URL(origin).host !== host)
        return json({ error: 'Cross-origin login denied' }, 403);
      const key = host,
        prior = loginAttempts.get(key);
      if (prior && prior.count >= 10 && prior.until > Date.now())
        return json({ error: 'Too many failed logins. Try again later.' }, 429);
      const body = await request.json();
      if (!verifyPassword(String(body.password || ''))) {
        loginAttempts.set(key, {
          count: (prior && prior.until > Date.now() ? prior.count : 0) + 1,
          until: Date.now() + 5 * 60 * 1000,
        });
        return json({ error: 'Invalid administrator password' }, 401);
      }
      loginAttempts.delete(key);
      const result = json({ ok: true });
      setLoginCookie(result);
      return result;
    }
    const denial = await assertApiAccess(request, method !== 'GET');
    if (denial) return denial;
    if (method === 'POST' && endpoint === 'logout') {
      const result = json({ ok: true });
      clearLoginCookie(result);
      return result;
    }
    const actor = `administrator-session:${createHash('sha256')
      .update(request.cookies.get('auditor_session')?.value || 'authenticated')
      .digest('hex')
      .slice(0, 12)}`;
    const db = await database();
    if (endpoint === 'config-backup' && method === 'POST') {
      return configBackupApi(db, request, route[1] || '');
    }
    if (method === 'GET' && endpoint === 'summary') {
      const [sites, scans, activeScans, issues, resolved, manualReview, recent] = await Promise.all([
        db.collection('sites').countDocuments(),
        db.collection('scans').countDocuments(),
        db.collection('scans').countDocuments({ status: { $in: ['queued', 'running', 'paused'] } }),
        db.collection('issues').countDocuments({ status: { $in: ['open', 'reopened'] } }),
        db.collection('issues').countDocuments({ status: 'verified_resolved' }),
        db.collection('issues').countDocuments({ status: 'manual_review' }),
        db.collection<Scan>('scans').find().sort({ createdAt: -1 }).limit(7).toArray(),
      ]);
      const activeFindingEvidence = await db
        .collection<Issue>('issues')
        .find(
          { status: { $in: ['open', 'reopened'] } },
          { projection: { category: 1, message: 1, latestHttpStatus: 1 } },
        )
        .toArray();
      const severities = countFindingSeverities(activeFindingEvidence);
      return json({
        sites,
        scans,
        activeScans,
        issues,
        resolved,
        manualReview,
        errorIssues: severities.error,
        warningIssues: severities.warning,
        recent,
      });
    }
    if (endpoint === 'sites') {
      if (method === 'GET')
        return json(await db.collection<Site>('sites').find().sort({ createdAt: -1 }).toArray());
      if (method === 'POST') {
        const body = siteSchema.parse(await request.json());
        const baseUrl = normalizeUrl(body.baseUrl),
          u = new URL(baseUrl);
        if (
          body.environment === 'production' &&
          (body.ignoreHTTPSErrors || body.allowPassiveLivewire || body.allowLivewireBackground)
        )
          throw Error(
            'Production sites must verify TLS certificates and cannot enable Livewire compatibility modes',
          );
        const { authorized, ...data } = body;
        if (authorized !== true) throw Error('Target authorization is required');
        const scope = parseAllowedHosts(data.allowedHosts);
        const site: Site = {
          ...data,
          baseUrl,
          allowedHosts: [...new Set([u.hostname, ...scope.hosts])],
          allowedPorts: [...new Set([effectivePort(u), ...data.allowedPorts, ...scope.ports])],
          authProfileIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          nextAutoScanAt: data.scheduleMinutes
            ? new Date(Date.now() + data.scheduleMinutes * 60000)
            : undefined,
        };
        await assertTargetAllowed(baseUrl, site);
        const insert = await db.collection<Site>('sites').insertOne(site);
        return json({ _id: insert.insertedId, ...site }, 201);
      }
      if (route[1] && method === 'PATCH') {
        const body = siteSchema.parse(await request.json());
        const current = await db.collection<Site>('sites').findOne({ _id: id(route[1]) });
        if (!current) throw Error('Website not found');
        if (
          body.environment === 'production' &&
          (body.ignoreHTTPSErrors || body.allowPassiveLivewire || body.allowLivewireBackground)
        )
          throw Error(
            'Production sites must verify TLS certificates and cannot enable Livewire compatibility modes',
          );
        const u = new URL(normalizeUrl(body.baseUrl)),
          { authorized, ...config } = body;
        if (authorized !== true) throw Error('Target authorization is required');
        const scope = parseAllowedHosts(body.allowedHosts);
        const update = {
          ...config,
          baseUrl: u.href,
          allowedHosts: [...new Set([u.hostname, ...scope.hosts])],
          allowedPorts: [...new Set([effectivePort(u), ...body.allowedPorts, ...scope.ports])],
          updatedAt: new Date(),
          nextAutoScanAt: body.scheduleMinutes
            ? new Date(Date.now() + body.scheduleMinutes * 60000)
            : undefined,
        };
        await assertTargetAllowed(update.baseUrl, { ...current, ...update });
        await db.collection<Site>('sites').updateOne({ _id: current._id }, { $set: update });
        return json({ ok: true });
      }
      if (route[1] && method === 'DELETE') {
        const current = await db.collection<Site>('sites').findOne({ _id: id(route[1]) });
        if (!current) return json({ error: 'Website not found' }, 404);
        const body = z
          .object({ confirmName: z.string(), deleteHistory: z.boolean().default(false) })
          .parse(await request.json());
        if (body.confirmName !== current.name)
          return json({ error: 'Confirmation name does not match' }, 400);
        const siteId = current._id!.toString();
        const related = await db.collection<Scan>('scans').find({ siteId }).toArray();
        if (related.some((scan) => ['queued', 'running', 'paused'].includes(scan.status)))
          return json({ error: 'Cancel all active scans before deleting this website' }, 409);
        if (related.length && !body.deleteHistory)
          return json(
            {
              error: `This website has ${related.length} historical scans. Enable delete history and evidence to proceed.`,
            },
            409,
          );
        // Delete private objects first. Failure stops deletion instead of leaving dangling objects.
        for (const scan of related) await deleteScanEvidence(siteId, scan._id!.toString());
        await db.collection('pages').deleteMany({ siteId });
        await db.collection('issues').deleteMany({ siteId });
        await db.collection('scan_events').deleteMany({ siteId });
        await db.collection('scans').deleteMany({ siteId });
        await db.collection('profiles').deleteMany({ siteId });
        await db.collection('sites').deleteOne({ _id: current._id });
        return json({ ok: true, deletedScans: related.length });
      }
    }
    if (endpoint === 'profiles') {
      if (method === 'GET') {
        const siteId = request.nextUrl.searchParams.get('siteId');
        const items = await db
          .collection<AuthProfile>('profiles')
          .find(
            {
              ...(siteId ? { siteId } : {}),
              archivedAt: { $exists: request.nextUrl.searchParams.get('archived') === '1' },
            },
            { projection: { encryptedPassword: 0 } },
          )
          .toArray();
        return json(items);
      }
      if (method === 'DELETE' && route[1]) {
        const current = await db.collection<AuthProfile>('profiles').findOne({ _id: id(route[1]) });
        if (!current) return json({ error: 'Profile not found' }, 404);
        if (current.archivedAt) return json({ error: 'Profile already archived' }, 409);
        const body = z.object({ confirmName: z.string() }).parse(await request.json());
        if (body.confirmName !== current.name)
          return json({ error: 'Profile name confirmation does not match' }, 400);
        const active = await db.collection<Scan>('scans').countDocuments({
          authProfileId: current._id!.toString(),
          status: { $in: ['queued', 'running', 'paused'] },
        });
        if (active)
          return json({ error: 'Cancel associated active scans before archiving this profile' }, 409);
        const changed = await db
          .collection<AuthProfile>('profiles')
          .updateOne(
            { _id: current._id, archivedAt: { $exists: false } },
            { $set: { archivedAt: new Date() }, $unset: { profileNameKey: '' } },
          );
        if (!changed.modifiedCount) return json({ error: 'Profile changed concurrently' }, 409);
        return json({
          ok: true,
          archived: true,
          notice: 'Profile archived; historical scans and encrypted credentials preserved',
        });
      }
      if (method === 'POST' && route[1] === 'restore' && route[2]) {
        const current = await db.collection<AuthProfile>('profiles').findOne({ _id: id(route[2]) });
        if (!current || !current.archivedAt) return json({ error: 'Archived profile not found' }, 404);
        const body = z.object({ confirmName: z.string() }).parse(await request.json());
        if (body.confirmName !== current.name)
          return json({ error: 'Profile name confirmation does not match' }, 400);
        const existing = await db
          .collection<AuthProfile>('profiles')
          .find(
            { siteId: current.siteId, archivedAt: { $exists: false } },
            { projection: { name: 1, profileNameKey: 1 } },
          )
          .toArray();
        if (
          existing.some(
            (profile) =>
              (profile.profileNameKey || profileNameKey(profile.name)) === profileNameKey(current.name),
          )
        )
          return json({ error: 'Another active profile has this name; rename it before restoring' }, 409);
        const changed = await db
          .collection<AuthProfile>('profiles')
          .updateOne(
            { _id: current._id, archivedAt: { $exists: true } },
            { $set: { profileNameKey: profileNameKey(current.name) }, $unset: { archivedAt: '' } },
          );
        if (!changed.modifiedCount) return json({ error: 'Profile changed concurrently' }, 409);
        return json({ ok: true, restored: true });
      }
      if (method === 'POST') {
        const fields = z
          .object({
            siteId: z.string(),
            name: z.string().trim().min(1).max(100),
            loginUrl: z.string(),
            startUrl: z.string().optional(),
            username: z.string().min(1),
            password: z.string().min(1),
            usernameSelector: z.string().optional(),
            passwordSelector: z.string().optional(),
            submitSelector: z.string().optional(),
            successSelector: z.string().optional(),
            successUrl: z.string().optional(),
          })
          .parse(await request.json());
        const site = await db.collection<Site>('sites').findOne({ _id: id(fields.siteId) });
        if (!site) throw Error('Unknown website');
        await assertTargetAllowed(fields.loginUrl, site);
        if (fields.startUrl?.trim()) await assertTargetAllowed(fields.startUrl, site);
        if (fields.successUrl?.trim()) await assertTargetAllowed(fields.successUrl, site);
        const existingNames = await db
          .collection<AuthProfile>('profiles')
          .find({ siteId: fields.siteId }, { projection: { name: 1, profileNameKey: 1 } })
          .toArray();
        if (
          existingNames.some(
            (existing) =>
              (existing.profileNameKey || profileNameKey(existing.name)) === profileNameKey(fields.name),
          )
        )
          return json({ error: 'A profile with this name already exists for the website' }, 409);
        const { password, ...safe } = fields;
        const item: AuthProfile = {
          ...safe,
          profileNameKey: profileNameKey(fields.name),
          loginUrl: normalizeUrl(fields.loginUrl),
          startUrl: fields.startUrl?.trim() ? normalizeUrl(fields.startUrl) : undefined,
          successUrl: fields.successUrl?.trim() ? normalizeUrl(fields.successUrl) : undefined,
          encryptedPassword: encrypt(password),
          createdAt: new Date(),
        };
        const created = await db.collection<AuthProfile>('profiles').insertOne(item);
        return json({ _id: created.insertedId, ...safe }, 201);
      }
      if (method === 'PATCH' && route[1]) {
        const current = await db.collection<AuthProfile>('profiles').findOne({ _id: id(route[1]) });
        if (!current || current.archivedAt) throw Error('Authentication profile missing or archived');
        const fields = z
          .object({
            name: z.string().trim().min(1).max(100),
            loginUrl: z.string().min(3),
            startUrl: z.string().optional(),
            username: z.string().min(1),
            password: z.string().optional(),
            usernameSelector: z.string().optional(),
            passwordSelector: z.string().optional(),
            submitSelector: z.string().optional(),
            successSelector: z.string().optional(),
            successUrl: z.string().optional(),
          })
          .parse(await request.json());
        const site = await db.collection<Site>('sites').findOne({ _id: id(current.siteId) });
        if (!site) throw Error('Website missing for authentication profile');
        await assertTargetAllowed(fields.loginUrl, site);
        if (fields.startUrl?.trim()) await assertTargetAllowed(fields.startUrl, site);
        if (fields.successUrl?.trim()) await assertTargetAllowed(fields.successUrl, site);
        const existingNames = await db
          .collection<AuthProfile>('profiles')
          .find(
            { siteId: current.siteId, _id: { $ne: current._id } },
            { projection: { name: 1, profileNameKey: 1 } },
          )
          .toArray();
        if (
          existingNames.some(
            (existing) =>
              (existing.profileNameKey || profileNameKey(existing.name)) === profileNameKey(fields.name),
          )
        )
          return json({ error: 'A profile with this name already exists for the website' }, 409);
        const { password, ...safe } = fields;
        const update = {
          ...safe,
          profileNameKey: profileNameKey(fields.name),
          loginUrl: normalizeUrl(fields.loginUrl),
          startUrl: fields.startUrl?.trim() ? normalizeUrl(fields.startUrl) : undefined,
          successUrl: fields.successUrl?.trim() ? normalizeUrl(fields.successUrl) : undefined,
          ...(password?.length ? { encryptedPassword: encrypt(password) } : {}),
        };
        await db.collection<AuthProfile>('profiles').updateOne({ _id: current._id }, { $set: update });
        return json({ ok: true });
      }
    }
    if (endpoint === 'analytics' && method === 'GET') {
      const params = request.nextUrl.searchParams;
      const rawDays = params.get('days') || '7';
      if (!['7', '30'].includes(rawDays)) return json({ error: 'Invalid analytics period' }, 400);
      const siteId = params.get('siteId') || undefined;
      if (siteId) id(siteId);
      return json(await aggregateAnalytics(db, new Date(), Number(rawDays), siteId));
    }
    if (endpoint === 'scans') {
      if (method === 'GET') {
        if (route[1] === 'batch' && route[2]) {
          const batchId = id(route[2]).toString();
          const rawSkip = Number(request.nextUrl.searchParams.get('skip') || '0');
          if (!Number.isSafeInteger(rawSkip) || rawSkip < 0 || rawSkip > 100000)
            return json({ error: 'Invalid batch page offset' }, 400);
          const filter = { batchId };
          const [items, total] = await Promise.all([
            db
              .collection<Scan>('scans')
              .find(filter)
              .sort({ createdAt: -1, _id: -1 })
              .skip(rawSkip)
              .limit(100)
              .toArray(),
            db.collection<Scan>('scans').countDocuments(filter),
          ]);
          return json({
            items,
            total,
            nextSkip: rawSkip + items.length < total ? rawSkip + items.length : null,
          });
        }
        if (route[1] === 'batches') {
          const siteId = request.nextUrl.searchParams.get('siteId') || undefined;
          if (siteId) id(siteId);
          const batches = await db
            .collection<Scan>('scans')
            .aggregate(batchSummaryPipeline(siteId))
            .toArray();
          if (!batches.length) return json([]);
          const attemptGroups = await db
            .collection('batch_requests')
            .aggregate([
              { $match: { batchId: { $in: batches.map((batch) => batch._id) } } },
              {
                $group: {
                  _id: '$batchId',
                  selected: { $sum: 1 },
                  newJobs: { $sum: { $cond: [{ $eq: ['$outcome', 'queued'] }, 1, 0] } },
                  reused: { $sum: { $cond: [{ $eq: ['$outcome', 'reused'] }, 1, 0] } },
                  ineligible: { $sum: { $cond: [{ $eq: ['$outcome', 'ineligible'] }, 1, 0] } },
                  rejected: { $sum: { $cond: [{ $eq: ['$outcome', 'failed'] }, 1, 0] } },
                },
              },
            ])
            .toArray();
          const byBatch = new Map(attemptGroups.map((result) => [String(result._id), result]));
          return json(
            batches.map((batch) => ({ ...batch, attemptCounts: byBatch.get(String(batch._id)) || null })),
          );
        }
        if (route[1] === 'http-statuses') {
          const params = new URLSearchParams(request.nextUrl.searchParams);
          params.delete('http'); // Available codes must not disappear after a code is chosen.
          const siteId = params.get('siteId');
          const scanId = params.get('scanId');
          if (siteId) id(siteId);
          if (scanId) id(scanId);
          let filter: Filter<PageResult>;
          try {
            filter = reportPageFilter(params);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : 'Invalid filters' }, 400);
          }
          const values = await db.collection<PageResult>('pages').distinct('status', filter);
          return json({ statuses: distinctHttpStatuses(values) });
        }
        if (route[1] === 'pages') {
          const query = request.nextUrl.searchParams;
          const forcedScan = route[2];
          if (forcedScan) id(forcedScan);
          const siteId = query.get('siteId');
          const scanId = forcedScan || query.get('scanId');
          if (siteId) id(siteId);
          if (scanId) id(scanId);
          if (query.get('paged') !== '1') {
            if (!forcedScan) return json({ error: 'Choose a scan for unpaged legacy results' }, 400);
            return json(
              await db
                .collection<PageResult>('pages')
                .find({ scanId: forcedScan })
                .sort({ capturedAt: -1 })
                .limit(2000)
                .toArray(),
            );
          }
          let filter: Filter<PageResult>;
          try {
            filter = reportPageFilter(query, forcedScan);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : 'Invalid filters' }, 400);
          }
          let ordering: ReturnType<typeof reportSort>;
          try {
            ordering = reportSort(query);
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : 'Invalid sorting' }, 400);
          }
          const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 30) || 30));
          const page = Math.max(0, Math.min(10000, Number(query.get('page') || 0) || 0));
          const [items, total] = await Promise.all([
            db
              .collection<PageResult>('pages')
              .find(filter)
              .sort(ordering)
              .skip(page * limit)
              .limit(limit)
              .toArray(),
            db.collection<PageResult>('pages').countDocuments(filter),
          ]);
          return json({ items, total, page, limit });
        }
        const scanId = request.nextUrl.searchParams.get('id');
        if (scanId) return json(await db.collection<Scan>('scans').findOne({ _id: id(scanId) }));
        return json(await db.collection<Scan>('scans').find().sort({ createdAt: -1 }).limit(100).toArray());
      }
      if (method === 'POST' && route[1] === 'start') {
        const body = await request.json();
        const options = z
          .object({
            maxPages: z.number().int().min(0).max(10000).optional(),
            maxDepth: z.number().int().min(0).max(10).optional(),
            concurrency: z.number().int().min(1).max(6).optional(),
            timeoutMs: z.number().int().min(3000).max(120000).optional(),
          })
          .parse(body.options || {});
        const result = await enqueueScan(
          String(body.siteId),
          body.authProfileId || undefined,
          undefined,
          options,
        );
        return json(result, result.existing ? 200 : 201);
      }
      if (method === 'POST' && route[1] === 'rerun') {
        const prior = await db.collection<Scan>('scans').findOne({ _id: id(String(route[2] || '')) });
        if (!prior) return json({ error: 'Original scan not found' }, 404);
        if (['queued', 'running', 'paused'].includes(prior.status))
          return json({ error: 'Finish or cancel the active scan before rerunning it' }, 409);
        const body = z
          .object({
            options: z
              .object({
                maxPages: z.number().int().min(0).max(10000).optional(),
                maxDepth: z.number().int().min(0).max(10).optional(),
                concurrency: z.number().int().min(1).max(6).optional(),
                timeoutMs: z.number().int().min(3000).max(120000).optional(),
              })
              .optional(),
          })
          .parse(await request.json());
        const result = await enqueueScan(
          prior.siteId,
          prior.authProfileId,
          prior.urls,
          { ...(prior.options || {}), ...(body.options || {}) },
          prior.mode,
          prior._id!.toString(),
        );
        return json({ ...result, rerunOfScanId: prior._id!.toString() }, result.existing ? 200 : 201);
      }
      if (method === 'POST' && route[1] === 'retry-bulk') {
        const body = z
          .object({
            issueIds: z.array(z.string()).max(50).optional(),
            pageIds: z.array(z.string()).max(50).optional(),
            allEligible: z.boolean().optional(),
            siteId: z.string().optional(),
            scanId: z.string().optional(),
            cursor: z.string().optional(),
            batchId: z.string().optional(),
          })
          .refine(
            (v) => v.issueIds?.length || v.pageIds?.length || (v.allEligible && (v.siteId || v.scanId)),
            'Select findings or provide a website/scan scope',
          )
          .parse(await request.json());
        if (body.siteId) id(body.siteId);
        if (body.scanId) id(body.scanId);
        // Caller reuses this ID across paginated retry submissions. The original
        // scan records remain immutable and existing active jobs are deduplicated.
        const batchId = body.batchId ? id(body.batchId).toString() : new ObjectId().toString();
        const now = new Date();
        let outcomes: BatchAttempt[];
        if (body.pageIds?.length) {
          if (new Set(body.pageIds).size !== body.pageIds.length)
            return json({ error: 'Duplicate page selection' }, 400);
          const targets = await db
            .collection<PageResult>('pages')
            .find({
              _id: { $in: body.pageIds.map(id) },
              classification: 'failed',
              ...(body.siteId ? { siteId: body.siteId } : {}),
              ...(body.scanId ? { scanId: body.scanId } : {}),
            })
            .limit(50)
            .toArray();
          const lookup = new Map(targets.map((item) => [item._id!.toString(), item]));
          outcomes = [];
          for (const pageId of body.pageIds) {
            const target = lookup.get(pageId);
            const row: BatchAttempt = {
              batchId,
              source: 'page',
              sourceId: pageId,
              outcome: 'ineligible',
              createdAt: now,
            };
            if (!target)
              row.reason = 'Page does not exist, no longer failed, or outside the selected scan scope';
            else
              try {
                const queued = await enqueueScan(
                  target.siteId,
                  target.authProfileId,
                  [target.url],
                  undefined,
                  'retry',
                  undefined,
                  batchId,
                );
                row.scanId = queued.scanId;
                row.outcome = queued.existing ? 'reused' : 'queued';
                if (queued.existing) row.reason = 'Identical verification was already active';
              } catch (e) {
                row.outcome = 'failed';
                row.reason = e instanceof Error ? e.message : 'Cannot retry this page';
              }
            outcomes.push(row);
          }
        } else {
          const where: Filter<Issue> = { status: { $in: ['open', 'reopened'] } };
          if (body.siteId) where.siteId = body.siteId;
          if (body.scanId) where.scanId = body.scanId;
          if (body.allEligible) {
            if (body.cursor) where._id = { $gt: id(body.cursor) };
          } else {
            if (new Set(body.issueIds || []).size !== (body.issueIds || []).length)
              return json({ error: 'Duplicate finding selection' }, 400);
            where._id = { $in: (body.issueIds || []).map(id) };
          }
          const candidates = await db
            .collection<Issue>('issues')
            .find(where)
            .sort(body.allEligible ? { _id: 1 } : { lastDetectedAt: -1 })
            .limit(50)
            .toArray();
          const requested = body.allEligible
            ? candidates.map((item) => item._id!.toString())
            : body.issueIds || [];
          const lookup = new Map(candidates.map((item) => [item._id!.toString(), item]));
          outcomes = [];
          for (const issueId of requested) {
            const finding = lookup.get(issueId);
            const row: BatchAttempt = {
              batchId,
              source: 'issue',
              sourceId: issueId,
              outcome: 'ineligible',
              createdAt: now,
            };
            if (!finding)
              row.reason = 'Finding is resolved, under Manual Review, missing, or outside selection scope';
            else
              try {
                const queued = await enqueueScan(
                  finding.siteId,
                  finding.authProfileId,
                  [finding.url],
                  undefined,
                  'retry',
                  undefined,
                  batchId,
                );
                row.scanId = queued.scanId;
                row.outcome = queued.existing ? 'reused' : 'queued';
                if (queued.existing) row.reason = 'Identical verification was already active';
              } catch (e) {
                row.outcome = 'failed';
                row.reason = e instanceof Error ? e.message : 'Cannot retry this finding';
              }
            outcomes.push(row);
          }
        }
        const counts = countBatchAttempts(outcomes);
        let trackingWarning: string | undefined;
        try {
          await recordBatchAttempts(db, outcomes);
        } catch {
          trackingWarning =
            'Verification jobs were processed, but saving batch selection history failed. Check database connectivity.';
        }
        const allEligibleNext = body.allEligible && outcomes.length === 50;
        return json({
          batchId,
          selected: counts.selected,
          eligible: counts.selected - counts.ineligible,
          queued: counts.newJobs,
          alreadyActive: counts.reused,
          ineligible: counts.ineligible,
          failed: counts.failed,
          trackingWarning,
          nextCursor: allEligibleNext ? outcomes.at(-1)?.sourceId || null : null,
          results: outcomes.map(({ sourceId, outcome, scanId, reason }) => ({
            sourceId,
            outcome,
            scanId,
            reason,
          })),
        });
      }
      if (method === 'POST' && route[1] === 'retry') {
        const body = await request.json();
        const target = await db.collection<PageResult>('pages').findOne({ _id: id(String(body.pageId)) });
        if (!target) throw Error('Unknown page result');
        const result = await enqueueScan(target.siteId, target.authProfileId, [target.url]);
        return json(result, result.existing ? 200 : 201);
      }
      if (method === 'POST' && route[1] === 'action' && route[2]) {
        const body = await request.json();
        const action = String(body.action);
        if (!['cancel', 'pause', 'resume'].includes(action)) throw Error('Invalid action');
        const scanId = id(route[2]);
        const current = await db.collection<Scan>('scans').findOne({ _id: scanId });
        if (!current) return json({ error: 'Scan not found' }, 404);
        const allowed =
          action === 'resume'
            ? current.status === 'paused'
            : action === 'pause'
              ? current.status === 'running'
              : ['queued', 'running', 'paused'].includes(current.status);
        if (!allowed) return json({ error: `Cannot ${action} a ${current.status} scan` }, 409);
        let condition: Filter<Scan>, update: UpdateFilter<Scan>;
        if (action === 'cancel' && current.status === 'queued') {
          condition = { status: 'queued' };
          update = {
            $set: {
              status: 'cancelled',
              phase: 'cancelled',
              cancelRequested: true,
              endedAt: new Date(),
              lastActivityAt: new Date(),
            },
            $unset: { activeKey: '' },
          };
        } else if (action === 'cancel') {
          condition = { status: { $in: ['running', 'paused'] } };
          update = { $set: { cancelRequested: true, phase: 'cancelling' } };
        } else if (action === 'pause') {
          condition = { status: 'running' };
          update = { $set: { status: 'paused', phase: 'paused' } };
        } else {
          condition = { status: 'paused' };
          update = { $set: { status: 'running', phase: 'resuming' } };
        }
        const changed = await db.collection<Scan>('scans').updateOne({ _id: scanId, ...condition }, update);
        if (!changed.modifiedCount) return json({ error: 'Scan changed state; refresh and retry' }, 409);
        await recordScanEvent(
          route[2],
          current.siteId,
          action,
          `Scan ${action} ${action === 'cancel' && current.status !== 'queued' ? 'requested' : 'accepted'} by administrator.`,
        );
        return json({
          ok: true,
          status:
            action === 'cancel' && current.status === 'queued'
              ? 'cancelled'
              : action === 'cancel'
                ? 'cancelling'
                : action === 'pause'
                  ? 'paused'
                  : 'running',
        });
      }
    }
    if (endpoint === 'cleanup') {
      if (method === 'GET' && route[1] === 'preview') {
        const options = cleanupRequest(Object.fromEntries(request.nextUrl.searchParams.entries()));
        const [preview, token] = await Promise.all([
          previewCleanup(options),
          Promise.resolve(makeCleanupToken(options)),
        ]);
        return json({ ...preview, token });
      }
      if (method === 'POST' && route[1] === 'execute') {
        const body = z
          .object({ token: z.string().min(20), confirmation: z.literal('DELETE AUDITOR HISTORY') })
          .parse(await request.json());
        return json({ ok: true, ...(await performCleanup(body.token)) });
      }
    }
    if (endpoint === 'worker-service') {
      if (method === 'GET') {
        const type = request.nextUrl.searchParams.get('view') === 'logs' ? 'logs' : 'status';
        try {
          return json({ enabled: workerControlEnabled(), output: await workerService(type) });
        } catch (e) {
          return json({
            enabled: workerControlEnabled(),
            error: e instanceof Error ? e.message : 'Supervisor unavailable',
          });
        }
      }
      if (method === 'POST') {
        const body = z
          .object({
            action: z.enum(['start', 'stop', 'restart']),
            confirm: z.literal('WEBSITE AUDITOR WORKER'),
          })
          .parse(await request.json());
        if (!workerControlEnabled())
          return json(
            { error: 'Host worker control is disabled; read-only monitoring remains available' },
            403,
          );
        // Deliberately fixed service name and argv. No caller-controlled executable, flags or unit.
        return json({ ok: true, output: await workerService(body.action) });
      }
    }
    if (endpoint === 'workers' && method === 'GET') {
      const records = await db.collection('workers').find().sort({ heartbeatAt: -1 }).limit(20).toArray();
      const now = Date.now();
      return json(records.map((w) => ({ ...w, online: now - new Date(w.heartbeatAt).getTime() < 15000 })));
    }
    if (endpoint === 'events' && method === 'GET') {
      const scanId = request.nextUrl.searchParams.get('scanId');
      if (!scanId || !ObjectId.isValid(scanId)) return json({ error: 'Valid scanId required' }, 400);
      return json(
        (await db.collection('scan_events').find({ scanId }).sort({ at: -1 }).limit(120).toArray()).reverse(),
      );
    }
    if (endpoint === 'compare' && method === 'GET') {
      const pageId = request.nextUrl.searchParams.get('pageId');
      if (!pageId) throw Error('Missing pageId');
      const current = await db.collection<PageResult>('pages').findOne({ _id: id(pageId) });
      if (!current) throw Error('Page not found');
      const previous = await db.collection<PageResult>('pages').findOne(
        {
          siteId: current.siteId,
          authProfileId: current.authProfileId,
          url: current.url,
          capturedAt: { $lt: current.capturedAt },
        },
        { sort: { capturedAt: -1 } },
      );
      return json({ current, previous });
    }
    if (endpoint === 'pages' && method === 'GET') {
      if (route[1]) {
        const historical = await db.collection<PageResult>('pages').findOne({ _id: id(route[1]) });
        return historical ? json(historical) : json({ error: 'Historical page evidence not found' }, 404);
      }
      return json(
        await db.collection<PageResult>('pages').find().sort({ capturedAt: -1 }).limit(500).toArray(),
      );
    }
    if (endpoint === 'issues') {
      if (method === 'GET') {
        const q = request.nextUrl.searchParams;
        const siteId = q.get('siteId');
        const status = q.get('status');
        if (siteId) id(siteId);
        const filter: Filter<Issue> = issueListFilter(status, siteId);
        return json(
          await db
            .collection<Issue>('issues')
            .find(filter)
            .sort({ lastDetectedAt: -1 })
            .limit(2000)
            .toArray(),
        );
      }
      if (method === 'POST' && route[1] === 'review') {
        const body = z
          .object({
            issueIds: z.array(z.string()).min(1).max(50),
            decision: z.enum(
              reviewDecisions as [(typeof reviewDecisions)[number], ...(typeof reviewDecisions)[number][]],
            ),
            comment: z.string().max(2000).default(''),
          })
          .parse(await request.json());
        const results: Array<{ issueId: string; ok: boolean; error?: string }> = [];
        for (const issueId of [...new Set(body.issueIds)]) {
          try {
            const _id = id(issueId);
            const collection = db.collection<Issue>('issues');
            const finding = await collection.findOne({ _id });
            if (!finding) throw Error('Finding not found');
            const change = reviewTransition(finding, body.decision, body.comment);
            const event: ReviewEvent = {
              id: randomUUID(),
              at: new Date(),
              actor,
              decision: body.decision,
              from: finding.status,
              to: change.status,
              previousReviewState: finding.reviewState,
              reviewState: change.reviewState,
              comment: body.comment.trim(),
            };
            // Compare-and-swap prevents concurrent reviewers from overwriting a status transition.
            const updated = await collection.updateOne(
              {
                _id,
                status: finding.status,
                ...(finding.reviewVersion === undefined
                  ? { reviewVersion: { $exists: false } }
                  : { reviewVersion: finding.reviewVersion }),
              },
              {
                $set: { status: change.status, reviewState: change.reviewState },
                $inc: { reviewVersion: 1 },
                $push: { reviewHistory: event },
              },
            );
            if (!updated.modifiedCount) throw Error('Finding changed concurrently; refresh to review');
            results.push({ issueId, ok: true });
          } catch (e) {
            results.push({ issueId, ok: false, error: e instanceof Error ? e.message : 'Review failed' });
          }
        }
        return json({
          updated: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        });
      }
      if (method === 'PATCH' && route[1]) {
        // Backward-compatible interface; all mutations now require an auditable review event.
        const body = z
          .object({ status: z.enum(['manual_review', 'open']), comment: z.string().default('') })
          .parse(await request.json());
        const finding = await db.collection<Issue>('issues').findOne({ _id: id(route[1]) });
        if (!finding) return json({ error: 'Finding not found' }, 404);
        const decision = body.status === 'manual_review' ? 'submit' : 'return_active';
        const change = reviewTransition(finding, decision, body.comment);
        const event: ReviewEvent = {
          id: randomUUID(),
          at: new Date(),
          actor,
          decision,
          from: finding.status,
          to: change.status,
          previousReviewState: finding.reviewState,
          reviewState: change.reviewState,
          comment: body.comment.trim(),
        };
        const updated = await db.collection<Issue>('issues').updateOne(
          { _id: finding._id, status: finding.status },
          {
            $set: { status: change.status, reviewState: change.reviewState },
            $inc: { reviewVersion: 1 },
            $push: { reviewHistory: event },
          },
        );
        if (!updated.modifiedCount) return json({ error: 'Finding changed; refresh and retry' }, 409);
        return json({ ok: true });
      }
    }
    if (endpoint === 'investigate' && method === 'GET') {
      const pageId = request.nextUrl.searchParams.get('pageId');
      if (!pageId) throw Error('Missing pageId');
      const page = await db.collection<PageResult>('pages').findOne({ _id: id(pageId) });
      if (!page) throw Error('Page result not found');
      const site = await db.collection<Site>('sites').findOne({ _id: id(page.siteId) });
      if (!site) throw Error('Website not found');
      return json(await inspectSource(site, page));
    }
    if (endpoint === 'fixes' && method === 'POST' && route[1] === 'preview') {
      const body = z.object({ pageId: z.string(), patch: z.string().min(10) }).parse(await request.json());
      const page = await db.collection<PageResult>('pages').findOne({ _id: id(body.pageId) });
      if (!page) throw Error('Page result not found');
      const site = await db.collection<Site>('sites').findOne({ _id: id(page.siteId) });
      if (!site) throw Error('Website not found');
      const { paths } = await validatePatch(site, body.patch);
      const item = await db.collection('fix_proposals').insertOne({
        siteId: page.siteId,
        pageId: body.pageId,
        patch: body.patch,
        paths,
        status: 'proposed',
        createdAt: new Date(),
      });
      return json({ proposalId: item.insertedId, paths, patch: body.patch, requiresApproval: true }, 201);
    }
    if (endpoint === 'fixes' && method === 'POST' && route[1] === 'apply') {
      const body = z
        .object({ proposalId: z.string(), acknowledged: z.literal(true) })
        .parse(await request.json());
      const proposal = await db
        .collection('fix_proposals')
        .findOneAndUpdate(
          { _id: id(body.proposalId), status: 'proposed' },
          { $set: { status: 'applying', approvedAt: new Date() } },
          { returnDocument: 'after' },
        );
      if (!proposal) throw Error('Proposal missing or already processed');
      try {
        const site = await db.collection<Site>('sites').findOne({ _id: id(String(proposal.siteId)) });
        if (!site) throw Error('Website not found');
        const result = await applyApprovedPatch(site, String(proposal.patch), body.proposalId);
        await db
          .collection('fix_proposals')
          .updateOne(
            { _id: proposal._id },
            { $set: { status: 'applied', appliedAt: new Date(), backup: result.backup } },
          );
        return json({ ok: true, backup: result.backup, paths: result.paths, verifyWithRetry: true });
      } catch (e) {
        await db
          .collection('fix_proposals')
          .updateOne(
            { _id: proposal._id },
            { $set: { status: 'failed', error: e instanceof Error ? e.message : String(e) } },
          );
        throw e;
      }
    }
    if (endpoint === 'evidence' && method === 'GET') {
      const key = request.nextUrl.searchParams.get('key');
      if (!key) throw Error('Missing key');
      const evidence = await getEvidence(key);
      if (request.nextUrl.searchParams.get('format') === 'text') {
        if (!key.endsWith('.html')) throw Error('Only HTML can be viewed as text');
        return json({ html: evidence.bytes.toString('utf8') });
      }
      const download = request.nextUrl.searchParams.get('download') === '1';
      const headers = new Headers({
        'Content-Type': evidence.contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${
          key
            .split('/')
            .at(-1)
            ?.replace(/[^a-z0-9._-]/gi, '') || 'evidence'
        }"`,
      });
      return new Response(new Uint8Array(evidence.bytes), { headers });
    }
    if (endpoint === 'exports' && route[1] === 'diagnostics' && method === 'GET') {
      const q = request.nextUrl.searchParams;
      const siteId = q.get('siteId'),
        scanId = q.get('scanId');
      if (siteId) id(siteId);
      if (scanId) {
        const source = await db.collection<Scan>('scans').findOne({ _id: id(scanId) });
        if (!source || (siteId && source.siteId !== siteId))
          return json({ error: 'Invalid scan scope' }, 400);
      }
      const format =
        q.get('format') === 'xlsx'
          ? 'xlsx'
          : q.get('format') === 'html'
            ? 'html'
            : q.get('format') === 'csv'
              ? 'csv'
              : 'json';
      let filter: Filter<PageResult>;
      try {
        filter = reportPageFilter(q);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Invalid filters' }, 400);
      }
      const collection = db.collection<PageResult>('pages');
      const total = await collection.countDocuments(filter);
      if (total > 10000)
        return json({ error: 'Export exceeds 10,000 pages. Narrow the date or website filters.' }, 413);
      const records = await collection.find(filter).sort({ capturedAt: -1 }).limit(10000).toArray();
      return new Response(
        format === 'xlsx'
          ? new Uint8Array(buildDiagnosticWorkbook(records))
          : buildDiagnosticExport(records, format),
        {
          headers: {
            'Content-Type':
              format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : format === 'html'
                  ? 'text/html; charset=utf-8'
                  : format === 'csv'
                    ? 'text/csv; charset=utf-8'
                    : 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            'Content-Disposition': `attachment; filename="website-auditor-diagnostics.${format}"`,
          },
        },
      );
    }
    if (endpoint === 'exports' && route[1] === 'evidence-bundle' && method === 'GET') {
      const params = request.nextUrl.searchParams;
      const siteId = params.get('siteId');
      const scanId = params.get('scanId');
      if (siteId) id(siteId);
      if (scanId) id(scanId);
      const includeScreenshots = params.get('screenshots') === '1';
      if (params.get('screenshots') && !['0', '1'].includes(params.get('screenshots')!))
        return json({ error: 'Invalid screenshot option' }, 400);
      let filter: Filter<PageResult>;
      try {
        filter = reportPageFilter(params);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Invalid filters' }, 400);
      }
      const collection = db.collection<PageResult>('pages');
      const count = await collection.countDocuments(filter);
      if (!count) return json({ error: 'No matching saved page evidence to export' }, 404);
      if (count > 100)
        return json(
          { error: `Evidence bundle includes ${count} pages; narrow filters to 100 pages or fewer.` },
          413,
        );
      const items = await collection.find(filter).sort({ capturedAt: -1 }).limit(100).toArray();
      const archive = await buildEvidenceBundle(items, getEvidence, { includeScreenshots });
      return new Response(new Uint8Array(archive), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="website-auditor-evidence.zip"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (endpoint === 'exports' && route[1] === 'reviews' && method === 'GET') {
      const q = request.nextUrl.searchParams;
      const format =
        q.get('format') === 'xlsx'
          ? 'xlsx'
          : q.get('format') === 'html'
            ? 'html'
            : q.get('format') === 'csv'
              ? 'csv'
              : 'json';
      const filter: Filter<Issue> = {
        $or: [{ status: 'manual_review' }, { reviewHistory: { $exists: true } }],
      };
      const siteId = q.get('siteId');
      if (siteId) {
        id(siteId);
        filter.siteId = siteId;
      }
      const reviewCollection = db.collection<Issue>('issues');
      if ((await reviewCollection.countDocuments(filter)) > 10000)
        return json({ error: 'Export exceeds 10,000 findings. Narrow the website filters.' }, 413);
      const findings = await reviewCollection
        .find(filter)
        .sort({ lastDetectedAt: -1 })
        .limit(10000)
        .toArray();
      return new Response(
        format === 'xlsx'
          ? new Uint8Array(buildReviewWorkbook(findings))
          : buildReviewExport(findings, format),
        {
          headers: {
            'Content-Type':
              format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : format === 'html'
                  ? 'text/html; charset=utf-8'
                  : format === 'csv'
                    ? 'text/csv; charset=utf-8'
                    : 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            'Content-Disposition': `attachment; filename="website-auditor-manual-reviews.${format}"`,
          },
        },
      );
    }
    if (endpoint === 'exports' && route[1] === 'errors' && method === 'GET') {
      const q = request.nextUrl.searchParams;
      const siteId = q.get('siteId') || undefined;
      const scanId = q.get('scanId') || undefined;
      const format = q.get('format') === 'xlsx' ? 'xlsx' : q.get('format') === 'json' ? 'json' : 'csv';
      if (siteId) id(siteId);
      if (scanId) id(scanId);
      if (scanId) {
        const scan = await db.collection<Scan>('scans').findOne({ _id: id(scanId) });
        if (!scan || (siteId && scan.siteId !== siteId)) return json({ error: 'Invalid scan scope' }, 400);
      }
      let filter: Filter<PageResult>;
      const errorQuery = new URLSearchParams(q);
      errorQuery.set('result', 'failed');
      try {
        filter = reportPageFilter(errorQuery);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Invalid filters' }, 400);
      }
      const collection = db.collection<PageResult>('pages');
      const total = await collection.countDocuments(filter);
      if (total > (format === 'xlsx' ? 10000 : 20000))
        return json(
          {
            error: `Export exceeds ${format === 'xlsx' ? '10,000' : '20,000'} failed pages. Narrow your filters.`,
          },
          413,
        );
      const pages = await collection.find(filter).sort({ capturedAt: -1 }).limit(20000).toArray();
      const data =
        format === 'xlsx' ? new Uint8Array(buildDiagnosticWorkbook(pages)) : buildIssueExport(pages, format);
      return new Response(data, {
        headers: {
          'Content-Type':
            format === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : format === 'csv'
                ? 'text/csv; charset=utf-8'
                : 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `attachment; filename="website-auditor-errors.${format}"`,
        },
      });
    }
    if (endpoint === 'report' && method === 'GET' && route[1]) {
      const scan = await db.collection<Scan>('scans').findOne({ _id: id(route[1]) });
      if (!scan?.reportKeys) throw Error('Report not generated');
      const format = request.nextUrl.searchParams.get('format') || 'html';
      const key = scan.reportKeys[format];
      if (!key) throw Error('Unknown report format');
      const evidence = await getEvidence(key);
      return new Response(new Uint8Array(evidence.bytes), {
        headers: {
          'Content-Type': evidence.contentType,
          'Cache-Control': 'private, no-store',
          'Content-Security-Policy':
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
          'Content-Disposition': `attachment; filename="scan-${route[1]}.${format === 'html' ? 'html' : format === 'csv' ? 'csv' : 'json'}"`,
        },
      });
    }
    return json({ error: 'Endpoint not found' }, 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    return fail(e);
  }
}
export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, 'GET', (await context.params).path);
}
export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, 'POST', (await context.params).path);
}
export async function PATCH(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, 'PATCH', (await context.params).path);
}
export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(req, 'DELETE', (await context.params).path);
}
