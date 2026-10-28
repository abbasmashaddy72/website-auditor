import type { Filter } from 'mongodb';
import type { PageResult } from './types';

/** Shared server-side filtering for the report explorer, status selector, and exports. */
export function reportPageFilter(params: URLSearchParams, forcedScanId?: string): Filter<PageResult> {
  const filter: Filter<PageResult> = {};
  const siteId = params.get('siteId')?.trim();
  const scanId = forcedScanId || params.get('scanId')?.trim();
  if (siteId) filter.siteId = siteId;
  if (scanId) filter.scanId = scanId;

  const result = params.get('result');
  if (result && ['passed', 'warning', 'failed'].includes(result)) {
    filter.classification = result as PageResult['classification'];
  }
  const http = params.get('http');
  if (http) {
    if (!/^[1-5]\d\d$/.test(http)) throw new Error('Invalid HTTP status filter');
    filter.status = Number(http);
  }
  const raw = (params.get('q') || '').trim().slice(0, 160);
  if (raw) {
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ url: { $regex: escaped, $options: 'i' } }, { title: { $regex: escaped, $options: 'i' } }];
  }
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  if (from || to) {
    const bounds: { $gte?: Date; $lt?: Date } = {};
    if (from) bounds.$gte = utcDate(from);
    if (to) {
      const followingDay = utcDate(to);
      followingDay.setUTCDate(followingDay.getUTCDate() + 1);
      bounds.$lt = followingDay;
    }
    if (bounds.$gte && bounds.$lt && bounds.$gte >= bounds.$lt) {
      throw new Error('Start date must be on or before end date');
    }
    filter.capturedAt = bounds;
  }
  return filter;
}

function utcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid report date');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid report date');
  }
  return date;
}

/** MongoDB distinct() can return null/legacy values; expose unique numeric HTTP codes only. */
export function distinctHttpStatuses(values: readonly unknown[]): number[] {
  return [
    ...new Set(
      values.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599,
      ),
    ),
  ].sort((a, b) => a - b);
}
