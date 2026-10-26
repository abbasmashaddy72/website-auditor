import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAuthenticatedSeed, looksLikeUnauthenticatedPage } from '../src/lib/auth-discovery';

test('authenticated scans start at post-login landing rather than public root', () => {
  assert.equal(
    chooseAuthenticatedSeed(undefined, 'https://insure360.test/cadmin', 'https://insure360.test/'),
    'https://insure360.test/cadmin',
  );
  assert.equal(
    chooseAuthenticatedSeed(
      'https://broker.insure360.test/dashboard',
      'https://insure360.test/cadmin',
      'https://insure360.test/',
    ),
    'https://broker.insure360.test/dashboard',
  );
});
test('authenticated seed rejects unconfirmed public root landing', () => {
  assert.throws(
    () => chooseAuthenticatedSeed(undefined, 'https://insure360.test/', 'https://insure360.test/'),
    /explicit authenticated start URL/,
  );
});
test('login redirects are failures even when HTTP 200 is returned', () => {
  assert.equal(
    looksLikeUnauthenticatedPage(
      'https://insure360.test/cadmin/login',
      'https://insure360.test/cadmin/login',
      true,
      'https://insure360.test/cadmin',
    ),
    true,
  );
  assert.equal(
    looksLikeUnauthenticatedPage(
      'https://insure360.test/cadmin',
      'https://insure360.test/cadmin/login',
      false,
      'https://insure360.test/cadmin',
    ),
    false,
  );
  assert.equal(
    looksLikeUnauthenticatedPage(
      'https://insure360.test/cadmin/login',
      'https://insure360.test/cadmin/login',
      false,
      'https://insure360.test/cadmin/login',
    ),
    false,
  );
});

test('authenticated discovery stays inside Filament panel instead of visiting public website', async () => {
  const { isAuthenticatedDiscoveryCandidate: candidate } = await import('../src/lib/auth-discovery');
  const seed = 'https://insure360.test/cadmin';
  const login = 'https://insure360.test/cadmin/login';
  const base = 'https://insure360.test/';
  assert.equal(candidate('https://insure360.test/cadmin/users', seed, login, base), true);
  assert.equal(candidate('https://insure360.test/cadmin', seed, login, base), true);
  assert.equal(candidate('https://insure360.test/', seed, login, base), false);
  assert.equal(candidate('https://insure360.test/cadmin/login', seed, login, base), false);
  assert.equal(candidate('https://insure360.test/about', seed, login, base), false);
  assert.equal(candidate('https://other.test/cadmin/users', seed, login, base), false);
});
