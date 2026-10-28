'use client';

import { useEffect, useState } from 'react';
import { downloadBlob } from '@/lib/browser-download';
import { ChevronLeft, ChevronRight, Download, Eye, RefreshCw, Search } from 'lucide-react';
import type { TableColumn } from '@/components/ui';
import {
  ActionButton,
  SelectInput,
  TextInput,
  CheckInput,
  InlineAlert,
  StatusBadge,
  DataTable,
} from '@/components/ui';

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
type PageResponse = { items: Page[]; total: number; page: number; limit: number; queryKey: string };
const pageSize = 30;

export default function ReportExplorer({
  scans,
  sites,
  onOpen,
}: {
  scans: Scan[];
  sites: Site[];
  onOpen: (page: Page) => void;
}) {
  const [website, setWebsite] = useState('');
  const [scanId, setScanId] = useState('');
  const [q, setQ] = useState('');
  const [result, setResult] = useState('');
  const [http, setHttp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [ordering, setOrdering] = useState<{ id: string; direction: 'asc' | 'desc' }>({
    id: 'captured',
    direction: 'desc',
  });
  const [data, setData] = useState<PageResponse>({
    items: [],
    total: 0,
    page: 0,
    limit: pageSize,
    queryKey: '',
  });
  const [statuses, setStatuses] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState('');
  const [includeScreenshots, setIncludeScreenshots] = useState(false);

  // All scans is intentionally the default, even when no scan has a reportKeys entry.
  const matching = scans.filter((s) => !website || s.siteId === website);
  const selectedScan = scanId ? matching.find((s) => s._id === scanId) : undefined;
  const selectedId = selectedScan?._id || '';
  const filterParams = new URLSearchParams();
  if (website) filterParams.set('siteId', website);
  if (selectedId) filterParams.set('scanId', selectedId);
  if (q) filterParams.set('q', q);
  if (result) filterParams.set('result', result);
  if (http) filterParams.set('http', http);
  if (from) filterParams.set('from', from);
  if (to) filterParams.set('to', to);
  filterParams.set('sort', ordering.id);
  filterParams.set('direction', ordering.direction);
  const serializedFilters = filterParams.toString();
  const queryKey = JSON.stringify([serializedFilters, page]);
  const visible = data.queryKey === queryKey ? data : { items: [], total: 0, page, limit: pageSize };
  const statusQuery = new URLSearchParams(serializedFilters);
  statusQuery.delete('http');
  statusQuery.delete('sort');
  statusQuery.delete('direction');
  const statusScope = statusQuery.toString();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams(serializedFilters);
        params.set('paged', '1');
        params.set('page', String(page));
        params.set('limit', String(pageSize));
        const response = await fetch(`/api/scans/pages?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok) throw Error(json.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          setData({ ...json, queryKey });
          setError('');
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serializedFilters, page, queryKey]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/scans/http-statuses?${statusScope}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw Error(body.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          setStatuses(body.statuses);
          setStatusError('');
        }
      } catch (caught) {
        if (!controller.signal.aborted)
          setStatusError(caught instanceof Error ? caught.message : String(caught));
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [statusScope]);

  // Download responses explicitly, and attribute failures only to the download request.
  // Browser navigation or background status polling must not report a false export failure.
  async function downloadExport(kind: 'diagnostics' | 'errors' | 'evidence-bundle', format: string) {
    if (exporting) return;
    const key = `${kind}:${format}`;
    setExporting(key);
    setExportError('');
    try {
      const params = new URLSearchParams(serializedFilters);
      if (kind !== 'evidence-bundle') params.set('format', format);
      else params.set('screenshots', includeScreenshots ? '1' : '0');
      const response = await fetch(`/api/exports/${kind}?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        let reason = `Export HTTP ${response.status}`;
        try {
          const details: { error?: string } = await response.json();
          reason = details.error || reason;
        } catch {
          /* response may not be JSON */
        }
        throw Error(reason);
      }
      const blob = await response.blob();
      if (!blob.size) throw Error('Server returned an empty export');
      const content = response.headers.get('content-disposition') || '';
      const name =
        /filename="?([^";]+)"?/i.exec(content)?.[1] ||
        `website-auditor-${kind}.${kind === 'evidence-bundle' ? 'zip' : format}`;
      downloadBlob(blob, name);
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Cannot download export');
    } finally {
      setExporting('');
    }
  }
  const reset = () => {
    setWebsite('');
    setScanId('');
    setResult('');
    setHttp('');
    setQ('');
    setFrom('');
    setTo('');
    setPage(0);
    setOrdering({ id: 'captured', direction: 'desc' });
  };

  const reportColumns: TableColumn<Page>[] = [
    {
      id: 'result',
      header: 'Result',
      accessor: (record) => record.classification,
      render: (record) => <StatusBadge status={record.classification} />,
    },
    {
      id: 'http',
      header: 'HTTP',
      accessor: (record) => record.status || 0,
      render: (record) => record.status ?? 'Network',
    },
    {
      id: 'site',
      header: 'Website / scan',
      sortable: false,
      accessor: (record) => sites.find((site) => site._id === record.siteId)?.name || record.siteId,
      render: (record) => (
        <div className="text-xs">
          <div>{sites.find((site) => site._id === record.siteId)?.name || record.siteId}</div>
          <div className="muted">Scan {record.scanId.slice(-8)}</div>
        </div>
      ),
    },
    {
      id: 'page',
      header: 'Page',
      accessor: (record) => record.title || record.url,
      render: (record) => (
        <div className="max-w-[390px]">
          <div className="truncate font-semibold">{record.title || record.url}</div>
          <div className="muted truncate text-xs">{record.url}</div>
        </div>
      ),
    },
    {
      id: 'time',
      header: 'Time',
      accessor: (record) => record.durationMs,
      render: (record) => `${record.durationMs} ms`,
    },
    {
      id: 'captured',
      header: 'Captured (UTC)',
      accessor: (record) => new Date(record.capturedAt),
      render: (record) => (
        <span className="text-xs">
          {new Date(record.capturedAt).toISOString().replace('T', ' ').slice(0, 19)}
        </span>
      ),
    },
    {
      id: 'issues',
      header: 'Issues',
      sortable: false,
      accessor: (record) => record.issues.length,
      render: (record) => (
        <div className="max-w-[380px] text-xs break-words">
          {record.issues.map((issue) => issue.message).join(' · ') || 'None'}
        </div>
      ),
    },
    {
      id: 'inspect',
      header: 'Inspect',
      sortable: false,
      render: (record) => (
        <ActionButton size="small" onClick={() => onOpen(record)}>
          <Eye size={14} /> Details
        </ActionButton>
      ),
    },
  ];
  return (
    <section className="space-y-4">
      <div className="surface space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-h">Explore saved audit results</h2>
            <p className="muted mt-1 text-xs">
              All websites and scans are included by default. Filter historical observations or inspect
              private evidence without first selecting a scan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['html', 'csv', 'json', 'xlsx'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="btn"
                disabled={Boolean(exporting)}
                onClick={() => void downloadExport('diagnostics', format)}
                title={`Export matching page diagnostics as ${format.toUpperCase()}`}
              >
                <Download size={13} />{' '}
                {exporting === `diagnostics:${format}` ? 'Preparing…' : `Report ${format.toUpperCase()}`}
              </button>
            ))}
            {(['csv', 'json', 'xlsx'] as const).map((format) => (
              <button
                key={`errors-${format}`}
                type="button"
                className="btn"
                disabled={Boolean(exporting)}
                onClick={() => void downloadExport('errors', format)}
                title={`Export matching failed-page diagnostics as ${format.toUpperCase()}`}
              >
                <Download size={13} />{' '}
                {exporting === `errors:${format}` ? 'Preparing…' : `Errors ${format.toUpperCase()}`}
              </button>
            ))}
            <button
              type="button"
              className="btn"
              disabled={Boolean(exporting)}
              title="Download a private ZIP mapping saved page diagnostics to HTML and network evidence"
              onClick={() => void downloadExport('evidence-bundle', 'zip')}
            >
              <Download size={13} />{' '}
              {exporting === 'evidence-bundle:zip' ? 'Preparing ZIP…' : 'Developer evidence ZIP'}
            </button>
            {selectedScan?.reportKeys &&
              (['html', 'json', 'csv'] as const).map((format) => (
                <a
                  key={`saved-${format}`}
                  className="btn"
                  href={`/api/report/${selectedId}?format=${format}`}
                  title="Original immutable scan report"
                >
                  <Download size={13} /> Saved {format.toUpperCase()}
                </a>
              ))}
          </div>
        </div>
        <label className="muted flex items-start gap-2 text-xs">
          <CheckInput
            checked={includeScreenshots}
            onChange={(event) => setIncludeScreenshots(event.target.checked)}
          />
          Include private screenshots in developer ZIP (up to 100 pages; may expose visible personal
          information)
        </label>
        {exportError && <InlineAlert tone="danger">Download failed: {exportError}</InlineAlert>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label>
            <span className="field-label">Website</span>
            <SelectInput
              className="input"
              value={website}
              onChange={(e) => {
                setWebsite(e.target.value);
                setScanId('');
                setHttp('');
                setPage(0);
              }}
            >
              <option value="">All websites</option>
              {sites.map((site) => (
                <option value={site._id} key={site._id}>
                  {site.name}
                </option>
              ))}
            </SelectInput>
          </label>
          <label>
            <span className="field-label">Scan</span>
            <SelectInput
              className="input"
              value={selectedId}
              onChange={(e) => {
                setScanId(e.target.value);
                setHttp('');
                setPage(0);
              }}
            >
              <option value="">All scans</option>
              {matching.map((scan) => (
                <option key={scan._id} value={scan._id}>
                  {new Date(scan.createdAt).toLocaleString()} ·{' '}
                  {scan.authProfileName || (scan.authProfileId ? 'Authenticated' : 'Unauthenticated')} ·{' '}
                  {scan._id.slice(-6)}
                </option>
              ))}
            </SelectInput>
          </label>
          <label>
            <span className="field-label">Result</span>
            <SelectInput
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
            </SelectInput>
          </label>
          <label>
            <span className="field-label">HTTP status</span>
            <SelectInput
              className="input"
              value={http}
              onChange={(e) => {
                setHttp(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All HTTP statuses</option>
              {statuses.map((code) => (
                <option key={code} value={String(code)}>
                  {code}
                </option>
              ))}
            </SelectInput>
          </label>
          <label>
            <span className="field-label">From date (UTC)</span>
            <TextInput
              type="date"
              className="input"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            <span className="field-label">To date (UTC)</span>
            <TextInput
              type="date"
              className="input"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="field-label">Search URL / title</span>
            <div className="relative">
              <Search size={14} className="absolute top-3 left-3 text-slate-400" />
              <TextInput
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
      {error && <InlineAlert tone="danger">Page results unavailable: {error}</InlineAlert>}
      {statusError && (
        <p className="muted text-xs">
          HTTP options could not refresh: {statusError}. Existing filters are retained.
        </p>
      )}
      <div className="surface table-wrap">
        <div className="line flex items-center justify-between border-b px-4 py-3">
          <span className="muted text-xs" aria-live="polite">
            {loading
              ? 'Loading…'
              : `${visible.total} matching page results across ${selectedId ? 'one scan' : 'all matching scans'}`}
          </span>
          <ActionButton onClick={reset}>
            <RefreshCw size={13} /> Reset filters
          </ActionButton>
        </div>
        <DataTable
          rows={visible.items}
          columns={reportColumns}
          rowKey={(record) => record._id}
          caption="Saved page audit results — sorting applies to all matching database records"
          sortState={ordering}
          onSortChange={(next) => {
            setOrdering(next);
            setPage(0);
          }}
          className="rounded-none border-0"
          emptyMessage={loading ? 'Loading page results…' : 'No saved page results match these filters.'}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="muted text-xs">
          Page {page + 1} of {Math.max(1, Math.ceil(visible.total / pageSize))}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={page === 0 || loading}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <button
            type="button"
            className="btn"
            disabled={(page + 1) * pageSize >= visible.total || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
