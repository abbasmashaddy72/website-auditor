import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjectId } from 'mongodb';
import { activeFindingsForVerification, canVerifyResolution, verifiedSnapshot } from '../src/lib/resolution';
import type { PageResult } from '../src/lib/types';

const page: PageResult = {
  _id: { toString: () => 'new-verified-page' } as ObjectId,
  scanId: 'new-verification-scan',
  siteId: 'target',
  authProfileId: 'root',
  url: 'https://example.test/protected',
  finalUrl: 'https://example.test/protected',
  depth: 0,
  status: 200,
  redirects: [],
  title: 'Protected',
  durationMs: 300,
  classification: 'passed',
  issues: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  evidence: { screenshot: 'private-object-key' },
  capturedAt: new Date('2026-10-27T10:00:00.000Z'),
};

test('only independently passed pages with actual success response can resolve findings', () => {
  assert.equal(canVerifyResolution(page), true);
  for (const variation of [
    { classification: 'warning' as const },
    { classification: 'failed' as const },
    { issues: [{ category: 'javascript', message: 'Unexpected failure' }] },
    { warnings: ['Unverified content warning'] },
    { status: 500 },
    { status: 302 },
    { _id: undefined },
  ]) {
    assert.equal(canVerifyResolution({ ...page, ...variation }), false);
  }
});

test('verification reference points to a new successful page without replacing original failures', () => {
  const resolution = verifiedSnapshot(page);
  assert.deepEqual(resolution, {
    at: page.capturedAt,
    scanId: page.scanId,
    pageId: page._id!.toString(),
    httpStatus: 200,
  });
  assert.equal(Object.hasOwn(resolution, 'evidence'), false);
  assert.throws(() => verifiedSnapshot({ ...page, classification: 'warning' }));
});

test('verified retry matches only active, same-profile findings, never newer failures', () => {
  const filter = activeFindingsForVerification(page);
  assert.equal(filter.siteId, 'target');
  assert.equal(filter.authProfileId, 'root');
  assert.equal(filter.url, page.url);
  assert.deepEqual(filter.status, { $in: ['open', 'reopened'] });
  assert.deepEqual(filter.lastDetectedAt, { $lte: page.capturedAt });
  assert.throws(() => activeFindingsForVerification({ ...page, classification: 'warning' }));
});

test('legacy unauthenticated findings remain eligible, but profiles cannot mix', () => {
  const filter = activeFindingsForVerification({ ...page, authProfileId: undefined });
  assert.equal('authProfileId' in filter, false);
  assert.equal(filter.$or?.length, 3);
});
