import assert from 'node:assert/strict';
import test from 'node:test';
import { getPaginationRoute, discoverReadOnlyPagination } from '../src/lib/pagination-discovery';

test('Livewire pagination is represented as GET URLs without running component methods', () => {
  const url = 'https://tenant.example.test/policies';
  assert.equal(getPaginationRoute(url, "gotoPage(2, 'tablePage')"), `${url}?tablePage=2`);
  assert.equal(getPaginationRoute(url, "nextPage('page')"), `${url}?page=2`);
  assert.equal(getPaginationRoute(`${url}?page=2`, 'nextPage()'), `${url}?page=3`);
  assert.equal(getPaginationRoute(url, 'gotoPage(100)'), null);
  assert.equal(getPaginationRoute(url, 'deleteRecord(2)'), null);
  assert.equal(getPaginationRoute(url, 'gotoPage(2); save()'), null);
});

test('UI sampling extracts supported pagination only, without clicking buttons', async () => {
  let clicked = 0;
  const page = {
    url: () => 'https://tenant.example.test/policies',
    locator: () => ({
      evaluateAll: async () => ["gotoPage(2, 'tablePage')", "gotoPage(2, 'tablePage')", 'deleteRecord(42)'],
      click: async () => {
        clicked++;
      },
    }),
  };
  assert.deepEqual(await discoverReadOnlyPagination(page as never), [
    'https://tenant.example.test/policies?tablePage=2',
  ]);
  assert.equal(clicked, 0);
});
