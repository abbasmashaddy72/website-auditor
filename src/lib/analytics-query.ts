/** MongoDB-backed analytics over the full selected period; no dashboard page-list cap. */
import type { Db } from 'mongodb';

const numericCount = (path: string) => ({ $sum: { $cond: [{ $isNumber: path }, 1, 0] } });
const countClass = (status: string) => ({ $sum: { $cond: [{ $eq: ['$classification', status] }, 1, 0] } });
export function analyticsTimeWindow(now: Date, days: number): Date {
  if (![7, 30].includes(days)) throw Error('Analytics period must be 7 or 30 days');
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
}
export async function aggregateAnalytics(db: Db, now: Date, days: number, siteId?: string) {
  const from = analyticsTimeWindow(now, days);
  const pageMatch: Record<string, unknown> = { capturedAt: { $gte: from, $lte: now } };
  const scanMatch: Record<string, unknown> = {
    createdAt: { $gte: from, $lte: now },
    startedAt: { $type: 'date' },
    endedAt: { $type: 'date' },
  };
  if (siteId) {
    pageMatch.siteId = siteId;
    scanMatch.siteId = siteId;
  }
  const [pageResults, scanResults] = await Promise.all([
    db
      .collection('pages')
      .aggregate([
        { $match: pageMatch },
        {
          $facet: {
            overall: [
              {
                $group: {
                  _id: null,
                  pages: { $sum: 1 },
                  avgBrowserLoadMs: { $avg: '$performance.loadEventMs' },
                  browserLoadSamples: numericCount('$performance.loadEventMs'),
                  avgTtfbMs: { $avg: '$performance.navigation.ttfbMs' },
                  ttfbSamples: numericCount('$performance.navigation.ttfbMs'),
                },
              },
            ],
            daily: [
              {
                $group: {
                  _id: { $dateToString: { date: '$capturedAt', format: '%Y-%m-%d', timezone: 'UTC' } },
                  passed: countClass('passed'),
                  warnings: countClass('warning'),
                  failed: countClass('failed'),
                },
              },
            ],
            sites: [
              {
                $group: {
                  _id: '$siteId',
                  pages: { $sum: 1 },
                  avgBrowserLoadMs: { $avg: '$performance.loadEventMs' },
                  avgTtfbMs: { $avg: '$performance.navigation.ttfbMs' },
                },
              },
            ],
          },
        },
      ])
      .toArray(),
    db
      .collection('scans')
      .aggregate([
        { $match: scanMatch },
        {
          $group: {
            _id: null,
            scans: { $sum: 1 },
            avgExecutionMs: { $avg: { $subtract: ['$endedAt', '$startedAt'] } },
          },
        },
      ])
      .toArray(),
  ]);
  const value = pageResults[0] as
    | {
        overall: Array<Record<string, number>>;
        daily: Array<{ _id: string; passed: number; warnings: number; failed: number }>;
        sites: Array<{ _id: string; pages: number; avgBrowserLoadMs?: number; avgTtfbMs?: number }>;
      }
    | undefined;
  const overall = value?.overall?.[0];
  const scans = scanResults[0] as { scans?: number; avgExecutionMs?: number } | undefined;
  const daily = new Map((value?.daily || []).map((day) => [day._id, day]));
  const buckets = Array.from({ length: days }, (_, i) => {
    const day = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    return {
      day,
      passed: daily.get(day)?.passed || 0,
      warnings: daily.get(day)?.warnings || 0,
      failed: daily.get(day)?.failed || 0,
    };
  });
  const average = (number: number | undefined) =>
    typeof number === 'number' && Number.isFinite(number) ? Math.round(number) : undefined;
  return {
    source: 'complete-period',
    asOf: now.toISOString(),
    pages: overall?.pages || 0,
    scans: scans?.scans || 0,
    avgBrowserLoadMs: average(overall?.avgBrowserLoadMs),
    browserLoadSamples: overall?.browserLoadSamples || 0,
    avgTtfbMs: average(overall?.avgTtfbMs),
    ttfbSamples: overall?.ttfbSamples || 0,
    avgExecutionMs: average(scans?.avgExecutionMs),
    executionSamples: scans?.scans || 0,
    buckets,
    perSite: (value?.sites || []).map((item) => ({
      siteId: item._id,
      pages: item.pages,
      avgBrowserLoadMs: average(item.avgBrowserLoadMs),
      avgTtfbMs: average(item.avgTtfbMs),
    })),
  };
}
