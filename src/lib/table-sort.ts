/** Stable, locale-aware sort for visible table rows. No React dependency. */
export type SortValue = string | number | Date | null | undefined;
export type SortableColumn<Row> = {
  id: string;
  accessor?: (row: Row) => SortValue;
  sortable?: boolean;
};
export function sortTableRows<Row>(
  rows: readonly Row[],
  columns: readonly SortableColumn<Row>[],
  id: string,
  direction: 'asc' | 'desc',
): Row[] {
  const column = columns.find((item) => item.id === id);
  if (!column?.accessor || column.sortable === false) return [...rows];
  const get = column.accessor;
  const multiplier = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = get(a.row),
        right = get(b.row);
      if (left == null || right == null)
        return left == null && right == null ? a.index - b.index : left == null ? 1 : -1;
      const x = left instanceof Date ? left.getTime() : left;
      const y = right instanceof Date ? right.getTime() : right;
      const comparison =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return comparison ? Math.sign(comparison) * multiplier : a.index - b.index;
    })
    .map((item) => item.row);
}
