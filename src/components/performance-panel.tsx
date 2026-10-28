'use client';
import { useState } from 'react';
import type { PageTiming, ResourceTiming } from '../lib/performance';
import { slowestResources } from '../lib/performance';

type Props = { performance?: PageTiming; fallbackDurationMs: number };
const show = (n?: number) => (n === undefined ? '—' : `${Math.round(n).toLocaleString()} ms`);
const labels: [string, (t: PageTiming) => number | undefined][] = [
  ['DOM ready', (p) => p.domContentLoadedMs],
  ['Load event', (p) => p.loadEventMs],
  ['First contentful paint', (p) => p.firstContentfulPaintMs],
  ['Largest contentful paint', (p) => p.largestContentfulPaintMs],
  ['Time to first byte', (p) => p.navigation?.ttfbMs],
  ['Page ready', (p) => p.pageReadyMs],
  ['Network settling', (p) => p.settleMs],
  ['Capture + storage', (p) => p.captureAndStorageMs],
];
export default function PerformancePanel({ performance: timing, fallbackDurationMs }: Props) {
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'slowest' | 'fastest'>('slowest');
  if (!timing)
    return (
      <div className="surface p-4 text-sm">
        <strong>No detailed timing data in this scan.</strong>
        <p className="muted mt-2">
          Duration recorded: {show(fallbackDurationMs)}. Retry the page or start a new scan to capture network
          timings and browser paint metrics.
        </p>
      </div>
    );
  const res = timing.resources || [];
  const filtered = res
    .filter((r) => (kind === 'all' || r.type === kind) && r.url.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (sort === 'slowest' ? b.durationMs - a.durationMs : a.durationMs - b.durationMs));
  const longest = Math.max(1, ...filtered.slice(0, 100).map((r) => r.durationMs));
  const types = [...new Set(res.map((r) => r.type))].sort();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {labels.map(([label, read]) => (
          <div key={label} className="surface p-3">
            <div className="muted text-xs">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{show(read(timing))}</div>
          </div>
        ))}
      </div>
      {timing.settleTimedOut && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          Readiness limit reached; {timing.pendingRequestsAtCapture ?? 'some'} relevant request(s) remained in
          flight. This scan may contain incomplete dynamic content.
        </p>
      )}
      <p className="muted text-xs">
        Browser navigation/paint metrics use the page&apos;s performance timeline. Cross-origin timing
        restrictions can hide details. Resource durations run concurrently; adding them together does not
        equal total page time.
      </p>
      <div className="surface p-4">
        <h3 className="section-h">Navigation breakdown</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {(['dnsMs', 'connectMs', 'tlsMs', 'ttfbMs', 'downloadMs'] as const).map((k) => (
            <div key={k} className="text-xs">
              <div className="muted">
                {
                  (
                    {
                      dnsMs: 'DNS',
                      connectMs: 'Connect',
                      tlsMs: 'TLS',
                      ttfbMs: 'TTFB',
                      downloadMs: 'Download',
                    } as const
                  )[k]
                }
              </div>
              <div className="font-semibold tabular-nums">{show(timing.navigation?.[k])}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-h">Slowest requests ({res.length} recorded)</h3>
          <span className="muted text-xs">Top: {slowestResources(res, 1)[0]?.type || '—'}</span>
        </div>
        <div
          className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(110px,140px)_minmax(125px,150px)]"
          aria-label="Request filters"
        >
          <input
            aria-label="Search resource URL"
            className="input min-w-0"
            placeholder="Search resource URLs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Resource type"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort requests"
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'slowest' | 'fastest')}
          >
            <option value="slowest">Slowest first</option>
            <option value="fastest">Fastest first</option>
          </select>
        </div>
        <div className="max-h-[520px] space-y-2 overflow-auto">
          {filtered.slice(0, 150).map((r: ResourceTiming, i) => (
            <div key={`${r.method}-${r.url}-${i}`} className="line border-b pb-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 truncate" title={r.url}>
                  <span className="font-semibold">{r.status ?? (r.failure ? 'Blocked' : '—')}</span> ·{' '}
                  {r.type} · {r.url}
                </div>
                <span className="whitespace-nowrap tabular-nums">{show(r.durationMs)}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.max(1, (r.durationMs / longest) * 100)}%` }}
                />
              </div>
              <div className="muted mt-1 text-[11px]">
                DNS {show(r.dnsMs)} · Connect {show(r.connectMs)} · TTFB {show(r.ttfbMs)} · Download{' '}
                {show(r.downloadMs)}
                {r.failure ? ` · ${r.failure}` : ''}
              </div>
            </div>
          ))}
          {!filtered.length && <p className="muted text-sm">No resources match these filters.</p>}
        </div>
      </div>
    </div>
  );
}
