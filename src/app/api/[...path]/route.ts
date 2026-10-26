import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import type { Filter, UpdateFilter } from 'mongodb';
import { z } from 'zod';
import { database } from '@/lib/db';
import { normalizeUrl, effectivePort, assertTargetAllowed, parseAllowedHosts } from '@/lib/scope';
import { encrypt } from '@/lib/crypto';
import { inspectSource, validatePatch, applyApprovedPatch } from '@/lib/fixes';
import { assertApiAccess, setLoginCookie, clearLoginCookie, verifyPassword } from '@/lib/auth';
import { enqueueScan } from '@/lib/queue';
import { recordScanEvent } from '@/lib/telemetry';
import { getEvidence, deleteScanEvidence } from '@/lib/storage';
import { buildIssueExport } from '@/lib/error-export';
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
    const db = await database();
    if (method === 'GET' && endpoint === 'summary') {
      const [sites, scans, issues, recent] = await Promise.all([
        db.collection('sites').countDocuments(),
        db.collection('scans').countDocuments(),
        db.collection('issues').countDocuments({ status: { $in: ['open', 'reopened'] } }),
        db.collection<Scan>('scans').find().sort({ createdAt: -1 }).limit(7).toArray(),
      ]);
      return json({ sites, scans, issues, recent });
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
          .find(siteId ? { siteId } : {}, { projection: { encryptedPassword: 0 } })
          .toArray();
        return json(items);
      }
      if (method === 'POST') {
        const fields = z
          .object({
            siteId: z.string(),
            name: z.string().min(1),
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
        const { password, ...safe } = fields;
        const item: AuthProfile = {
          ...safe,
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
        if (!current) throw Error('Authentication profile not found');
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
        const { password, ...safe } = fields;
        const update = {
          ...safe,
          loginUrl: normalizeUrl(fields.loginUrl),
          startUrl: fields.startUrl?.trim() ? normalizeUrl(fields.startUrl) : undefined,
          successUrl: fields.successUrl?.trim() ? normalizeUrl(fields.successUrl) : undefined,
          ...(password?.length ? { encryptedPassword: encrypt(password) } : {}),
        };
        await db.collection<AuthProfile>('profiles').updateOne({ _id: current._id }, { $set: update });
        return json({ ok: true });
      }
    }
    if (endpoint === 'scans') {
      if (method === 'GET') {
        if (route[1] === 'pages' && route[2]) {
          const query = request.nextUrl.searchParams;
          if (query.get('paged') !== '1')
            return json(
              await db
                .collection<PageResult>('pages')
                .find({ scanId: route[2] })
                .sort({ capturedAt: -1 })
                .limit(2000)
                .toArray(),
            );
          const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 30) || 30));
          const page = Math.max(0, Math.min(10000, Number(query.get('page') || 0) || 0));
          const classification = query.get('result');
          const http = query.get('http');
          const raw = (query.get('q') || '').trim().slice(0, 160);
          const filter: Filter<PageResult> = { scanId: route[2] };
          if (classification && ['passed', 'warning', 'failed'].includes(classification))
            filter.classification = classification as PageResult['classification'];
          if (http && /^\d{3}$/.test(http)) filter.status = Number(http);
          if (raw)
            filter.$or = [
              { url: { $regex: raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
              { title: { $regex: raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            ];
          const [items, total] = await Promise.all([
            db
              .collection<PageResult>('pages')
              .find(filter)
              .sort({ capturedAt: -1 })
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
      return json(
        await db.collection<PageResult>('pages').find().sort({ capturedAt: -1 }).limit(500).toArray(),
      );
    }
    if (endpoint === 'issues') {
      if (method === 'GET')
        return json(
          await db.collection<Issue>('issues').find().sort({ lastDetectedAt: -1 }).limit(500).toArray(),
        );
      if (method === 'PATCH' && route[1]) {
        const body = await request.json();
        if (body.status !== 'manual_review' && body.status !== 'open') throw Error('Invalid manual status');
        await db
          .collection<Issue>('issues')
          .updateOne({ _id: id(route[1]) }, { $set: { status: body.status } });
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
    if (endpoint === 'exports' && route[1] === 'errors' && method === 'GET') {
      const q = request.nextUrl.searchParams;
      const siteId = q.get('siteId') || undefined;
      const scanId = q.get('scanId') || undefined;
      const format = q.get('format') === 'json' ? 'json' : 'csv';
      if (siteId) id(siteId);
      if (scanId) id(scanId);
      if (!siteId && !scanId) return json({ error: 'Choose a website or scan for bulk error export' }, 400);
      if (scanId) {
        const scan = await db.collection<Scan>('scans').findOne({ _id: id(scanId) });
        if (!scan || (siteId && scan.siteId !== siteId)) return json({ error: 'Invalid scan scope' }, 400);
      }
      const filter: Filter<PageResult> = { classification: 'failed' };
      if (siteId) filter.siteId = siteId;
      if (scanId) filter.scanId = scanId;
      const pages = await db
        .collection<PageResult>('pages')
        .find(filter)
        .sort({ capturedAt: -1 })
        .limit(20000)
        .toArray();
      const data = buildIssueExport(pages, format);
      return new Response(data, {
        headers: {
          'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
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
