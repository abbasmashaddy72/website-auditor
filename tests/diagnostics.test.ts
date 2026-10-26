import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyBrowserDiagnostics } from '../src/lib/diagnostics';

test('Inspector noise is not an actionable runtime failure', () => {
  const result = classifyBrowserDiagnostics(
    ['Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'],
    [{ url: 'https://insure360.test/inspector', method: 'GET', failure: 'net::ERR_BLOCKED_BY_CLIENT' }],
    new Set(['https://insure360.test/inspector']),
  );
  assert.equal(result.ignoredConsole.length, 1);
  assert.equal(result.actionableConsole.length, 0);
  assert.equal(result.policyBlocked.length, 1);
  assert.equal(result.actionableRequests.length, 0);
});

test('real JavaScript and network failures remain actionable', () => {
  const result = classifyBrowserDiagnostics(
    ['Uncaught Error: client render failed'],
    [{ url: 'https://insure360.test/_next/app.js', method: 'GET', status: 500 }],
  );
  assert.equal(result.actionableConsole.length, 1);
  assert.equal(result.actionableRequests.length, 1);
});

test('unattributed blocked script remains actionable, not silently ignored', () => {
  const result = classifyBrowserDiagnostics(
    [],
    [{ url: 'https://insure360.test/assets/app.js', method: 'GET', failure: 'net::ERR_BLOCKED_BY_CLIENT' }],
  );
  assert.equal(result.actionableRequests.length, 1);
  assert.equal(result.policyBlocked.length, 0);
});

test('Bunny Fonts Inspector interception does not invalidate a successful document', () => {
  const result = classifyBrowserDiagnostics(
    ['Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'],
    [
      {
        url: 'https://fonts.bunny.net/css?family=inter:400,700&display=swap',
        method: 'GET',
        failure: 'net::ERR_BLOCKED_BY_CLIENT.Inspector',
      },
    ],
  );
  assert.equal(result.ignoredConsole.length, 1);
  assert.equal(result.policyBlocked.length, 1);
  assert.equal(result.actionableRequests.length, 0);
});
