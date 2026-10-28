import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('Overview has standalone worker, review, KPI and analytics sections', () => {
  const dashboard = read('src/components/dashboard.tsx');
  assert.match(dashboard, /Review and investigation[\s\S]*?<\/div>\s*<OverviewKpis totals=\{summary\} \/>/);
  assert.match(dashboard, /<OverviewKpis totals=\{summary\} \/>\s*<OverviewAnalytics/);
});

test('slide-over reuses shared dialog focus trap, escape, backdrop and scroll locking', () => {
  const shared = read('src/components/ui/dialog.tsx');
  const dashboard = read('src/components/dashboard.tsx');
  const css = read('src/app/globals.css');
  assert.match(shared, /export function SlideOver/);
  assert.match(shared, /placement="right"/);
  assert.match(shared, /aria-modal="true"/);
  assert.match(shared, /event.key === 'Escape'/);
  assert.match(shared, /event.key === 'Tab'/);
  assert.match(shared, /document.body.style.overflow = 'hidden'/);
  assert.match(shared, /document.body.style.overflow = previousOverflow/);
  assert.match(shared, /<ConfirmDialog\s+open=\{discardOpen\}/);
  assert.match(dashboard, /<SlideOver/);
  assert.doesNotMatch(dashboard, /fixed inset-0 z-50 flex justify-end bg-black/);
  assert.match(css, /ui-modal-backdrop--right/);
});

test('consequential actions use custom confirmations rather than browser confirms', () => {
  for (const path of [
    'src/components/ui/dialog.tsx',
    'src/components/dashboard.tsx',
    'src/app/websites/_components/config-backup-panel.tsx',
  ]) {
    assert.doesNotMatch(read(path), /(?:window\.)?confirm\(/, `${path} uses a browser confirmation`);
  }
  assert.match(read('src/app/websites/_components/config-backup-panel.tsx'), /<ConfirmDialog/);
  assert.match(read('src/components/dashboard.tsx'), /<ConfirmDialog/);
});

test('resource filters align in one row at tablet/desktop drawer widths', () => {
  const panel = read('src/components/performance-panel.tsx');
  assert.match(panel, /grid-cols-1 items-center gap-2 sm:grid-cols-\[/);
  assert.match(panel, /aria-label="Request filters"/);
});
