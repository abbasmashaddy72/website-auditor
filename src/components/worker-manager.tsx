'use client';
import { useEffect, useState } from 'react';
import { ActionButton, ConfirmDialog, Tooltip } from './ui';
type Result = { enabled: boolean; output?: string; error?: string };
export default function WorkerManager() {
  const [status, setStatus] = useState<Result | null>(null);
  const [logs, setLogs] = useState<Result | null>(null);
  const [choice, setChoice] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    const results = await Promise.allSettled(
      ['status', 'logs'].map(async (view) => {
        const result = await fetch(`/api/worker-service?view=${view}`, { cache: 'no-store' });
        return (await result.json()) as Result;
      }),
    );
    if (results[0].status === 'fulfilled') setStatus(results[0].value);
    if (results[1].status === 'fulfilled') setLogs(results[1].value);
  }
  useEffect(() => {
    const init = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 10000);
    return () => {
      clearTimeout(init);
      clearInterval(poll);
    };
  }, []);
  async function execute() {
    if (!choice) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/worker-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: choice, confirm: 'WEBSITE AUDITOR WORKER' }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      setMessage(`Worker ${choice} command accepted by systemd. Verify status below.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setChoice(null);
    }
  }
  return (
    <section className="surface space-y-3 p-5">
      <h2 className="font-semibold">Worker management</h2>
      <p className="muted text-sm">
        Controls target only the fixed website-auditor-worker.service user unit. No shell commands are
        accepted.
      </p>
      <p className="text-xs">
        {status?.enabled
          ? 'Host process control enabled'
          : 'Read-only mode. Set AUDITOR_WORKER_CONTROL=systemd in the host environment to enable controls.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {(['start', 'stop', 'restart'] as const).map((action) => (
          <Tooltip
            key={action}
            text={
              action === 'stop'
                ? 'Stop after active worker processing where supervisor allows'
                : 'Control the local systemd worker service'
            }
          >
            <ActionButton
              variant={action === 'stop' ? 'danger' : 'secondary'}
              disabled={!status?.enabled || busy}
              onClick={() => setChoice(action)}
            >
              {action[0].toUpperCase() + action.slice(1)} worker
            </ActionButton>
          </Tooltip>
        ))}
        <ActionButton onClick={() => void load()}>Refresh logs</ActionButton>
        <ActionButton
          disabled={!logs?.output}
          onClick={() => {
            const blob = new Blob([logs?.output || ''], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'website-auditor-worker.log';
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export logs
        </ActionButton>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <h3 className="text-sm font-semibold">Supervisor state</h3>
      <pre className="max-h-36 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
        {status?.error || status?.output || 'No host supervisor data.'}
      </pre>
      <h3 className="text-sm font-semibold">Recent worker logs</h3>
      <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
        {logs?.error || logs?.output || 'No worker logs available.'}
      </pre>
      <ConfirmDialog
        open={Boolean(choice)}
        title={`${choice || 'Control'} worker?`}
        danger={choice === 'stop'}
        busy={busy}
        description={`${choice === 'stop' ? 'Stopping may interrupt active Playwright scans. Their leases can be recovered after restart.' : 'This will change the Website Auditor worker service state.'} No website data will be deleted.`}
        confirmLabel={`${choice || 'Confirm'} worker`}
        onClose={() => setChoice(null)}
        onConfirm={() => void execute()}
      />
    </section>
  );
}
