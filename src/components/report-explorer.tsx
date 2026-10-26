'use client';
import { useEffect, useState } from 'react';
import { Eye, Search, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';

type Scan = {
  _id: string;
  siteId: string;
  authProfileId?: string;
  authProfileName?: string;
  createdAt: string;
  status: string;
  reportKeys?: Record<string, string>;
};
type Site = { _id: string; name: string };
type Page = {
  _id: string;
  siteId: string;
  scanId: string;
  url: string;
  finalUrl: string;
  title: string;
  status?: number;
  classification: string;
  durationMs: number;
  issues: Array<{ category: string; message: string }>;
  evidence: Record<string, string>;
  capturedAt: string;
};
export default function ReportExplorer({
  scans,
  sites,
  onOpen,
}: {
  scans: Scan[];
  sites: Site[];
  onOpen: (page: Page) => void;
}) {
  const [website, setWebsite] = useState(''),
    [scanId, setScanId] = useState(''),
    [q, setQ] = useState(''),
    [result, setResult] = useState(''),
    [http, setHttp] = useState(''),
    [page, setPage] = useState(0);
  const [data, setData] = useState<{
    items: Page[];
    total: number;
    page: number;
    limit: number;
    queryKey: string;
  }>({ items: [], total: 0, page: 0, limit: 30, queryKey: '' });
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const matching = scans.filter((s) => (!website || s.siteId === website) && s.reportKeys);
  const selectedScan = matching.find((s) => s._id === scanId) || matching[0];
  const selectedId = selectedScan?._id || '';
  const queryKey = JSON.stringify([selectedId, page, q, result, http]);
  const visible = data.queryKey === queryKey ? data : { items: [], total: 0, page, limit: 30 };
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ paged: '1', page: String(page), limit: '30', q, result, http });
        const response = await fetch(`/api/scans/pages/${selectedId}?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok) throw Error(json.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          setData({ ...json, queryKey });
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedId, page, q, result, http, queryKey]);
  return (
    <section className="space-y-4">
      <div className="surface space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-h">Explore saved audit results</h2>
            <p className="muted mt-1 text-xs">
              Query MongoDB directly. Open any result to inspect private HTML, screenshots and diagnostics
              without downloading a report.
            </p>
          </div>
          {selectedId && (
            <div className="flex flex-wrap gap-2">
              <a
                className="btn"
                href={`/api/exports/errors?scanId=${encodeURIComponent(selectedId)}&format=csv`}
              >
                <Download size={13} /> Errors CSV
              </a>
              <a
                className="btn"
                href={`/api/exports/errors?scanId=${encodeURIComponent(selectedId)}&format=json`}
              >
                <Download size={13} /> Errors JSON
              </a>
              {website && (
                <a
                  className="btn"
                  href={`/api/exports/errors?siteId=${encodeURIComponent(website)}&format=csv`}
                >
                  <Download size={13} /> All site errors CSV
                </a>
              )}
              {(['html', 'json', 'csv'] as const).map((f) => (
                <a key={f} className="btn" href={`/api/report/${selectedId}?format=${f}`}>
                  <Download size={13} />
                  {f.toUpperCase()}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label>
            <span className="field-label">Website</span>
            <select
              className="input"
              value={website}
              onChange={(e) => {
                setWebsite(e.target.value);
                setScanId('');
                setPage(0);
              }}
            >
              <option value="">All websites</option>
              {sites.map((site) => (
                <option value={site._id} key={site._id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Scan</span>
            <select
              className="input"
              value={selectedId}
              onChange={(e) => {
                setScanId(e.target.value);
                setPage(0);
              }}
            >
              {matching.map((s) => (
                <option key={s._id} value={s._id}>
                  {new Date(s.createdAt).toLocaleString()} ·{' '}
                  {s.authProfileName || (s.authProfileId ? 'Authenticated' : 'Unauthenticated')} ·{' '}
                  {s._id.slice(-6)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Result</span>
            <select
              className="input"
              value={result}
              onChange={(e) => {
                setResult(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All results</option>
              <option value="passed">Passed</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label>
            <span className="field-label">HTTP status</span>
            <input
              className="input"
              value={http}
              onChange={(e) => {
                setHttp(e.target.value);
                setPage(0);
              }}
              placeholder="200, 403, 500…"
              maxLength={3}
            />
          </label>
          <label>
            <span className="field-label">Search URL / title</span>
            <div className="relative">
              <Search size={14} className="absolute top-3 left-3 text-slate-400" />
              <input
                className="input pl-9!"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
                placeholder="Filter routes…"
              />
            </div>
          </label>
        </div>
      </div>
      {error && (
        <div role="alert" className="text-sm text-red-500">
          {error}
        </div>
      )}
      <div className="surface table-wrap">
        <div className="line flex items-center justify-between border-b px-4 py-3">
          <span className="muted text-xs">
            {loading ? 'Loading…' : `${visible.total} matching page results`}
          </span>
          <button
            className="btn"
            onClick={() => {
              setResult('');
              setHttp('');
              setQ('');
              setPage(0);
            }}
          >
            <RefreshCw size={13} /> Reset filters
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Result</th>
              <th>HTTP</th>
              <th>Page</th>
              <th>Time</th>
              <th>Issues</th>
              <th>Inspect</th>
            </tr>
          </thead>
          <tbody>
            {visible.items.map((p) => (
              <tr key={p._id}>
                <td>
                  <span className={`pill ${p.classification}`}>{p.classification}</span>
                </td>
                <td>{p.status ?? 'Network'}</td>
                <td className="max-w-[390px]">
                  <div className="truncate font-semibold">{p.title || p.url}</div>
                  <div className="muted truncate text-xs">{p.url}</div>
                </td>
                <td>{p.durationMs} ms</td>
                <td className="max-w-[380px] text-xs break-words">
                  {p.issues.map((i) => i.message).join(' · ') || 'None'}
                </td>
                <td>
                  <button className="btn" onClick={() => onOpen(p)}>
                    <Eye size={14} /> Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.items.length && (
          <div className="muted p-8 text-center text-sm">No records match these filters.</div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="muted text-xs">
          Page {page + 1} of {Math.max(1, Math.ceil(visible.total / 30))}
        </span>
        <div className="flex gap-2">
          <button
            className="btn"
            disabled={page === 0 || loading}
            onClick={() => setPage((v) => Math.max(0, v - 1))}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <button
            className="btn"
            disabled={(page + 1) * 30 >= visible.total || loading}
            onClick={() => setPage((v) => v + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
