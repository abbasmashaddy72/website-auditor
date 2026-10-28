import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sortTableRows } from '../src/lib/table-sort';

test('reusable table sorts numeric, natural-text and date columns without mutating source', () => {
  const rows = [
    { id: 'a', name: 'Issue 10', http: 500, at: new Date('2026-10-26T00:00:00Z') },
    { id: 'b', name: 'Issue 2', http: 200, at: new Date('2026-10-27T00:00:00Z') },
  ];
  const columns = [
    { id: 'name', accessor: (row: (typeof rows)[number]) => row.name },
    { id: 'http', accessor: (row: (typeof rows)[number]) => row.http },
    { id: 'at', accessor: (row: (typeof rows)[number]) => row.at },
    { id: 'action', sortable: false },
  ];
  assert.deepEqual(
    sortTableRows(rows, columns, 'name', 'asc').map((x) => x.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    sortTableRows(rows, columns, 'http', 'desc').map((x) => x.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    sortTableRows(rows, columns, 'at', 'desc').map((x) => x.id),
    ['b', 'a'],
  );
  assert.deepEqual(sortTableRows(rows, columns, 'action', 'asc'), rows);
  assert.equal(rows[0].id, 'a');
});

test('reusable table places missing values last and sorts repeated values stably', () => {
  const rows = [
    { id: 'a', val: null },
    { id: 'b', val: 2 },
    { id: 'c', val: 2 },
    { id: 'd', val: 1 },
  ];
  const columns = [{ id: 'val', accessor: (row: (typeof rows)[number]) => row.val }];
  assert.deepEqual(
    sortTableRows(rows, columns, 'val', 'asc').map((x) => x.id),
    ['d', 'b', 'c', 'a'],
  );
  assert.deepEqual(
    sortTableRows(rows, columns, 'val', 'desc').map((x) => x.id),
    ['b', 'c', 'd', 'a'],
  );
});

test('site navigation sorting is restricted to actual accessor columns, never action buttons', () => {
  const rows = [
    { name: 'Zeta', count: 3 },
    { name: 'Alpha', count: 1 },
  ];
  const columns = [
    { id: 'name', accessor: (row: (typeof rows)[number]) => row.name },
    { id: 'actions', sortable: false },
  ];
  assert.deepEqual(
    sortTableRows(rows, columns, 'name', 'asc').map((x) => x.name),
    ['Alpha', 'Zeta'],
  );
  assert.deepEqual(sortTableRows(rows, columns, 'actions', 'asc'), rows);
});
