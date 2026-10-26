import test from 'node:test';
import assert from 'node:assert/strict';
import { isBrowserFaithfulLivewireRequest } from '../src/lib/request-policy';

const endpoint = 'https://insure360.test/livewire-84119ac4/update';
const source = 'https://insure360.test/cadmin/insurance-companies';

test('local browser-faithful Livewire transport allows first-party browser initialization', () => {
  const standard = JSON.stringify({ components: [{ calls: [{ method: 'load' }], updates: {} }] });
  assert.equal(isBrowserFaithfulLivewireRequest(endpoint, source, 'POST', standard, false, 'fetch'), true);
  assert.equal(
    isBrowserFaithfulLivewireRequest(
      endpoint,
      source,
      'POST',
      JSON.stringify({ snapshot: '{}' }),
      false,
      'xhr',
    ),
    true,
  );
  // An opaque non-JSON string is not valid Livewire JSON transport, even in browser-faithful mode.
  assert.equal(
    isBrowserFaithfulLivewireRequest(
      endpoint,
      source,
      'POST',
      'opaque framework-version-specific payload',
      false,
      'xhr',
    ),
    false,
  );
  assert.equal(isBrowserFaithfulLivewireRequest(endpoint, source, 'POST', standard, true, 'fetch'), false);
  assert.equal(
    isBrowserFaithfulLivewireRequest(endpoint, source, 'POST', standard, false, 'document'),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(endpoint, 'about:blank', 'POST', standard, false, 'fetch'),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(
      endpoint,
      'https://broker.insure360.test/private',
      'POST',
      standard,
      false,
      'fetch',
    ),
    false,
  );
  assert.equal(
    isBrowserFaithfulLivewireRequest(
      'https://insure360.test/api/delete',
      source,
      'POST',
      standard,
      false,
      'fetch',
    ),
    false,
  );
  assert.equal(isBrowserFaithfulLivewireRequest(endpoint, source, 'GET', standard, false, 'fetch'), false);
});
