import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isApprovedLoginMutation,
  isLivewireUpdateEndpoint,
  isReadOnlyLivewireHydration,
  isPassiveLivewireUpdate,
} from '../src/lib/request-policy';
const login = 'https://insure360.test/cadmin/login';

test('hashed and conventional Livewire endpoints are recognized', () => {
  assert.equal(isLivewireUpdateEndpoint('https://insure360.test/livewire-84119ac4/update'), true);
  assert.equal(isLivewireUpdateEndpoint('https://insure360.test/livewire/update'), true);
  assert.equal(isLivewireUpdateEndpoint('https://insure360.test/livewire/message/login'), true);
  assert.equal(isLivewireUpdateEndpoint('https://insure360.test/other/update'), false);
});

test('login may post to approved form action or first-party Livewire endpoint only', () => {
  const actions = new Set(['https://insure360.test/session/authenticate']);
  assert.equal(
    isApprovedLoginMutation('https://insure360.test/livewire-84119ac4/update', login, actions),
    true,
  );
  assert.equal(isApprovedLoginMutation('https://insure360.test/session/authenticate', login, actions), true);
  assert.equal(isApprovedLoginMutation('https://other.test/livewire/update', login, actions), false);
  assert.equal(isApprovedLoginMutation('https://insure360.test/delete-all', login, actions), false);
});

test('background Livewire posts are permitted only when provably read-only', () => {
  const update = 'https://insure360.test/livewire-84119ac4/update';
  const safe = JSON.stringify({ components: [{ snapshot: '{}', calls: [], updates: {} }] });
  assert.equal(isReadOnlyLivewireHydration(update, 'POST', safe), true);
  assert.equal(
    isReadOnlyLivewireHydration(
      update,
      'POST',
      JSON.stringify({ components: [{ calls: [{ method: '__lazyLoad' }], updates: {} }] }),
    ),
    true,
  );
  assert.equal(
    isReadOnlyLivewireHydration(
      update,
      'POST',
      JSON.stringify({ components: [{ calls: [{ method: 'delete' }], updates: {} }] }),
    ),
    false,
  );
  assert.equal(
    isReadOnlyLivewireHydration(
      update,
      'POST',
      JSON.stringify({ components: [{ calls: [], updates: { name: 'changed' } }] }),
    ),
    false,
  );
  assert.equal(isReadOnlyLivewireHydration(update, 'POST', 'not-json'), false);
  assert.equal(isReadOnlyLivewireHydration('https://insure360.test/admin/destroy', 'POST', safe), false);
});

test('passive Livewire compatibility requires same-origin and forbids obvious mutations', () => {
  const url = 'https://insure360.test/livewire-84119ac4/update';
  const page = 'https://insure360.test/cadmin';
  const safe = JSON.stringify({ components: [{ calls: [{ method: 'loadDashboard' }], updates: {} }] });
  assert.equal(isPassiveLivewireUpdate(url, page, 'POST', safe), true);
  assert.equal(isPassiveLivewireUpdate(url, 'https://broker.insure360.test/dashboard', 'POST', safe), false);
  assert.equal(isPassiveLivewireUpdate(url, page, 'GET', safe), false);
  assert.equal(
    isPassiveLivewireUpdate(
      url,
      page,
      'POST',
      JSON.stringify({ components: [{ calls: [{ method: 'deleteTenant' }], updates: {} }] }),
    ),
    false,
  );
  assert.equal(
    isPassiveLivewireUpdate(
      url,
      page,
      'POST',
      JSON.stringify({ components: [{ calls: [], updates: { enabled: false } }] }),
    ),
    false,
  );
  assert.equal(isPassiveLivewireUpdate(url, page, 'POST', 'not-json'), false);
});

test('browser-faithful opt-in only permits same-origin browser Livewire component transport', async () => {
  const { isBrowserFaithfulLivewireRequest } = await import('../src/lib/request-policy');
  const url = 'https://insure360.test/livewire-84119ac4/update';
  const body = JSON.stringify({
    components: [{ calls: [{ method: 'refreshUi' }], updates: { search: 'abc' } }],
  });
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin/theme', 'POST', body, false),
    true,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://other.test/cadmin', 'POST', body, false),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin', 'POST', body, true),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(
      'https://insure360.test/delete',
      'https://insure360.test/cadmin',
      'POST',
      body,
      false,
    ),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin', 'POST', '{', false),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin', 'POST', 'null', false),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin', 'POST', '[]', false),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(
      url,
      'https://insure360.test/cadmin',
      'POST',
      JSON.stringify({ snapshot: '{}' }),
      false,
    ),
    true,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin', 'POST', body, false, 'document'),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(url, 'https://insure360.test/cadmin', 'POST', 'x'.repeat(200001), false),
    false,
  );
});
