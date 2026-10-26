import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resourceFromPlaywright, slowestResources } from '../src/lib/performance';

test('calculate request phases from Playwright timing and rank slow requests', () => {
  const a = resourceFromPlaywright({
    url: 'https://example.com/app.js',
    method: 'GET',
    type: 'script',
    status: 200,
    timing: {
      domainLookupStart: 0,
      domainLookupEnd: 10,
      connectStart: 10,
      connectEnd: 40,
      secureConnectionStart: 20,
      requestStart: 43,
      responseStart: 130,
      responseEnd: 260,
    },
  });
  const b = resourceFromPlaywright({
    url: 'https://example.com/css',
    method: 'GET',
    type: 'stylesheet',
    status: 200,
    timing: {
      domainLookupStart: -1,
      domainLookupEnd: -1,
      connectStart: -1,
      connectEnd: -1,
      secureConnectionStart: -1,
      requestStart: 2,
      responseStart: 5,
      responseEnd: 20,
    },
  });
  assert.equal(a.durationMs, 260);
  assert.equal(a.dnsMs, 10);
  assert.equal(a.ttfbMs, 87);
  assert.equal(a.downloadMs, 130);
  assert.equal(a.tlsMs, 20);
  assert.equal(b.dnsMs, undefined);
  assert.deepEqual(
    slowestResources([b, a], 1).map((r) => r.type),
    ['script'],
  );
});
