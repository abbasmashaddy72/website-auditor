import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanupCutoff, cleanupRequest, makeCleanupToken, validateCleanupToken } from '../src/lib/cleanup';

test('cleanup requires explicit retention and permitted mode', () => {
  assert.throws(() => cleanupRequest({ mode: 'all', days: 1 }));
  assert.throws(() => cleanupRequest({ mode: 'scans', days: 0 }));
  assert.equal(cleanupCutoff(2, 3 * 86400000).toISOString(), '1970-01-02T00:00:00.000Z');
});

test('cleanup requires intact, short-lived signed preview token', () => {
  const old = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'this-is-a-test-only-secret-which-has-at-least-32-chars';
  try {
    const token = makeCleanupToken({ mode: 'scans', days: 30 }, Date.UTC(2026, 9, 25));
    assert.equal(validateCleanupToken(token, Date.UTC(2026, 9, 25)).mode, 'scans');
    assert.throws(() => validateCleanupToken(token + 'tampered', Date.UTC(2026, 9, 25)));
    assert.throws(() => validateCleanupToken(token, Date.UTC(2026, 9, 26)));
  } finally {
    if (old === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = old;
  }
});
