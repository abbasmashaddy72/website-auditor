/** Pure, observational analytics; never infer a measurement from missing evidence. */
export interface Observation {
  capturedAt: string;
  siteId: string;
  classification: string;
  durationMs: number;
  performance?: { loadEventMs?: number; navigation?: { ttfbMs?: number } };
}
export interface Execution {
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  status: string;
  siteId: string;
}
export function average(values: number[]): number | undefined {
  const valid = values.filter((v) => Number.isFinite(v) && v >= 0);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : undefined;
}
export function analytics(pages: Observation[], scans: Execution[], now: Date, days = 7) {
  const start = now.getTime() - days * 86400000;
  const recentPages = pages.filter((p) => new Date(p.capturedAt).getTime() >= start);
  const recentScans = scans.filter((s) => new Date(s.createdAt).getTime() >= start);
  const load = recentPages.flatMap((p) =>
    p.performance?.loadEventMs === undefined ? [] : [p.performance.loadEventMs],
  );
  const ttfb = recentPages.flatMap((p) =>
    p.performance?.navigation?.ttfbMs === undefined ? [] : [p.performance.navigation.ttfbMs],
  );
  const duration = recentScans.flatMap((s) =>
    s.startedAt && s.endedAt ? [new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()] : [],
  );
  const buckets = Array.from({ length: days }, (_, i) => {
    const day = new Date(now.getTime() - (days - i - 1) * 86400000).toISOString().slice(0, 10);
    const forDay = recentPages.filter((p) => p.capturedAt.slice(0, 10) === day);
    return {
      day,
      passed: forDay.filter((p) => p.classification === 'passed').length,
      warnings: forDay.filter((p) => p.classification === 'warning').length,
      failed: forDay.filter((p) => p.classification === 'failed').length,
    };
  });
  return {
    pages: recentPages.length,
    scans: recentScans.length,
    avgBrowserLoadMs: average(load),
    browserLoadSamples: load.length,
    avgTtfbMs: average(ttfb),
    ttfbSamples: ttfb.length,
    avgExecutionMs: average(duration),
    executionSamples: duration.length,
    buckets,
  };
}
