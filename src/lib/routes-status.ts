import type { Filter } from 'mongodb';
import type { PageResult } from './types';

export const routeTabs = ['all', 'successful', 'warnings', 'failed', 'resolved'] as const;
export type RouteTab = (typeof routeTabs)[number];
export type RouteCounts = Record<RouteTab, number>;

export function parseRouteTab(input: string | null): RouteTab {
  if (input === null || input === '') return 'all';
  if (!routeTabs.some((tab) => tab === input)) throw new Error('Invalid route status tab');
  return input as RouteTab;
}

/** Base filters must apply equally to every status count, not just to the displayed page. */
export function routeBaseFilter(params: URLSearchParams): Filter<PageResult> {
  const siteId = params.get('siteId');
  const scanId = params.get('scanId');
  const profile = params.get('profile');
  const q = params.get('q')?.trim().slice(0, 160);
  const filter: Filter<PageResult> = {};
  if (siteId) filter.siteId = siteId;
  if (scanId) filter.scanId = scanId;
  if (profile !== null && profile !== '*') {
    if (profile) filter.authProfileId = profile;
    else
      filter.$and = [
        {
          $or: [
            { authProfileId: { $exists: false } },
            { authProfileId: '' },
            { authProfileId: { $type: 'null' } },
          ],
        },
      ];
  }
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ url: { $regex: escaped, $options: 'i' } }, { title: { $regex: escaped, $options: 'i' } }];
  }
  return filter;
}

export function routeTabFilter(
  base: Filter<PageResult>,
  tab: RouteTab,
  verifiedPageIds: readonly import('mongodb').ObjectId[] = [],
): Filter<PageResult> {
  switch (tab) {
    case 'successful':
      return { ...base, classification: 'passed' };
    case 'warnings':
      return { ...base, classification: 'warning' };
    case 'failed':
      return { ...base, classification: 'failed' };
    case 'resolved':
      return { ...base, _id: { $in: [...verifiedPageIds] } };
    default:
      return { ...base };
  }
}

export const routeSortFields: Record<string, keyof PageResult> = {
  page: 'title',
  status: 'status',
  result: 'classification',
  time: 'durationMs',
  seen: 'capturedAt',
};
export function routeOrder(params: URLSearchParams): { field: keyof PageResult; direction: 1 | -1 } {
  const requested = params.get('sort') || 'seen';
  if (!Object.hasOwn(routeSortFields, requested)) throw Error('Invalid route sorting column');
  const dir = params.get('dir') || 'desc';
  if (!['asc', 'desc'].includes(dir)) throw Error('Invalid sort direction');
  return { field: routeSortFields[requested], direction: dir === 'asc' ? 1 : -1 };
}
