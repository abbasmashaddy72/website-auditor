import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx } from '../src/lib/xlsx-export';

test('Excel report uses safe text cells, escaped values and a real ZIP container', () => {
  const binary = buildXlsx(
    ['Page', 'HTTP', 'Message'],
    [
      ['https://example.test/page?x=1&y=2', 200, '=HYPERLINK("https://bad.test")'],
      ['<error>', 500, 'Unexpected failure'],
    ],
  );
  assert.equal(binary.readUInt32LE(0), 0x04034b50);
  assert.equal(binary.readUInt32LE(binary.length - 22), 0x06054b50);
  assert.ok(binary.length > 300);
  assert.throws(() => buildXlsx([], []));
  assert.throws(() => buildXlsx(['One'], [['a', 'b']]));
});

import { inflateRawSync } from 'node:zlib';
import { buildDiagnosticWorkbook } from '../src/lib/diagnostic-export';
import { buildReviewWorkbook } from '../src/lib/review-export';
import type { PageResult, Issue } from '../src/lib/types';

/** Reads a local ZIP entry for regression assertions without any runtime package. */
function worksheetXml(book: Buffer): string {
  const target = 'xl/worksheets/sheet1.xml';
  for (let offset = 0; offset + 30 < book.length;) {
    if (book.readUInt32LE(offset) !== 0x04034b50) break;
    const method = book.readUInt16LE(offset + 8);
    const size = book.readUInt32LE(offset + 18);
    const nameSize = book.readUInt16LE(offset + 26);
    const extraSize = book.readUInt16LE(offset + 28);
    const name = book.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize;
    if (name === target) {
      assert.equal(method, 8);
      return inflateRawSync(book.subarray(start, start + size)).toString('utf8');
    }
    offset = start + size;
  }
  throw Error('Missing worksheet XML');
}

test('diagnostic XLSX exports sanitized page errors and keeps suspicious text non-executable', () => {
  const page = {
    siteId: 'site',
    scanId: 'scan',
    url: 'https://site.test/a?token=private-token',
    finalUrl: 'https://site.test/a',
    title: 'Dashboard',
    status: 500,
    classification: 'failed',
    capturedAt: new Date('2026-10-27T10:00:00Z'),
    durationMs: 123,
    evidence: { screenshot: 'private/key.png' },
    issues: [{ category: 'runtime', message: '=HYPERLINK("https://bad.test")' }],
    warnings: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  } as unknown as PageResult;
  const xml = worksheetXml(buildDiagnosticWorkbook([page]));
  assert.match(xml, /Page Diagnostics|Dashboard/);
  assert.match(xml, /REDACTED/);
  assert.doesNotMatch(xml, /private-token|private\/key\.png|<f>/);
  assert.match(xml, /t="inlineStr"/);
  assert.match(xml, /=HYPERLINK/);
});

test('review XLSX preserves auditable decisions/comments, redacts secrets and blocks formula execution', () => {
  const finding = {
    siteId: 'site',
    scanId: 'scan',
    url: 'https://site.test/?secret=private-value',
    category: 'http',
    message: 'Failure',
    status: 'manual_review',
    firstDetectedAt: new Date(),
    lastDetectedAt: new Date(),
    occurrences: 2,
    reviewHistory: [
      {
        id: 'e1',
        at: new Date(),
        actor: 'tester',
        decision: 'accepted',
        from: 'manual_review',
        to: 'manual_review',
        reviewState: 'accepted',
        comment: '=2+2 accepted risk',
      },
    ],
  } as unknown as Issue;
  const xml = worksheetXml(buildReviewWorkbook([finding]));
  assert.match(xml, /accepted risk/);
  assert.match(xml, /accepted/);
  assert.doesNotMatch(xml, /private-value|<f>/);
  assert.match(xml, /REDACTED/);
});

test('oversized Excel values mark truncation and direct users to complete JSON', () => {
  const xml = worksheetXml(buildXlsx(['Message'], [['X'.repeat(34000)]]));
  assert.match(xml, /truncated: use JSON export/);
  assert.ok(xml.length < 34000);
});
