'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Card } from './card';
import { sortTableRows, type SortValue } from '@/lib/table-sort';
export type { SortValue } from '@/lib/table-sort';

export type TableSort = { id: string; direction: 'asc' | 'desc' };
export type TableColumn<Row> = {
  id: string;
  header: string;
  accessor?: (row: Row) => SortValue;
  render?: (row: Row) => ReactNode;
  className?: string;
  sortable?: boolean;
};
/** Accessible configurable table: declarative headers, cells, row actions and stable local sorting. */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  emptyMessage = 'No records match these filters.',
  initialSort,
  initialDirection = 'asc',
  className = '',
  caption,
  sortState,
  onSortChange,
}: {
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => string;
  emptyMessage?: string;
  initialSort?: string;
  initialDirection?: 'asc' | 'desc';
  className?: string;
  caption?: string;
  /** When controlled, server sorting is handled by the parent and rows are not re-sorted locally. */
  sortState?: TableSort;
  onSortChange?: (next: TableSort) => void;
}) {
  const [sort, setSort] = useState(initialSort || '');
  const [direction, setDirection] = useState<'asc' | 'desc'>(initialDirection);
  const activeSort = sortState?.id ?? sort;
  const activeDirection = sortState?.direction ?? direction;
  const sorted = useMemo(
    () => (onSortChange ? [...rows] : sortTableRows(rows, columns, activeSort, activeDirection)),
    [rows, columns, activeSort, activeDirection, onSortChange],
  );
  const changeSort = (id: string) => {
    const next: TableSort = {
      id,
      direction: activeSort === id && activeDirection === 'asc' ? 'desc' : 'asc',
    };
    if (onSortChange) onSortChange(next);
    else {
      setSort(next.id);
      setDirection(next.direction);
    }
  };
  return (
    <Card className={`table-wrap ${className}`}>
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = column.sortable !== false && Boolean(column.accessor);
              return (
                <th
                  scope="col"
                  key={column.id}
                  className={column.className}
                  aria-sort={
                    !sortable || activeSort !== column.id
                      ? 'none'
                      : activeDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="ui-table-sort"
                      title={`Sort by ${column.header}`}
                      onClick={() => changeSort(column.id)}
                    >
                      {column.header}
                      {activeSort === column.id ? (
                        activeDirection === 'asc' ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )
                      ) : (
                        <ArrowUpDown size={13} className="opacity-50" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="hover-surface">
              {columns.map((column) => (
                <td key={column.id} className={column.className}>
                  {column.render
                    ? column.render(row)
                    : column.accessor
                      ? String(column.accessor(row) ?? '—')
                      : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p role="status" className="ui-empty">
          {emptyMessage}
        </p>
      )}
    </Card>
  );
}
export function TableScroll({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Card className={`table-wrap ${className}`}>{children}</Card>;
}
