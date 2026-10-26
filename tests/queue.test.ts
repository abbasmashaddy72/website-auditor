import test from 'node:test';
import assert from 'node:assert/strict';
import { scanKey } from '../src/lib/queue';
import { parseAllowedHosts, isSafeLink } from '../src/lib/scope';

test('duplicate scan keys are independent of option ordering', () => {
  const a = scanKey('id', 'profile', undefined, { maxPages: 0, concurrency: 2 });
  const b = scanKey('id', 'profile', undefined, { concurrency: 2, maxPages: 0 });
  assert.equal(a, b);
  assert.notEqual(a, scanKey('id', 'different-profile', undefined, { maxPages: 0, concurrency: 2 }));
  assert.notEqual(a, scanKey('id', 'profile', undefined, { maxPages: 500, concurrency: 2 }));
  assert.notEqual(a, scanKey('id', 'profile', ['https://example.com/a'], { maxPages: 0, concurrency: 2 }));
});
test('explicit extra URL scopes extract host and HTTP port', () => {
  assert.deepEqual(
    parseAllowedHosts([
      'https://central.insure360.test/login',
      'http://localhost:5173/dashboard',
      'broker.insure360.test',
    ]),
    {
      hosts: ['central.insure360.test', 'localhost', 'broker.insure360.test'],
      ports: [443, 5173],
    },
  );
});
test('unsafe GET navigation is identified (logout and destructive URLs)', () => {
  assert.equal(isSafeLink('https://broker.insure360.test/logout'), false);
  assert.equal(isSafeLink('https://broker.insure360.test/delete?id=1'), false);
  assert.equal(isSafeLink('https://broker.insure360.test/dashboard'), true);
});
