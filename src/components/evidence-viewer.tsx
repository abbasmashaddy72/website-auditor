'use client';
import { useState } from 'react';
import Image from 'next/image';
import { Download, ZoomIn, ZoomOut, Maximize2, X, Search } from 'lucide-react';
import PerformancePanel from './performance-panel';
import type { PageTiming } from '../lib/performance';

type EvidencePage = {
  _id: string;
  evidence: Record<string, string>;
  durationMs: number;
  performance?: PageTiming;
};
type EvidenceTab = 'performance' | 'screenshot' | 'rendered' | 'original' | 'network' | 'console';
export default function EvidenceViewer({ page, renderedHtml }: { page: EvidencePage; renderedHtml: string }) {
  const [tab, setTab] = useState<EvidenceTab>('performance');
  const [source, setSource] = useState(false);
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [original, setOriginal] = useState(''),
    [network, setNetwork] = useState(''),
    [consoleData, setConsoleData] = useState(''),
    [error, setError] = useState('');
  const keys = page.evidence;
  const evidencePath = (key: string) => `/api/evidence?key=${encodeURIComponent(key)}`;
  async function changeTab(next: EvidenceTab) {
    setTab(next);
    setError('');
    const key =
      next === 'original'
        ? keys.original
        : next === 'network'
          ? keys.network
          : next === 'console'
            ? keys.console
            : undefined;
    if (!key) return;
    if (
      (next === 'original' && original) ||
      (next === 'network' && network) ||
      (next === 'console' && consoleData)
    )
      return;
    try {
      const response = await fetch(evidencePath(key) + (next === 'original' ? '&format=text' : ''), {
        cache: 'no-store',
      });
      if (!response.ok) throw Error(`Evidence HTTP ${response.status}`);
      if (next === 'original') setOriginal((await response.json()).html as string);
      else if (next === 'network') setNetwork(JSON.stringify(await response.json(), null, 2));
      else setConsoleData(JSON.stringify(await response.json(), null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const html = tab === 'original' ? original : renderedHtml;
  const highlight = html && query.trim() ? html.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const tabs: [EvidenceTab, string][] = [
    ['performance', 'Performance'],
    ['screenshot', 'Screenshot'],
    ['rendered', 'Rendered HTML'],
    ['original', 'Original HTML'],
    ['network', 'Network'],
    ['console', 'Console'],
  ];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Page evidence">
        {tabs
          .filter(
            ([id]) =>
              id === 'performance' ||
              (id === 'screenshot' && !!keys.screenshot) ||
              (id === 'rendered' && !!keys.rendered) ||
              (id === 'original' && !!keys.original) ||
              (id === 'network' && !!keys.network) ||
              (id === 'console' && !!keys.console),
          )
          .map(([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => void changeTab(id)}
              className={`btn ${tab === id ? 'primary' : ''}`}
            >
              {label}
            </button>
          ))}
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {tab === 'performance' && (
        <PerformancePanel performance={page.performance} fallbackDurationMs={page.durationMs} />
      )}
      {tab === 'screenshot' && keys.screenshot && (
        <div className="surface space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}>
              <ZoomOut size={14} /> Smaller
            </button>
            <button className="btn" onClick={() => setZoom(1)}>
              100%
            </button>
            <button className="btn" onClick={() => setZoom((v) => Math.min(3, v + 0.25))}>
              <ZoomIn size={14} /> Larger
            </button>
            <button className="btn" onClick={() => setFull(true)}>
              <Maximize2 size={14} /> Fullscreen viewer
            </button>
            <a className="btn" href={evidencePath(keys.screenshot) + '&download=1'}>
              <Download size={14} /> PNG
            </a>
          </div>
          <div className="max-h-[600px] overflow-auto rounded-lg bg-slate-900/10 p-2">
            <Image
              unoptimized
              width={1440}
              height={900}
              src={evidencePath(keys.screenshot)}
              alt="Captured full-page screenshot"
              className="h-auto max-w-none rounded-md shadow"
              style={{ width: `${zoom * 100}%` }}
            />
          </div>
        </div>
      )}
      {(tab === 'rendered' || tab === 'original') && (
        <div className="surface space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <Search size={14} className="absolute top-3 left-3" />
              <input
                className="input w-full pl-9!"
                placeholder="Find in HTML"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button className="btn" onClick={() => setSource((v) => !v)}>
              {source ? 'Sandboxed preview' : 'View source'}
            </button>
            <a
              className="btn"
              href={evidencePath(tab === 'original' ? keys.original : keys.rendered) + '&download=1'}
            >
              <Download size={14} /> HTML
            </a>
          </div>
          {query && (
            <p className="muted text-xs">
              {highlight < 0 ? 'No matches' : `First match at character ${highlight.toLocaleString()}`}
            </p>
          )}
          {source ? (
            <pre className="log-pre max-h-[600px] overflow-auto break-words whitespace-pre-wrap">
              {html.slice(0, 300000)}
            </pre>
          ) : (
            <iframe
              sandbox=""
              referrerPolicy="no-referrer"
              title="Saved HTML, scripts and network disabled"
              className="line h-[550px] w-full rounded-lg border bg-white"
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'">${html}`}
            />
          )}
        </div>
      )}
      {tab === 'network' && (
        <pre className="log-pre max-h-[600px] overflow-auto">
          {network || 'No saved network diagnostics.'}
        </pre>
      )}
      {tab === 'console' && (
        <pre className="log-pre max-h-[600px] overflow-auto">
          {consoleData || 'No saved console diagnostics.'}
        </pre>
      )}
      {full && keys.screenshot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full screenshot viewer"
          className="fixed inset-0 z-[100] overflow-auto bg-black/90 p-4"
        >
          <div className="sticky top-0 z-10 mb-3 flex justify-end gap-2">
            <button className="btn" onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}>
              <ZoomOut size={14} />
            </button>
            <button className="btn" onClick={() => setZoom((v) => Math.min(3, v + 0.25))}>
              <ZoomIn size={14} />
            </button>
            <button className="btn" onClick={() => setFull(false)}>
              <X size={18} /> Close
            </button>
          </div>
          <Image
            unoptimized
            width={1440}
            height={900}
            alt="Full-size captured screenshot"
            src={evidencePath(keys.screenshot)}
            className="mx-auto h-auto max-w-none"
            style={{ width: `${Math.round(1100 * zoom)}px` }}
          />
        </div>
      )}
    </section>
  );
}
