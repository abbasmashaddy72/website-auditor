import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRouteTab, routeBaseFilter, routeTabFilter, routeOrder } from '../src/lib/routes-status';

test('route tabs accept exactly the defined result states', () => {
  for (const tab of ['all', 'successful', 'warnings', 'failed', 'resolved'])
    assert.equal(parseRouteTab(tab), tab);
  assert.equal(parseRouteTab(null), 'all');
  assert.throws(() => parseRouteTab('broken'));
});
test('same site/scan/profile scope applies to every route tab', () => {
  const params = new URLSearchParams({ siteId: 'site', scanId: 'scan', profile: 'profile', q: '(test)' });
  const base = routeBaseFilter(params);
  assert.equal(base.siteId, 'site');
  assert.equal(base.scanId, 'scan');
  assert.equal(base.authProfileId, 'profile');
  assert.equal(routeTabFilter(base, 'warnings').classification, 'warning');
  assert.equal(routeTabFilter(base, 'failed').classification, 'failed');
  assert.equal(routeTabFilter(base, 'successful').classification, 'passed');
  assert.equal(routeTabFilter(base, 'all').siteId, 'site');
  assert.match(JSON.stringify(base), /\\\\\(test\\\\\)/);
});
test('resolved routes have evidence IDs, not every successful HTTP 200', () => {
  const filter = routeTabFilter(routeBaseFilter(new URLSearchParams()), 'resolved', []);
  assert.deepEqual(filter._id, { $in: [] });
});
test('sort field is allowlisted', () => {
  assert.deepEqual(routeOrder(new URLSearchParams('sort=time&dir=asc')), {
    field: 'durationMs',
    direction: 1,
  });
  assert.throws(() => routeOrder(new URLSearchParams('sort=__proto__'))); // no prototype injection
});
