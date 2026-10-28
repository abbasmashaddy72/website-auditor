'use client';
import { ActionButton, DestructiveButton } from './ui';
import { useState } from 'react';
import { AlertTriangle, Database, ShieldCheck, RefreshCw } from 'lucide-react';

type Site = { _id: string; name: string };
type Mode = 'scans' | 'resolved_issues' | 'events' | 'workers';
type Preview = { count: number; pages?: number; limit?: number; note: string; token: string };
export default function DatabaseCleanup({ sites, onClean }: { sites: Site[]; onClean: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('scans'),
    [days, setDays] = useState(30),
    [siteId, setSiteId] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [ack, setAck] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const change = () => {
    setPreview(null);
    setAck('');
    setMessage('');
    setError('');
  };
  async function plan() {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        mode,
        days: String(days),
        ...(siteId && mode !== 'workers' ? { siteId } : {}),
      });
      const response = await fetch(`/api/cleanup/preview?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      setPreview(data);
      setAck('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function clean() {
    if (!preview || ack !== 'DELETE AUDITOR HISTORY') return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/cleanup/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: preview.token, confirmation: ack }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      setMessage(
        `Cleaned ${data.deleted} MongoDB record(s)${data.objects ? ` and ${data.objects} private RustFS object(s)` : ''}.`,
      );
      setPreview(null);
      setAck('');
      await onClean();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface space-y-4 p-6 md:col-span-2">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/10 p-3 text-amber-500">
          <Database size={21} />
        </div>
        <div>
          <h2 className="font-semibold">Database & evidence cleanup</h2>
          <p className="muted mt-1 text-sm">
            Preview old auditor data before deleting it. No websites, credentials, auth profiles, active
            scans, or unrelated application databases are touched.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          <span className="field-label">What to clean</span>
          <select
            className="input"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              change();
            }}
          >
            <option value="scans">Finished scans + RustFS evidence</option>
            <option value="resolved_issues">Verified resolved issues</option>
            <option value="events">Old scan activity logs</option>
            <option value="workers">Inactive worker registrations</option>
          </select>
        </label>
        <label>
          <span className="field-label">Older than (days)</span>
          <input
            type="number"
            min={1}
            max={3650}
            className="input"
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              change();
            }}
          />
        </label>
        <label>
          <span className="field-label">Website scope</span>
          <select
            className="input"
            disabled={mode === 'workers'}
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              change();
            }}
          >
            <option value="">All registered websites</option>
            {sites.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ActionButton disabled={busy || days < 1 || days > 3650} onClick={() => void plan()}>
        <RefreshCw size={14} /> Preview cleanup (no deletion)
      </ActionButton>
      {preview && (
        <div className="space-y-3 rounded-xl border border-amber-500/40 p-4">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="text-amber-500" size={17} />
            <strong>{preview.count} eligible record(s)</strong>
            {typeof preview.pages === 'number' && (
              <span className="muted">· {preview.pages} page result(s)</span>
            )}
          </div>
          <p className="muted text-xs">
            {preview.note} Preview expires after five minutes; re-preview if it expires.
          </p>
          {preview.count > 0 && (
            <>
              <label>
                <span className="field-label">Type DELETE AUDITOR HISTORY to confirm</span>
                <input
                  autoComplete="off"
                  spellCheck={false}
                  className="input"
                  placeholder="DELETE AUDITOR HISTORY"
                  value={ack}
                  onChange={(e) => setAck(e.target.value)}
                />
              </label>
              <DestructiveButton
                emphasis="strong"
                disabled={busy || ack !== 'DELETE AUDITOR HISTORY'}
                onClick={() => void clean()}
              >
                Permanently delete eligible data
              </DestructiveButton>
            </>
          )}
        </div>
      )}
      {message && (
        <div role="status" className="flex items-center gap-2 text-sm text-emerald-600">
          <ShieldCheck size={16} />
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm text-red-500">
          {error}
        </div>
      )}
      <p className="muted text-xs">
        Safety: only completed/cancelled scans older than the cutoff qualify; active scans are excluded. Scans
        referenced by recorded issues are preserved. Cleanup cannot be undone. Back up the auditor database
        and RustFS bucket before bulk retention changes.
      </p>
    </section>
  );
}
