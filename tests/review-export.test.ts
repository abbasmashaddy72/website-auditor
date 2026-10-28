import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewExport, safeCsvCell } from '../src/lib/review-export';
import type { Issue } from '../src/lib/types';
test('CSV cells block spreadsheet formula injection', () => {
  assert.equal(safeCsvCell('=HYPERLINK("https://evil.test")'), '"\'=HYPERLINK(""https://evil.test"")"');
});
test('review export preserves audit comments and redacts sensitive URLs', () => {
  const finding = {
    siteId: 'test',
    scanId: 'scan',
    url: 'https://site.test/page?token=secret',
    category: 'http',
    message: 'A failure',
    status: 'manual_review',
    reviewState: 'false_positive',
    firstDetectedAt: new Date(),
    lastDetectedAt: new Date(),
    occurrences: 2,
    reviewHistory: [
      {
        id: 'event',
        at: new Date(),
        actor: 'administrator',
        decision: 'false_positive',
        from: 'manual_review',
        to: 'manual_review',
        reviewState: 'false_positive',
        comment: 'Reported by monitoring instrumentation',
      },
    ],
  } as unknown as Issue;
  for (const format of ['csv', 'json', 'html'] as const) {
    const result = buildReviewExport([finding], format);
    assert.match(result, /Reported by monitoring instrumentation/);
    assert.doesNotMatch(result, /token=secret/);
  }
  assert.match(buildReviewExport([finding], 'html'), /<!doctype html>/);
});

test('HTML review export escapes stored comments', () => {
  const bad = {
    siteId: '1',
    scanId: '2',
    url: 'https://site.test',
    category: 'test',
    message: '<script>alert(1)</script>',
    status: 'manual_review',
    firstDetectedAt: new Date(),
    lastDetectedAt: new Date(),
    occurrences: 1,
    reviewHistory: [
      {
        id: 'x',
        at: new Date(),
        actor: 'admin',
        decision: 'accepted',
        from: 'manual_review',
        to: 'manual_review',
        reviewState: 'accepted',
        comment: '<img src=x onerror=alert(1)>',
      },
    ],
  } as unknown as Issue;
  const html = buildReviewExport([bad], 'html');
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=/);
  assert.match(html, /&lt;script&gt;/);
});
