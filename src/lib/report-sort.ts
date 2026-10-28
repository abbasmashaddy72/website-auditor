import type { Sort } from 'mongodb';

/** Public column identifiers, never untrusted MongoDB field names. */
const FIELDS = {
  result: 'classification',
  http: 'status',
  page: 'title',
  time: 'durationMs',
  captured: 'capturedAt',
} as const;
export type ReportSortColumn = keyof typeof FIELDS;
export function reportSort(params: URLSearchParams): Sort {
  const requested = params.get('sort') || 'captured';
  if (!Object.prototype.hasOwnProperty.call(FIELDS, requested)) {
    throw new Error('Invalid report sort column');
  }
  const direction = params.get('direction') || 'desc';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error('Invalid report sort direction');
  }
  const field = FIELDS[requested as ReportSortColumn];
  // Stable tie-breaking makes paginated results reproducible.
  return { [field]: direction === 'asc' ? 1 : -1, _id: -1 };
}
