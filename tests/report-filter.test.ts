import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPageFilter, distinctHttpStatuses } from '../src/lib/report-filter';

test('aggregate reports require no scan or website selection', () => {
  assert.deepEqual(reportPageFilter(new URLSearchParams()), {});
  assert.deepEqual(reportPageFilter(new URLSearchParams('result=failed&http=500')), {
    classification: 'failed',
    status: 500,
  });
});

test('website, scan, search and UTC date filters combine without dropping scope', () => {
  const params = new URLSearchParams({
    siteId: 'site',
    scanId: 'scan',
    result: 'warning',
    from: '2026-10-01',
    to: '2026-10-27',
    q: 'admin.*',
  });
  const filter = reportPageFilter(params);
  assert.equal(filter.siteId, 'site');
  assert.equal(filter.scanId, 'scan');
  assert.equal(filter.classification, 'warning');
  assert.deepEqual(filter.capturedAt, {
    $gte: new Date('2026-10-01T00:00:00.000Z'),
    $lt: new Date('2026-10-28T00:00:00.000Z'),
  });
  assert.deepEqual(filter.$or, [
    { url: { $regex: 'admin\\.\\*', $options: 'i' } },
    { title: { $regex: 'admin\\.\\*', $options: 'i' } },
  ]);
});

test('existing scan-results URLs still force their original scan', () => {
  assert.equal(reportPageFilter(new URLSearchParams('scanId=other'), 'original').scanId, 'original');
});

test('distinct HTTP codes are numeric, deduplicated and ascending', () => {
  assert.deepEqual(
    distinctHttpStatuses([500, 200, 404, 200, 301, 500, null, '200', undefined, 999]),
    [200, 301, 404, 500],
  );
});

test('invalid HTTP or reversed/invalid dates are rejected rather than silently ignored', () => {
  for (const query of ['http=20', 'http=abc', 'from=2026-02-30', 'from=2026-10-28&to=2026-10-27']) {
    assert.throws(() => reportPageFilter(new URLSearchParams(query)));
  }
});
