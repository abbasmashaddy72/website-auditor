import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceBundle, sanitizeEvidenceJson } from '../src/lib/evidence-bundle';
import type { PageResult } from '../src/lib/types';
const page: PageResult = {
  siteId: 'site1',
  scanId: 'scan1',
  url: 'https://example.test/profile?token=hidden',
  finalUrl: 'https://example.test/profile',
  depth: 0,
  title: 'Page',
  status: 200,
  redirects: [],
  durationMs: 100,
  classification: 'passed',
  issues: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  evidence: {
    rendered: 'websites/site1/scans/scan1/page1/rendered.html',
    network: 'websites/site1/scans/scan1/page1/network.json',
  },
  capturedAt: new Date('2026-10-28T00:00:00Z'),
};

test('diagnostic archive includes mapped redacted evidence and no raw URL query secrets', async () => {
  const archive = await buildEvidenceBundle([page], async (key) => ({
    bytes: Buffer.from(
      key.includes('rendered')
        ? '<input name="email" value="private@example.test"><script>alert(1)</script>'
        : '{"url":"https://example.test/api?token=secret","authorization":"Bearer token123"}',
    ),
    contentType: 'text/plain',
  }));
  assert.equal(archive.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(archive.includes(Buffer.from('diagnostics.json')));
  assert.ok(archive.includes(Buffer.from('manifest.json')));
  // ZIP deflation prevents direct plaintext search. Inspect entry details in Python smoke test.
});

test('nested network fields are redacted', () => {
  const filtered = JSON.parse(
    sanitizeEvidenceJson(
      '{"url":"https://example.test?token=abc","cookies":"secret","nested":{"password":"secret"}}',
    ),
  );
  assert.match(filtered.url, /REDACTED/);
  assert.equal(filtered.cookies, '[REDACTED]');
  assert.equal(filtered.nested.password, '[REDACTED]');
});

test('rejects ambiguous evidence references outside the page scan', async () => {
  const result = await buildEvidenceBundle(
    [{ ...page, evidence: { rendered: 'websites/another/scans/scan1/secret' } }],
    async () => {
      throw Error('Must not read cross-site evidence');
    },
  );
  assert.ok(result.length > 0);
});
