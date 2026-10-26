import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportedRoutes } from '../src/lib/routes-import';
test('Laravel routes import skips parameterized, api and unsafe actions', () => {
  const routes = JSON.stringify([
    { uri: '/', method: 'GET|HEAD' },
    { uri: 'dashboard', method: 'GET' },
    { uri: 'users/{user}', method: 'GET' },
    { uri: 'api/pay', method: 'GET' },
    { uri: 'destroy', method: 'DELETE' },
    { uri: 'logout', method: 'GET' },
  ]);
  const result = parseImportedRoutes(routes, 'json', 'https://example.test/');
  assert.deepEqual(result.urls, ['https://example.test/', 'https://example.test/dashboard']);
  assert.equal(result.skipped.length, 3);
});

test('imported route lists ignore static assets, Livewire transport and API endpoints', () => {
  const routes = JSON.stringify([
    { uri: 'cadmin/users', method: 'GET' },
    { uri: 'build/assets/app.js', method: 'GET' },
    { uri: 'livewire-84119ac4/update', method: 'GET' },
    { uri: 'download/report.pdf', method: 'GET' },
    { uri: 'docs/help.html', method: 'GET' },
  ]);
  const result = parseImportedRoutes(routes, 'json', 'https://example.test/');
  assert.deepEqual(result.urls, ['https://example.test/cadmin/users', 'https://example.test/docs/help.html']);
  assert.equal(result.skipped.length, 3);
});
