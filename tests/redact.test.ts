import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactHtml, redactText, redactUrl, escapeHtml } from '../src/lib/redact';
test('mask basic secrets and remove saved scripts', () => {
  assert.match(redactText('Authorization: Bearer very-secret-value'), /REDACTED/);
  assert.doesNotMatch(redactHtml('<script>window.secret=123</script>'), /window\.secret=123/);
  assert.match(redactHtml('<meta name="csrf-token" content="abc123">'), /REDACTED/);
});
test('report escapes injection', () => {
  assert.equal(escapeHtml('<img src="x">'), '&lt;img src=&quot;x&quot;&gt;');
});

test('redact sensitive query fields before exporting URLs', () => {
  const safe = redactUrl('https://demo.test/page?token=secret-xyz&page=2');
  assert.doesNotMatch(safe, /secret-xyz/);
  assert.match(safe, /page=2/);
});
