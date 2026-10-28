import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (...parts: string[]) => join(process.cwd(), 'src', ...parts);

test('page-specific components and explicit protected workspace routes are present', () => {
  for (const page of [
    'websites',
    'scans',
    'routes',
    'errors',
    'resolved',
    'manual-review',
    'reports',
    'settings',
    'workers',
  ]) {
    assert.equal(existsSync(source('app', page, 'page.tsx')), true, `${page} route missing`);
  }
  assert.equal(existsSync(source('app', '[[...section]]', 'page.tsx')), false);
  assert.equal(existsSync(source('app', 'websites', '_components', 'config-backup-panel.tsx')), true);
  assert.equal(existsSync(source('app', 'manual-review', '_components', 'manual-review-panel.tsx')), true);
});

test('shared UI primitives are separate and Manual Review shows one route heading', () => {
  for (const component of [
    'button',
    'icon-button',
    'card',
    'dialog',
    'tooltip',
    'tabs',
    'form',
    'status',
    'table',
  ]) {
    assert.equal(existsSync(source('components', 'ui', `${component}.tsx`)), true);
  }
  assert.equal(existsSync(source('components', 'ui.tsx')), false);
  const panel = readFileSync(
    source('app', 'manual-review', '_components', 'manual-review-panel.tsx'),
    'utf8',
  );
  assert.doesNotMatch(panel, /<h[12][^>]*page-h[^>]*>\s*Manual Review/);
  assert.match(panel, /<DataTable\b/);
});

test('configuration export and Reports use the delayed, shared browser download helper', () => {
  for (const path of [
    source('app', 'websites', '_components', 'config-backup-panel.tsx'),
    source('app', 'reports', '_components', 'report-explorer.tsx'),
  ]) {
    assert.match(readFileSync(path, 'utf8'), /downloadBlob\(/);
  }
  assert.match(
    readFileSync(source('lib', 'browser-download.ts'), 'utf8'),
    /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 30_000\)/,
  );
});
