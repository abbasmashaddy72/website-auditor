import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analytics, average } from '../src/lib/analytics';
test('analytics uses measured timing and ignores absent data', () => {
  assert.equal(average([]), undefined);
  const now = new Date('2026-10-27T18:00:00Z');
  const pages = [
    {
      siteId: 'a',
      capturedAt: '2026-10-27T10:00:00Z',
      classification: 'passed',
      durationMs: 5000,
      performance: { loadEventMs: 600, navigation: { ttfbMs: 100 } },
    },
    { siteId: 'a', capturedAt: '2026-10-27T12:00:00Z', classification: 'warning', durationMs: 3000 },
  ];
  const result = analytics(pages, [], now, 7);
  assert.equal(result.avgBrowserLoadMs, 600);
  assert.equal(result.avgTtfbMs, 100);
  assert.equal(result.browserLoadSamples, 1);
  assert.equal(result.avgExecutionMs, undefined);
  assert.equal(result.buckets.at(-1)?.warnings, 1);
});
