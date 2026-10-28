import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiagnosticExport } from '../src/lib/diagnostic-export';
import type { PageResult } from '../src/lib/types';
test('export includes performance, timestamps and error detail but not private object keys', () => {
  const page = {
    siteId: 'abc',
    scanId: '123',
    url: 'https://site.test/a?secret=private',
    finalUrl: 'https://site.test/a',
    title: 'Dashboard',
    classification: 'warning',
    status: 200,
    capturedAt: new Date(),
    durationMs: 120,
    issues: [{ category: 'network', message: 'Unexpected failure' }],
    warnings: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    performance: { domContentLoadedMs: 100 },
    evidence: { screenshot: 'private/secret/key.png' },
  } as unknown as PageResult;
  for (const format of ['csv', 'json', 'html'] as const) {
    const body = buildDiagnosticExport([page], format);
    assert.match(body, /Unexpected failure/);
    assert.match(body, /screenshot/);
    assert.doesNotMatch(body, /private\/secret\/key/);
    assert.doesNotMatch(body, /secret=private/);
  }
});

test('diagnostic exports redact sensitive values in nested resource waterfall URLs', () => {
  const page = {
    siteId: 'site',
    scanId: 'scan',
    url: 'https://site.test/dashboard',
    finalUrl: 'https://site.test/dashboard',
    title: 'Dashboard',
    classification: 'warning',
    status: 200,
    capturedAt: new Date(),
    durationMs: 10,
    issues: [],
    warnings: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    evidence: {},
    performance: {
      resources: [
        {
          url: 'https://site.test/livewire/update?token=very-sensitive-token&mode=read',
          method: 'POST',
          type: 'fetch',
          durationMs: 200,
          failure: 'Authorization: super-secret-value',
        },
      ],
    },
  } as unknown as PageResult;
  for (const format of ['csv', 'json', 'html'] as const) {
    const result = buildDiagnosticExport([page], format);
    assert.doesNotMatch(result, /very-sensitive-token/);
    assert.doesNotMatch(result, /super-secret-value/);
    assert.match(result, /REDACTED/);
    assert.match(result, /mode=read/);
  }
});
