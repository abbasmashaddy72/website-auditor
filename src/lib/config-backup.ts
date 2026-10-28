/** Portable, wholly encrypted website and login profile configuration backups.
 * No profile credential or username is present outside the authenticated ciphertext.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { effectivePort, normalizeUrl, parseAllowedHosts } from './scope';
import { profileNameKey } from './profile-name';
import type { AuthProfile, Site } from './types';

const AAD = Buffer.from('website-auditor:portable-config:v1');
const maxPlainBytes = 2_000_000;
const encParams = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const byteString = z
  .string()
  .max(3_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const backupEnvelopeSchema = z.strictObject({
  format: z.literal('website-auditor-config-backup'),
  version: z.literal(1),
  kdf: z.strictObject({
    algorithm: z.literal('scrypt'),
    salt: byteString,
    N: z.literal(32768),
    r: z.literal(8),
    p: z.literal(1),
  }),
  cipher: z.strictObject({
    algorithm: z.literal('aes-256-gcm'),
    iv: byteString,
    tag: byteString,
    data: byteString,
  }),
});
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
const boundedText = z.string().max(500);
export const importedSiteSchema = z.strictObject({
  name: z.string().min(1).max(100),
  baseUrl: boundedText,
  environment: z.enum(['local', 'staging', 'production']),
  framework: z.string().max(80).optional(),
  sourcePath: boundedText.optional(),
  allowedHosts: z.array(z.string().max(255)).max(50),
  allowedPorts: z.array(z.number().int().min(1).max(65535)).max(30),
  allowPrivateNetwork: z.boolean(),
  allowLocalhost: z.boolean(),
  ignoreHTTPSErrors: z.boolean(),
  maxPages: z.number().int().min(0).max(10000),
  discoveryMode: z.enum(['navigation', 'all-links']).optional(),
  maxDepth: z.number().int().min(0).max(10),
  concurrency: z.number().int().min(1).max(6),
  timeoutMs: z.number().int().min(3000).max(120000),
  captureTraces: z.boolean().optional(),
  captureHealthy: z.boolean().optional(),
  allowPassiveLivewire: z.boolean().optional(),
  allowLivewireBackground: z.boolean().optional(),
  scheduleMinutes: z.number().int().min(0).max(10080).optional(),
});
const importedProfileSchema = z.strictObject({
  name: z.string().min(1).max(100),
  loginUrl: boundedText,
  startUrl: boundedText.optional(),
  username: z.string().min(1).max(500),
  password: z.string().max(5000),
  authenticationMethod: z.literal('password'),
  usernameSelector: boundedText.optional(),
  passwordSelector: boundedText.optional(),
  submitSelector: boundedText.optional(),
  successSelector: boundedText.optional(),
  successUrl: boundedText.optional(),
  archived: z.boolean().optional(),
});
export const portableBackupSchema = z.strictObject({
  schema: z.literal('website-auditor-config'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  websites: z
    .array(z.strictObject({ site: importedSiteSchema, profiles: z.array(importedProfileSchema).max(100) }))
    .min(1)
    .max(50),
});
export type PortableBackup = z.infer<typeof portableBackupSchema>;
export type ImportStrategy = 'create' | 'update' | 'skip';
export const importStrategySchema = z.enum(['create', 'update', 'skip']);
export type ExistingConfig = {
  sites: Array<{ id: string; baseUrl: string }>;
  profiles: Array<{ siteId: string; name: string; id: string }>;
};
export type ImportEntry = {
  name: string;
  baseUrl: string;
  existingSiteId?: string;
  action: 'create' | 'update' | 'skip' | 'conflict';
  profiles: Array<{
    name: string;
    action: 'create' | 'update' | 'skip' | 'conflict';
    existingProfileId?: string;
  }>;
};

export function validatePortableConfig(input: unknown): PortableBackup {
  const config = portableBackupSchema.parse(input);
  const seenSites = new Set<string>();
  for (const entry of config.websites) {
    const site = entry.site;
    const normalized = normalizeUrl(site.baseUrl);
    if (seenSites.has(normalized)) throw Error('Backup contains duplicate website URLs');
    seenSites.add(normalized);
    const base = new URL(normalized);
    const scope = parseAllowedHosts(site.allowedHosts);
    if (!site.allowedHosts.includes(base.hostname) || !site.allowedPorts.includes(effectivePort(base)))
      throw Error('Backup site host or port scope is inconsistent');
    if (scope.hosts.some((host) => !site.allowedHosts.includes(host)))
      throw Error('Backup host scope is inconsistent');
    if (
      site.environment === 'production' &&
      (site.ignoreHTTPSErrors || site.allowPassiveLivewire || site.allowLivewireBackground)
    )
      throw Error('Production cannot disable TLS or enable Livewire compatibility');
    const names = new Set<string>();
    for (const profile of entry.profiles) {
      const key = profileNameKey(profile.name);
      if (names.has(key)) throw Error('Backup contains duplicate profile names');
      names.add(key);
      for (const value of [profile.loginUrl, profile.startUrl, profile.successUrl]) {
        if (!value) continue;
        const url = new URL(normalizeUrl(value));
        if (!site.allowedHosts.includes(url.hostname) || !site.allowedPorts.includes(effectivePort(url)))
          throw Error('Backup login URL is outside the website-approved scope');
      }
    }
  }
  return config;
}
/** Old database entries may contain null/blank optional fields. Omit them from
 * portable JSON instead of treating missing optional configuration as invalid.
 * Required fields and the approved hostname/port boundary stay strictly validated.
 */
export function portableOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function portableOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
function portableOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function siteForBackup(site: Site): PortableBackup['websites'][number]['site'] {
  // Legacy installations may not have the optional scope/settings fields. Derive only
  // the site's already registered base hostname, never grant extra external hosts.
  const normalized = normalizeUrl(site.baseUrl);
  const origin = new URL(normalized);
  const hosts = [...new Set([origin.hostname, ...(site.allowedHosts || [])])];
  const ports = [...new Set([effectivePort(origin), ...(site.allowedPorts || [])])];
  return importedSiteSchema.parse({
    name: site.name,
    baseUrl: normalized,
    environment: site.environment || 'local',
    framework: portableOptionalText(site.framework),
    sourcePath: portableOptionalText(site.sourcePath),
    allowedHosts: hosts,
    allowedPorts: ports,
    allowLocalhost: site.allowLocalhost ?? false,
    allowPrivateNetwork: site.allowPrivateNetwork ?? false,
    ignoreHTTPSErrors: site.ignoreHTTPSErrors ?? false,
    maxPages: site.maxPages ?? 0,
    discoveryMode:
      site.discoveryMode === 'navigation' || site.discoveryMode === 'all-links'
        ? site.discoveryMode
        : undefined,
    maxDepth: site.maxDepth ?? 3,
    concurrency: site.concurrency ?? 1,
    timeoutMs: site.timeoutMs ?? 30000,
    captureTraces: portableOptionalBoolean(site.captureTraces),
    captureHealthy: portableOptionalBoolean(site.captureHealthy),
    allowPassiveLivewire: portableOptionalBoolean(site.allowPassiveLivewire),
    allowLivewireBackground: portableOptionalBoolean(site.allowLivewireBackground),
    scheduleMinutes: portableOptionalNumber(site.scheduleMinutes),
  });
}
export function profileForBackup(
  profile: AuthProfile,
  password: string,
): PortableBackup['websites'][number]['profiles'][number] {
  return importedProfileSchema.parse({
    name: profile.name,
    loginUrl: profile.loginUrl,
    startUrl: portableOptionalText(profile.startUrl),
    username: profile.username,
    password,
    authenticationMethod: 'password',
    usernameSelector: portableOptionalText(profile.usernameSelector),
    passwordSelector: portableOptionalText(profile.passwordSelector),
    submitSelector: portableOptionalText(profile.submitSelector),
    successSelector: portableOptionalText(profile.successSelector),
    successUrl: portableOptionalText(profile.successUrl),
    archived: Boolean(profile.archivedAt),
  });
}
function encoded(bytes: Buffer): string {
  return bytes.toString('base64');
}
function decoded(text: string, length?: number): Buffer {
  const value = Buffer.from(text, 'base64');
  if (encoded(value) !== text || (length !== undefined && value.length !== length))
    throw Error('Invalid encrypted backup encoding');
  return value;
}
async function passkey(password: string, salt: Buffer): Promise<Buffer> {
  if (password.length < 12 || password.length > 1024)
    throw Error('Backup password must contain 12–1024 characters');
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 32, encParams, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
export async function sealConfig(payload: PortableBackup, password: string): Promise<BackupEnvelope> {
  const validated = validatePortableConfig(payload);
  const plaintext = Buffer.from(JSON.stringify(validated), 'utf8');
  if (plaintext.byteLength > maxPlainBytes) throw Error('Configuration exceeds the 2 MB limit');
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = await passkey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  key.fill(0);
  plaintext.fill(0);
  return {
    format: 'website-auditor-config-backup',
    version: 1,
    kdf: { algorithm: 'scrypt', salt: encoded(salt), N: encParams.N, r: encParams.r, p: encParams.p },
    cipher: {
      algorithm: 'aes-256-gcm',
      iv: encoded(iv),
      tag: encoded(cipher.getAuthTag()),
      data: encoded(data),
    },
  };
}
export async function openConfig(envelope: unknown, password: string): Promise<PortableBackup> {
  const parsed = backupEnvelopeSchema.parse(envelope);
  const salt = decoded(parsed.kdf.salt, 16),
    iv = decoded(parsed.cipher.iv, 12);
  const tag = decoded(parsed.cipher.tag, 16),
    data = decoded(parsed.cipher.data);
  if (data.length > maxPlainBytes) throw Error('Encrypted backup exceeds size limit');
  const key = await passkey(password, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    try {
      return validatePortableConfig(JSON.parse(plaintext.toString('utf8')));
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw Error('Incorrect backup password or invalid encrypted backup');
  } finally {
    key.fill(0);
  }
}
export function buildImportPlan(
  payload: PortableBackup,
  existing: ExistingConfig,
  strategy: ImportStrategy,
): ImportEntry[] {
  const map = new Map(existing.sites.map((s) => [normalizeUrl(s.baseUrl), s.id]));
  return payload.websites.map(({ site, profiles }) => {
    const url = normalizeUrl(site.baseUrl),
      existingSiteId = map.get(url);
    const action = existingSiteId ? (strategy === 'create' ? 'conflict' : strategy) : 'create';
    const profileIndex = new Map(
      existing.profiles.filter((p) => p.siteId === existingSiteId).map((p) => [profileNameKey(p.name), p.id]),
    );
    return {
      name: site.name,
      baseUrl: url,
      existingSiteId,
      action,
      profiles: profiles.map((profile) => {
        const existingProfileId = profileIndex.get(profileNameKey(profile.name));
        return {
          name: profile.name,
          existingProfileId,
          action:
            action === 'skip'
              ? 'skip'
              : action === 'conflict'
                ? 'conflict'
                : existingProfileId
                  ? strategy === 'update'
                    ? 'update'
                    : strategy === 'skip'
                      ? 'skip'
                      : 'conflict'
                  : 'create',
        };
      }),
    };
  });
}
export function backupFingerprint(
  envelope: BackupEnvelope,
  strategy: ImportStrategy,
  plan: ImportEntry[],
): string {
  return createHash('sha256').update(JSON.stringify({ envelope, strategy, plan })).digest('hex');
}
function hmac(value: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw Error('SESSION_SECRET is not configured');
  return createHmac('sha256', secret).update(value).digest();
}
export function signImportPreview(fingerprint: string, now = Date.now()): string {
  const payload = `${now + 5 * 60_000}.${randomBytes(12).toString('hex')}.${fingerprint}`;
  return `${payload}.${hmac(payload).toString('base64url')}`;
}
export function confirmImportPreview(token: string, fingerprint: string, now = Date.now()): boolean {
  const pieces = token.split('.');
  if (
    pieces.length !== 4 ||
    !/^\d+$/.test(pieces[0]) ||
    Number(pieces[0]) < now ||
    Number(pieces[0]) > now + 5 * 60_000 ||
    pieces[2] !== fingerprint
  )
    return false;
  const payload = pieces.slice(0, 3).join('.');
  const signature = Buffer.from(pieces[3], 'base64url'),
    expected = hmac(payload);
  return signature.length === expected.length && timingSafeEqual(signature, expected);
}
