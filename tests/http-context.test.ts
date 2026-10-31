import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedAuthenticationChallenge } from '../src/lib/http-context';
import { classifyPageEvidence } from '../src/lib/page-classification';
import { findingSeverity } from '../src/lib/finding-severity';

test('Only evidence-backed anonymous challenges are warnings', () => {
  assert.equal(expectedAuthenticationChallenge(401, false, 'Basic realm="private"', ''), true);
  assert.equal(expectedAuthenticationChallenge(403, false, null, 'Please sign in to continue'), true);
  assert.equal(expectedAuthenticationChallenge(403, false, null, 'Forbidden'), false);
  assert.equal(expectedAuthenticationChallenge(401, true, 'Basic realm="private"', ''), false);
  assert.equal(expectedAuthenticationChallenge(404, false, null, 'Please sign in'), false);
});

test('HTTP 200 success/warnings/function errors, 4xx and 5xx remain distinct', () => {
  const status = (code: number, category = 'performance', expectedAuthentication = false) =>
    classifyPageEvidence({
      status: code,
      issues: [{ category, message: 'Slow page' }],
      warnings: [],
      expectedAuthentication,
    });
  assert.equal(classifyPageEvidence({ status: 200, issues: [], warnings: [] }), 'passed');
  assert.equal(status(200), 'warning');
  assert.equal(status(200, 'javascript'), 'failed');
  assert.equal(status(403), 'failed');
  assert.equal(status(404), 'failed');
  assert.equal(status(500), 'failed');
  assert.equal(
    classifyPageEvidence({
      status: 401,
      expectedAuthentication: true,
      issues: [{ category: 'authentication-expected', message: 'Main document HTTP 401' }],
      warnings: [],
    }),
    'warning',
  );
  assert.equal(
    findingSeverity({
      category: 'authentication-expected',
      latestHttpStatus: 401,
      message: 'Main document HTTP 401 (expected unauthenticated challenge)',
    }),
    'warning',
  );
  assert.equal(
    classifyPageEvidence({
      status: 401,
      expectedAuthentication: true,
      issues: [{ category: 'javascript', message: 'Uncaught TypeError' }],
      warnings: [],
    }),
    'failed',
  );
});
