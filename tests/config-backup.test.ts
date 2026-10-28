import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  backupEnvelopeSchema,
  backupFingerprint,
  buildImportPlan,
  confirmImportPreview,
  openConfig,
  sealConfig,
  signImportPreview,
  validatePortableConfig,
  profileForBackup,
  siteForBackup,
  type PortableBackup,
} from '../src/lib/config-backup';
import type { AuthProfile, Site } from '../src/lib/types';

const password = 'long-backup-password-not-stored';
function fixture(): PortableBackup {
  return {
    schema: 'website-auditor-config',
    version: 1,
    exportedAt: new Date('2026-10-27T00:00:00Z').toISOString(),
    websites: [
      {
        site: siteForBackup({
          name: 'Broker',
          baseUrl: 'https://broker.example.test/',
          environment: 'local',
          allowedHosts: ['broker.example.test'],
          allowedPorts: [443],
          allowPrivateNetwork: false,
          allowLocalhost: true,
          ignoreHTTPSErrors: false,
          maxPages: 40,
          maxDepth: 4,
          concurrency: 1,
          timeoutMs: 30000,
          authProfileIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        } satisfies Site),
        profiles: [
          profileForBackup(
            {
              siteId: 'sample',
              name: 'Broker Admin',
              loginUrl: 'https://broker.example.test/login',
              startUrl: 'https://broker.example.test/dashboard',
              username: 'user@example.test',
              encryptedPassword: 'encrypted-in-db',
              createdAt: new Date(),
              submitSelector: 'button[type=submit]',
              successSelector: 'nav',
            } satisfies AuthProfile,
            'CorrectHorseBatteryStaple!',
          ),
        ],
      },
    ],
  };
}

test('encrypted JSON contains no plain username, password, site or profile names', async () => {
  const envelope = await sealConfig(fixture(), password);
  const text = JSON.stringify(envelope);
  for (const sensitive of [
    'user@example.test',
    'CorrectHorseBatteryStaple!',
    'broker.example.test',
    'Broker Admin',
  ]) {
    assert.equal(text.includes(sensitive), false);
  }
  assert.deepEqual(backupEnvelopeSchema.parse(envelope), envelope);
  const recovered = await openConfig(envelope, password);
  // JSON cannot encode undefined properties. Preserve every defined field and
  // verify that encrypted credentials are recovered exactly.
  assert.deepEqual(recovered, JSON.parse(JSON.stringify(fixture())));
  assert.equal(recovered.websites[0].profiles[0].username, 'user@example.test');
  assert.equal(recovered.websites[0].profiles[0].password, 'CorrectHorseBatteryStaple!');
  assert.equal(recovered.websites[0].profiles[0].authenticationMethod, 'password');
});

test('encrypted backup rejects wrong password and ciphertext tampering', async () => {
  const envelope = await sealConfig(fixture(), password);
  await assert.rejects(openConfig(envelope, 'invalid-password-for-backup'));
  const original = envelope.cipher.data;
  const modified = {
    ...envelope,
    cipher: { ...envelope.cipher, data: (original[0] === 'A' ? 'B' : 'A') + original.slice(1) },
  };
  await assert.rejects(openConfig(modified, password));
});

test('create, update and skip plans preserve existing associations', () => {
  const payload = fixture();
  const existing = {
    sites: [{ id: 'existing-site', baseUrl: 'https://broker.example.test/' }],
    profiles: [{ id: 'existing-profile', siteId: 'existing-site', name: 'broker ADMIN' }],
  };
  const create = buildImportPlan(payload, existing, 'create');
  assert.equal(create[0].action, 'conflict');
  const update = buildImportPlan(payload, existing, 'update');
  assert.equal(update[0].existingSiteId, 'existing-site');
  assert.equal(update[0].profiles[0].existingProfileId, 'existing-profile');
  assert.equal(update[0].profiles[0].action, 'update');
  assert.equal(buildImportPlan(payload, existing, 'skip')[0].profiles[0].action, 'skip');
  const fresh = buildImportPlan(payload, { sites: [], profiles: [] }, 'skip');
  assert.equal(fresh[0].action, 'create');
  assert.equal(fresh[0].profiles[0].action, 'create');
});

test('signed preview expires and binds encrypted file and import strategy', async () => {
  process.env.SESSION_SECRET = 'dedicated-session-secret-for-import-tests-only-32-characters';
  const envelope = await sealConfig(fixture(), password);
  const plan = buildImportPlan(fixture(), { sites: [], profiles: [] }, 'create');
  const fingerprint = backupFingerprint(envelope, 'create', plan);
  const now = Date.now();
  const token = signImportPreview(fingerprint, now);
  assert.equal(confirmImportPreview(token, fingerprint, now), true);
  assert.equal(confirmImportPreview(token, fingerprint + 'x', now), false);
  assert.equal(confirmImportPreview(token, fingerprint, now + 5 * 60_000 + 1), false);
  assert.equal(confirmImportPreview(token.slice(0, -1) + 'x', fingerprint, now), false);
});

test('backup refuses duplicate websites, duplicated profiles, and out-of-scope login URL', () => {
  const payload = fixture();
  assert.throws(() =>
    validatePortableConfig({ ...payload, websites: [payload.websites[0], payload.websites[0]] }),
  );
  assert.throws(() =>
    validatePortableConfig({
      ...payload,
      websites: [
        {
          ...payload.websites[0],
          profiles: [payload.websites[0].profiles[0], payload.websites[0].profiles[0]],
        },
      ],
    }),
  );
  assert.throws(() =>
    validatePortableConfig({
      ...payload,
      websites: [
        {
          ...payload.websites[0],
          profiles: [{ ...payload.websites[0].profiles[0], loginUrl: 'https://not-approved.test/login' }],
        },
      ],
    }),
  );
});

test('legacy nullable optional profile URLs and selectors do not prevent encrypted export', async () => {
  const base = fixture();
  const legacyProfile = base.websites[0].profiles[0];
  const legacySite = base.websites[0].site;
  const normalized = profileForBackup(
    {
      ...legacyProfile,
      siteId: 'sample',
      encryptedPassword: 'encrypted-in-db',
      createdAt: new Date(),
      startUrl: null,
      successUrl: null,
      usernameSelector: '',
      passwordSelector: null,
      submitSelector: null,
      successSelector: null,
    } as unknown as AuthProfile,
    'CorrectHorseBatteryStaple!',
  );
  const site = siteForBackup({
    ...legacySite,
    authProfileIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    framework: null,
    sourcePath: '',
    scheduleMinutes: null,
  } as unknown as Site);
  assert.equal(normalized.successUrl, undefined);
  assert.equal(normalized.passwordSelector, undefined);
  assert.equal(site.framework, undefined);
  const envelope = await sealConfig({ ...base, websites: [{ site, profiles: [normalized] }] }, password);
  const restored = await openConfig(envelope, password);
  assert.equal(restored.websites[0].profiles[0].password, 'CorrectHorseBatteryStaple!');
  assert.equal(restored.websites[0].profiles[0].successUrl, undefined);
});
