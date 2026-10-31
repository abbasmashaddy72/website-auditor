import assert from 'node:assert/strict';
import test from 'node:test';
import {
  safeActionLabel,
  safeDiscoveredUrl,
  uniqueDiscoveredUrls,
  discoverActionMenus,
} from '../src/lib/action-discovery';

test('Filament row edit/view and GET pagination are eligible', () => {
  const base = 'https://tenant.example.test/insure360/policies';
  assert.equal(safeDiscoveredUrl('/insure360/policies/42/edit', base), `${base}/42/edit`);
  assert.equal(safeDiscoveredUrl('/insure360/policies/42', base), `${base}/42`);
  assert.equal(safeDiscoveredUrl('?tablePage=2', base), `${base}?tablePage=2`);
});

test('mutation URLs and non-page URLs are never added', () => {
  const base = 'https://tenant.example.test/';
  for (const raw of [
    '/policies/42/delete',
    '/checkout',
    '/pay/9',
    '/logout',
    '/policies?action=force-delete',
    '/policies?operation=approve',
    '/download.pdf',
    'javascript:alert(1)',
  ]) {
    assert.equal(safeDiscoveredUrl(raw, base), null, raw);
  }
  assert.equal(safeActionLabel('Delete'), false);
  assert.equal(safeActionLabel('Force Delete'), false);
  assert.equal(safeActionLabel('Payment submission'), false);
  assert.equal(safeActionLabel('Edit Policy'), true);
  assert.deepEqual(uniqueDiscoveredUrls(['/policies/42/edit', '/policies/42/edit', '/logout'], base), [
    `${base}policies/42/edit`,
  ]);
});

test('bounded menu inspection captures newly revealed links without invoking actions', async () => {
  let clicked = 0;
  let visible = false;
  const base = 'https://tenant.example.test/';
  const trigger = {
    isVisible: async () => true,
    getAttribute: async () => 'Actions',
    innerText: async () => 'Actions',
    click: async () => {
      clicked++;
      visible = true;
    },
  };
  const locator = (selector: string) => {
    if (selector.startsWith('[role="menu"] [aria-haspopup')) return { count: async () => 0 };
    if (selector.includes('aria-haspopup="menu"')) return { count: async () => 1, nth: () => trigger };
    if (selector === 'a[href]')
      return {
        evaluateAll: async () =>
          visible
            ? [
                { href: `${base}policies/42/edit`, text: 'Edit Policy' },
                { href: `${base}policies/42/delete`, text: 'Delete Policy' },
              ]
            : [],
      };
    return {
      evaluateAll: async () => [
        { label: 'View Policy', popup: 'dialog', wire: true },
        { label: 'Delete Policy', popup: '', wire: true },
      ],
    };
  };
  const page = {
    locator,
    url: () => base,
    keyboard: {
      press: async () => {
        visible = false;
      },
    },
  };
  const result = await discoverActionMenus(page as never, []);
  assert.equal(clicked, 1);
  assert.deepEqual(result.links, [`${base}policies/42/edit`]);
  assert.deepEqual(result.interactions, [{ label: 'View Policy', kind: 'modal', executed: false }]);
});
