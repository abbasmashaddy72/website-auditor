import { redactText, redactUrl } from './redact';
/** Page timings are observational. Values are milliseconds and may be absent in older scans. */
export interface ResourceTiming {
  url: string;
  method: string;
  type: string;
  status?: number;
  durationMs: number;
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  ttfbMs?: number;
  downloadMs?: number;
  failure?: string;
}
export interface PageTiming {
  navigation?: {
    dnsMs?: number;
    connectMs?: number;
    tlsMs?: number;
    ttfbMs?: number;
    downloadMs?: number;
    redirectMs?: number;
  };
  domContentLoadedMs?: number;
  loadEventMs?: number;
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
  pageReadyMs?: number;
  settleMs?: number;
  settleTimedOut?: boolean;
  pendingRequestsAtCapture?: number;
  captureAndStorageMs?: number;
  resources: ResourceTiming[];
}

function positive(n: number): number | undefined {
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}
function interval(a: number, b: number): number | undefined {
  return a >= 0 && b >= a ? positive(b - a) : undefined;
}

/** Derived from Playwright Request.timing(), responseEnd is relative to startTime. */
export function resourceFromPlaywright(input: {
  url: string;
  method: string;
  type: string;
  status?: number;
  failure?: string;
  timing?: {
    domainLookupStart: number;
    domainLookupEnd: number;
    connectStart: number;
    connectEnd: number;
    secureConnectionStart: number;
    requestStart: number;
    responseStart: number;
    responseEnd: number;
  };
}): ResourceTiming {
  const t = input.timing;
  return {
    url: input.url,
    method: input.method,
    type: input.type,
    status: input.status,
    failure: input.failure,
    durationMs: Math.max(0, positive(t?.responseEnd ?? -1) ?? 0),
    dnsMs: t ? interval(t.domainLookupStart, t.domainLookupEnd) : undefined,
    connectMs: t ? interval(t.connectStart, t.connectEnd) : undefined,
    tlsMs: t && t.secureConnectionStart >= 0 ? interval(t.secureConnectionStart, t.connectEnd) : undefined,
    ttfbMs: t ? interval(t.requestStart, t.responseStart) : undefined,
    downloadMs: t ? interval(t.responseStart, t.responseEnd) : undefined,
  };
}
export function slowestResources(resources: ResourceTiming[], limit = 10): ResourceTiming[] {
  return [...resources]
    .filter((r) => r.durationMs >= 0)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit);
}

/** Strip secrets from nested request timing objects before unrestricted exports. */
export function publicPerformance(timing: PageTiming): PageTiming {
  return {
    ...timing,
    resources: (timing.resources || []).map((entry) => ({
      ...entry,
      url: redactUrl(entry.url),
      ...(entry.failure ? { failure: redactText(entry.failure) } : {}),
    })),
  };
}
