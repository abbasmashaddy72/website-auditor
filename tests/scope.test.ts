import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  canonicalLink,
  isPrivate,
  isLoopback,
  isSafeLink,
  isCrawlablePageUrl,
  effectivePort,
} from '../src/lib/scope';
test('canonicalize local and public websites', () => {
  assert.equal(normalizeUrl('insure360.test'), 'https://insure360.test/');
  assert.equal(normalizeUrl('localhost:5173'), 'https://localhost:5173/');
  assert.equal(normalizeUrl('http://127.0.0.1:8000'), 'http://127.0.0.1:8000/');
  assert.throws(() => normalizeUrl('file:///etc/passwd'));
  assert.throws(() => normalizeUrl('https://username:secret@example.com'));
});
test('scope and unsafe route identification', () => {
  assert.equal(
    canonicalLink('../dashboard#top', 'https://demo.test/account/edit'),
    'https://demo.test/dashboard',
  );
  assert.equal(isSafeLink('https://demo.test/login'), true);
  assert.equal(isSafeLink('https://demo.test/logout'), false);
  assert.equal(isSafeLink('https://demo.test/account/delete/123'), false);
  assert.equal(effectivePort(new URL('https://demo.test')), 443);
});
test('local address detection', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isPrivate('10.0.1.23'), true);
  assert.equal(isPrivate('192.168.1.10'), true);
  assert.equal(isPrivate('8.8.8.8'), false);
});

test('browser discovery excludes assets and framework endpoints while preserving real pages', () => {
  for (const url of [
    'https://demo.test/build/assets/custom-a8.js',
    'https://demo.test/insure360/assets/scroll-fix.js?x=1',
    'https://demo.test/vendor/livewire/livewire.js',
    'https://demo.test/_next/static/main.css',
    'https://demo.test/livewire-84119ac4/update',
    'https://demo.test/api/users',
    'https://demo.test/favicon.ico',
    'https://demo.test/manual.pdf',
  ])
    assert.equal(isCrawlablePageUrl(url), false, url);
  for (const url of [
    'https://demo.test/cadmin/insurance-companies',
    'https://demo.test/cadmin/users/create',
    'https://demo.test/about.html',
    'https://demo.test/records/123?filter=active',
  ])
    assert.equal(isCrawlablePageUrl(url), true, url);
});
