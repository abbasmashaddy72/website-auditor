import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('destructive website actions open confirmation and share button styles', () => {
  const card = read('src/app/websites/_components/website-card.tsx');
  const dashboard = read('src/components/dashboard.tsx');
  const buttons = read('src/components/ui/destructive-button.tsx');
  assert.match(card, /<DestructiveButton[^>]+onClick=\{onDelete\}/);
  assert.match(dashboard, /title="Delete website"/);
  assert.match(dashboard, /deleteConfirmation !== deleteSite\.name/);
  assert.match(buttons, /'danger-outline'/);
  assert.doesNotMatch(dashboard, /className="btn danger"/);
});

test('route-specific overview and website sections use reusable cards', () => {
  assert.match(read('src/components/dashboard.tsx'), /<OverviewKpis totals=\{summary\}/);
  assert.match(read('src/components/dashboard.tsx'), /<WebsiteGrid/);
  assert.match(read('src/app/_overview/overview-kpis.tsx'), /<Card/);
  assert.match(read('src/app/websites/_components/website-card.tsx'), /<Card/);
});

test('server-controlled table sorting does not re-sort only the visible page', () => {
  const table = read('src/components/ui/table.tsx');
  const explorer = read('src/app/reports/_components/report-explorer.tsx');
  assert.match(table, /onSortChange \? \[\.\.\.rows\] : sortTableRows/);
  assert.match(explorer, /onSortChange=\{\(next\)/);
  assert.match(explorer, /sortState=\{ordering\}/);
});
