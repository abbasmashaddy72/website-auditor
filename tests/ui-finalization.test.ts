import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('website card actions occupy one accessible, non-wrapping row', () => {
  const card = read('src/app/websites/_components/website-card.tsx');
  assert.match(card, /website-card__actions[^"\n]*grid-cols-4/);
  assert.match(card, /role="group"/);
  assert.match(card, /onConfigure/);
  assert.match(card, /onProfiles/);
  assert.match(card, /onEdit/);
  assert.match(card, /onDelete/);
  assert.doesNotMatch(card, /website-card__actions[^"\n]*overflow-x-auto/);
  const css = read('src/app/globals.css');
  assert.match(
    css,
    /website-card__actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(css, /@container\s*\(max-width:\s*350px\)/);
});

test('interactive styles include pointer, hover, active, focus and reduced motion', () => {
  const css = read('src/app/globals.css');
  for (const rule of [
    'a[href]',
    'button:not(:disabled)',
    'summary',
    'ui-button:active',
    'ui-tab--active:hover',
    'pill.error',
    'prefers-reduced-motion',
  ]) {
    assert.ok(css.includes(rule), `Missing interaction state ${rule}`);
  }
});

test('grouped findings provide expandable rows and group selection without deleting evidence', () => {
  const panel = read('src/app/errors/_components/finding-groups.tsx');
  assert.match(panel, /<details\b/);
  assert.match(panel, /<summary\b/);
  assert.match(panel, /onSelectionChange/);
  assert.match(panel, /group\.ids/);
  assert.match(panel, /onInspect/);
});

test('Overview review links are placed directly after worker status, before KPI cards', () => {
  const dashboard = read('src/components/dashboard.tsx');
  const worker = dashboard.indexOf('Worker {workerOnline');
  const review = dashboard.indexOf('Review and investigation');
  const kpis = dashboard.indexOf('<OverviewKpis totals={summary} />');
  assert.ok(worker >= 0 && worker < review && review < kpis);
});
