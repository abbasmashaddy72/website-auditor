import { createHash } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { decrypt, encrypt } from './crypto';
import { normalizeUrl } from './scope';
import { profileNameKey } from './profile-name';
import {
  backupEnvelopeSchema,
  backupFingerprint,
  buildImportPlan,
  confirmImportPreview,
  importStrategySchema,
  openConfig,
  profileForBackup,
  sealConfig,
  signImportPreview,
  siteForBackup,
  type ExistingConfig,
  type ImportEntry,
  type PortableBackup,
} from './config-backup';
import type { AuthProfile, Scan, Site } from './types';

const exportRequest = z.strictObject({
  siteIds: z
    .array(z.string().regex(/^[a-f\d]{24}$/i))
    .max(50)
    .optional(),
  password: z.string().min(12).max(1024),
});
const importRequest = z.strictObject({
  envelope: backupEnvelopeSchema,
  password: z.string().min(12).max(1024),
  strategy: importStrategySchema,
  authorizationConfirmed: z.literal(true),
  previewToken: z.string().max(500).optional(),
});

/** Do not send decrypted values, Zod input or low-level crypto stacks to the browser. */
export function safeConfigBackupError(error: unknown): { code: string; error: string } {
  if (error instanceof z.ZodError) {
    const fields = [
      ...new Set(
        error.issues
          .map((issue) =>
            issue.path.map((part) => (typeof part === 'number' ? '[item]' : String(part))).join('.'),
          )
          .filter(Boolean),
      ),
    ].slice(0, 4);
    return {
      code: 'BACKUP_SCHEMA',
      error: `Backup has missing or invalid configuration fields: ${fields.join(', ') || 'schema'}. Confirm it was exported by Website Auditor and has not been modified.`,
    };
  }
  const message = error instanceof Error ? error.message : '';
  if (/incorrect backup password|invalid encrypted backup/i.test(message))
    return {
      code: 'BACKUP_DECRYPT',
      error:
        'Backup password is incorrect or the encrypted file has been modified. Use the original export password and file.',
    };
  if (/unsupported|unknown configuration action/i.test(message))
    return {
      code: 'BACKUP_VERSION',
      error: 'Unsupported backup format or version. Use a supported Website Auditor encrypted JSON export.',
    };
  if (
    /duplicate website|duplicate profile|outside the website-approved scope|host.*scope.*inconsistent|production cannot/i.test(
      message,
    )
  )
    return {
      code: 'BACKUP_CONFLICT',
      error:
        'Backup configuration contains duplicate or out-of-scope website/profile settings. Validate the source website scope before exporting again.',
    };
  if (/AUTH_ENCRYPTION_KEY|SESSION_SECRET/.test(message))
    return {
      code: 'BACKUP_SERVER_CONFIG',
      error:
        'Website Auditor server credential encryption/session configuration is missing or incompatible. Check the locally configured encryption keys; do not reset historical credentials.',
    };
  if (/unable to authenticate data|invalid initialization vector|Invalid encrypted/.test(message))
    return {
      code: 'BACKUP_STORED_CREDENTIAL',
      error:
        'A stored profile credential cannot be decrypted using this installation key. Confirm AUTH_ENCRYPTION_KEY matches the original encryption key before exporting.',
    };
  if (error instanceof SyntaxError)
    return {
      code: 'BACKUP_JSON',
      error: 'Backup JSON is malformed or truncated. Select the original exported file.',
    };
  if (/password must contain/i.test(message))
    return { code: 'BACKUP_PASSWORD', error: 'Backup password must be between 12 and 1024 characters.' };
  return {
    code: 'BACKUP_INVALID',
    error:
      'Backup could not be processed. Check the exported file, password, selected import strategy and server configuration; the existing records were not reset.',
  };
}

const reply = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

async function existingConfig(db: Db): Promise<ExistingConfig> {
  const [sites, profiles] = await Promise.all([
    db
      .collection<Site>('sites')
      .find({}, { projection: { baseUrl: 1 } })
      .toArray(),
    db
      .collection<AuthProfile>('profiles')
      .find({}, { projection: { siteId: 1, name: 1 } })
      .toArray(),
  ]);
  return {
    sites: sites.map((s) => ({ id: String(s._id), baseUrl: s.baseUrl })),
    profiles: profiles.map((p) => ({ id: String(p._id), siteId: p.siteId, name: p.name })),
  };
}
async function readyImport(db: Db, body: z.infer<typeof importRequest>) {
  const backup = await openConfig(body.envelope, body.password);
  const plan = buildImportPlan(backup, await existingConfig(db), body.strategy);
  return { backup, plan, fingerprint: backupFingerprint(body.envelope, body.strategy, plan) };
}
function previewSummary(plan: ImportEntry[]) {
  return {
    websites: plan.map(({ name, baseUrl, action, profiles }) => ({
      name,
      baseUrl,
      action,
      profiles: profiles.map((profile) => ({ name: profile.name, action: profile.action })),
    })),
    summary: {
      websitesCreate: plan.filter((entry) => entry.action === 'create').length,
      websitesUpdate: plan.filter((entry) => entry.action === 'update').length,
      websitesSkip: plan.filter((entry) => entry.action === 'skip').length,
      profilesCreate: plan.flatMap((entry) => entry.profiles).filter((profile) => profile.action === 'create')
        .length,
      profilesUpdate: plan.flatMap((entry) => entry.profiles).filter((profile) => profile.action === 'update')
        .length,
      conflicts:
        plan.filter((entry) => entry.action === 'conflict').length +
        plan.flatMap((entry) => entry.profiles).filter((profile) => profile.action === 'conflict').length,
    },
  };
}

/** Called ONLY after assertApiAccess has authorized the same-origin POST. */
export async function configBackupApi(db: Db, request: NextRequest, action: string): Promise<NextResponse> {
  try {
    if (action === 'export') {
      const body = exportRequest.parse(await request.json());
      const requested = body.siteIds ? [...new Set(body.siteIds)] : undefined;
      const filter = requested ? { _id: { $in: requested.map((id) => new ObjectId(id)) } } : {};
      const sites = await db
        .collection<Site>('sites')
        .find(filter)
        .sort({ createdAt: 1 })
        .limit(51)
        .toArray();
      if (!sites.length || sites.length > 50 || (requested && sites.length !== requested.length))
        return reply({ error: 'Select 1–50 valid websites for export' }, 400);
      const ids = sites.map((site) => String(site._id));
      const profiles = await db
        .collection<AuthProfile>('profiles')
        .find({ siteId: { $in: ids } })
        .toArray();
      const config: PortableBackup = {
        schema: 'website-auditor-config',
        version: 1,
        exportedAt: new Date().toISOString(),
        websites: sites.map((site) => ({ site: siteForBackup(site), profiles: [] })),
      };
      for (let n = 0; n < sites.length; n++) {
        const siteProfiles = profiles.filter((profile) => profile.siteId === ids[n]);
        if (siteProfiles.length > 100)
          return reply({ error: 'Too many profiles in one website backup' }, 400);
        config.websites[n].profiles = siteProfiles.map((profile) =>
          profileForBackup(profile, decrypt(profile.encryptedPassword)),
        );
      }
      const envelope = await sealConfig(config, body.password);
      // No credential or username escapes the encrypted envelope.
      return new NextResponse(JSON.stringify(envelope), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="website-auditor-config-encrypted.json"',
          'Cache-Control': 'no-store, private',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (action !== 'preview' && action !== 'apply')
      return reply({ error: 'Unknown configuration action' }, 404);
    // Reject oversized JSON before decryption or import planning.
    const raw = await request.text();
    if (raw.length > 3_000_000) return reply({ error: 'Configuration backup exceeds upload limit' }, 413);
    const body = importRequest.parse(JSON.parse(raw));
    const { backup, plan, fingerprint } = await readyImport(db, body);
    const preview = previewSummary(plan);
    if (action === 'preview')
      return reply({ ...preview, expiresInSeconds: 300, previewToken: signImportPreview(fingerprint) });
    if (!body.previewToken || !confirmImportPreview(body.previewToken, fingerprint))
      return reply({ error: 'Import preview expired or configuration changed; preview again' }, 409);
    if (preview.summary.conflicts)
      return reply({ error: 'Import conflicts must be resolved before applying', ...preview }, 409);

    // Configuration changes must not race with in-flight scans on those websites.
    const updatingSites = plan
      .filter((entry) => entry.action === 'update')
      .map((entry) => entry.existingSiteId!);
    if (updatingSites.length) {
      const runningSiteScans = await db.collection<Scan>('scans').countDocuments({
        siteId: { $in: updatingSites },
        status: { $in: ['queued', 'running', 'paused'] },
      });
      if (runningSiteScans)
        return reply(
          {
            error:
              'An existing website has active scans; finish or cancel them before updating configuration',
          },
          409,
        );
    }
    const touchedProfiles = plan
      .flatMap((entry) => entry.profiles)
      .filter((p) => p.action === 'update')
      .map((p) => p.existingProfileId);
    if (touchedProfiles.length) {
      const running = await db.collection<Scan>('scans').countDocuments({
        authProfileId: { $in: touchedProfiles as string[] },
        status: { $in: ['queued', 'running', 'paused'] },
      });
      if (running)
        return reply({ error: 'Active scans use one or more profiles; cancel or finish them first' }, 409);
    }
    const tokenId = createHash('sha256').update(body.previewToken).digest('hex');
    try {
      await db
        .collection<{
          _id: string;
          startedAt: Date;
          state: string;
          endedAt?: Date;
          outcome?: Record<string, number>;
        }>('config_import_jobs')
        .insertOne({ _id: tokenId, startedAt: new Date(), state: 'running' });
    } catch {
      return reply({ error: 'This import confirmation was already used; preview again' }, 409);
    }
    const outcome = {
      websitesCreated: 0,
      websitesUpdated: 0,
      websitesSkipped: 0,
      profilesCreated: 0,
      profilesUpdated: 0,
      profilesSkipped: 0,
    };
    try {
      for (let index = 0; index < plan.length; index++) {
        const p = plan[index],
          entry = backup.websites[index];
        let siteId = p.existingSiteId;
        if (p.action === 'skip') {
          outcome.websitesSkipped++;
          outcome.profilesSkipped += p.profiles.length;
          continue;
        }
        if (p.action === 'create') {
          const now = new Date();
          const site: Site = {
            ...entry.site,
            baseUrl: normalizeUrl(entry.site.baseUrl),
            authProfileIds: [],
            createdAt: now,
            updatedAt: now,
            nextAutoScanAt: entry.site.scheduleMinutes
              ? new Date(Date.now() + entry.site.scheduleMinutes * 60000)
              : undefined,
          };
          const inserted = await db.collection<Site>('sites').insertOne(site);
          siteId = inserted.insertedId.toString();
          outcome.websitesCreated++;
        } else {
          const now = new Date();
          const updated = await db.collection<Site>('sites').updateOne(
            { _id: new ObjectId(siteId!) },
            {
              $set: {
                ...entry.site,
                baseUrl: normalizeUrl(entry.site.baseUrl),
                updatedAt: now,
                ...(entry.site.scheduleMinutes
                  ? { nextAutoScanAt: new Date(Date.now() + entry.site.scheduleMinutes * 60000) }
                  : {}),
              },
              ...(!entry.site.scheduleMinutes ? { $unset: { nextAutoScanAt: '' } } : {}),
            },
          );
          if (!updated.matchedCount) throw Error('Website changed during import');
          outcome.websitesUpdated++;
        }
        for (let j = 0; j < p.profiles.length; j++) {
          const planned = p.profiles[j],
            cfg = entry.profiles[j];
          if (planned.action === 'skip') {
            outcome.profilesSkipped++;
            continue;
          }
          const {
            password,
            authenticationMethod: _authenticationMethod,
            archived: _archived,
            ...profileSettings
          } = cfg;
          void _authenticationMethod;
          void _archived;
          const details = {
            ...profileSettings,
            loginUrl: normalizeUrl(cfg.loginUrl),
            startUrl: cfg.startUrl ? normalizeUrl(cfg.startUrl) : undefined,
            successUrl: cfg.successUrl ? normalizeUrl(cfg.successUrl) : undefined,
            username: cfg.username,
            encryptedPassword: encrypt(password),
          };
          if (planned.action === 'create') {
            const archivedAt = cfg.archived ? new Date() : undefined;
            const profile: AuthProfile = {
              ...details,
              siteId: siteId!,
              createdAt: new Date(),
              ...(archivedAt ? { archivedAt } : { profileNameKey: profileNameKey(cfg.name) }),
            };
            const added = await db.collection<AuthProfile>('profiles').insertOne(profile);
            await db
              .collection('sites')
              .updateOne(
                { _id: new ObjectId(siteId!) },
                { $addToSet: { authProfileIds: added.insertedId.toString() } },
              );
            outcome.profilesCreated++;
          } else {
            // Do not rewrite the existing ID, associated scans, or archived state.
            const changed = await db
              .collection<AuthProfile>('profiles')
              .updateOne({ _id: new ObjectId(planned.existingProfileId) }, { $set: details });
            if (!changed.matchedCount) throw Error('Profile changed during import');
            outcome.profilesUpdated++;
          }
        }
      }
      await db
        .collection<{ _id: string; state: string; endedAt?: Date; outcome?: Record<string, number> }>(
          'config_import_jobs',
        )
        .updateOne({ _id: tokenId }, { $set: { state: 'completed', endedAt: new Date(), outcome } });
      return reply({ ok: true, outcome, note: 'Scan history and evidence were not modified' });
    } catch {
      await db
        .collection<{ _id: string; state: string; endedAt?: Date; outcome?: Record<string, number> }>(
          'config_import_jobs',
        )
        .updateOne({ _id: tokenId }, { $set: { state: 'partial', endedAt: new Date(), outcome } });
      return reply(
        {
          error:
            'Import interrupted. Some configuration changes may have applied. Preview again to reconcile; scan history remains untouched.',
          outcome,
        },
        500,
      );
    }
  } catch (caught) {
    // Safe error categories guide remediation without revealing decrypted login settings.
    return reply(safeConfigBackupError(caught), 400);
  }
}
