'use client';
import { useEffect, useState } from 'react';
import { analytics, type Observation, type Execution } from '@/lib/analytics';
import DailyOutcomeChart from './daily-outcome-chart';

type Site = { _id: string; name: string };
type LiveAnalytics = ReturnType<typeof analytics> & {
  source: 'complete-period';
  perSite: Array<{ siteId: string; pages: number; avgBrowserLoadMs?: number; avgTtfbMs?: number }>;
};
function metric(label: string, value?: number, count?: number, unit = 'ms') {
  return (
    <div className="surface p-4" key={label}>
      <div className="field-label">{label}</div>
      <div className="text-xl font-bold tabular-nums">
        {value === undefined ? 'No data' : `${value.toLocaleString()} ${unit}`}
      </div>
      <p className="muted mt-1 text-xs">{count ?? 0} measured samples</p>
    </div>
  );
}
export default function OverviewAnalytics({
  sites,
  pages,
  scans,
  asOf,
}: {
  sites: Site[];
  pages: Observation[];
  scans: Execution[];
  asOf: Date | null;
}) {
  const [site, setSite] = useState('');
  const [range, setRange] = useState(7);
  const [live, setLive] = useState<{ key: string; data: LiveAnalytics } | null>(null);
  const [warning, setWarning] = useState('');
  const queryKey = `${site}:${range}`;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ days: String(range), ...(site ? { siteId: site } : {}) });
        const response = await fetch(`/api/analytics?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const data = (await response.json()) as LiveAnalytics;
        if (!controller.signal.aborted) {
          setLive({ key: queryKey, data });
          setWarning('');
        }
      } catch {
        if (!controller.signal.aborted)
          setWarning('Full-history analytics unavailable; showing the loaded sample.');
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [queryKey, range, site]);
  const fallback = analytics(
    pages.filter((p) => !site || p.siteId === site),
    scans.filter((s) => !site || s.siteId === site),
    asOf || new Date(0),
    range,
  );
  const full = live?.key === queryKey ? live.data : undefined;
  const summary = full || fallback;
  const visibleBuckets = range === 30 ? summary.buckets.slice(-14) : summary.buckets;
  const perSite = !site
    ? sites.map((entry) => ({
        site: entry,
        summary:
          full?.perSite.find((item) => item.siteId === entry._id) ||
          analytics(
            pages.filter((p) => p.siteId === entry._id),
            scans.filter((s) => s.siteId === entry._id),
            asOf || new Date(0),
            range,
          ),
      }))
    : [];
  return (
    <section className="surface space-y-4 p-5" aria-label="Measured performance and trend analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-h">
            Performance and scan trends ·{' '}
            {site ? sites.find((s) => s._id === site)?.name || 'Selected website' : 'All websites combined'}
          </h2>
          <p className="muted mt-1 text-xs">
            Browser load timing excludes screenshots and evidence uploads; blank metrics mean no saved
            measurement.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Analytics website"
            className="input max-w-52"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          >
            <option value="">All websites</option>
            {sites.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Analytics time range"
            className="input max-w-36"
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {metric('Browser load event', summary.avgBrowserLoadMs, summary.browserLoadSamples)}
        {metric('Document TTFB', summary.avgTtfbMs, summary.ttfbSamples)}
        {metric('Full scan execution', summary.avgExecutionMs, summary.executionSamples)}
      </div>
      {summary.pages > 0 ? (
        <DailyOutcomeChart
          buckets={visibleBuckets}
          label={
            site ? sites.find((entry) => entry._id === site)?.name || 'Selected website' : 'All websites'
          }
        />
      ) : (
        <div className="muted rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm">
          No saved page measurements in the selected period.
        </div>
      )}
      {!site && sites.length > 1 && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Website performance comparison">
          {perSite.map(({ site: entry, summary: value }) => (
            <div key={entry._id} className="rounded-lg border border-[var(--line)] p-3">
              <div className="truncate text-xs font-semibold" title={entry.name}>
                {entry.name}
              </div>
              <div className="muted mt-1 text-xs">
                {value.pages} pages · Load{' '}
                {value.avgBrowserLoadMs === undefined
                  ? 'No data'
                  : `${value.avgBrowserLoadMs.toLocaleString()} ms`}{' '}
                · TTFB {value.avgTtfbMs === undefined ? 'No data' : `${value.avgTtfbMs.toLocaleString()} ms`}
              </div>
            </div>
          ))}
        </div>
      )}
      {warning && (
        <p className="muted text-xs" role="status">
          {warning}
        </p>
      )}
      <div className="muted flex flex-wrap justify-between gap-2 text-xs">
        <span>
          Pass <strong className="text-emerald-600">●</strong> · Warning{' '}
          <strong className="text-amber-600">●</strong> · Failed <strong className="text-rose-600">●</strong>
        </span>
        <span>
          {full ? 'Complete selected-period database totals' : 'Loaded dashboard sample'} · {summary.pages}{' '}
          pages · {summary.scans} measured scans · No inferred values
        </span>
      </div>
    </section>
  );
}
