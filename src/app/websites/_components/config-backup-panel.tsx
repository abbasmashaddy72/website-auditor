'use client';

import { useState } from 'react';
import { downloadBlob } from '@/lib/browser-download';
import { Download, FileJson2, LockKeyhole, Upload } from 'lucide-react';
import { ActionButton, Dialog, ConfirmDialog, TabBar, InlineAlert } from '@/components/ui';

type Website = { _id: string; name: string; baseUrl: string };
type Envelope = { format: 'website-auditor-config-backup'; version: 1; kdf: unknown; cipher: unknown };
type Strategy = 'create' | 'update' | 'skip';
type Preview = {
  websites: Array<{
    name: string;
    baseUrl: string;
    action: string;
    profiles: Array<{ name: string; action: string }>;
  }>;
  summary: {
    websitesCreate: number;
    websitesUpdate: number;
    websitesSkip: number;
    profilesCreate: number;
    profilesUpdate: number;
    conflicts: number;
  };
  previewToken: string;
};
const post = async <T,>(action: string, body: unknown): Promise<T> => {
  const response = await fetch(`/api/config-backup/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw Error(
      (data as { error?: string }).error || `Configuration backup request failed (HTTP ${response.status})`,
    );
  return data as T;
};

/** Client state is ephemeral; never save passphrases or backup contents in localStorage. */
export default function ConfigBackupPanel({
  sites,
  onImported,
}: {
  sites: Website[];
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'export' | 'import'>('export');
  const [selection, setSelection] = useState<string[]>([]);
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [file, setFile] = useState<Envelope | null>(null);
  const [filename, setFilename] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('skip');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [authorize, setAuthorize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const resetImportPreview = () => setPreview(null);
  const close = () => {
    setOpen(false);
    setExportPassword('');
    setExportConfirm('');
    setImportPassword('');
    setFile(null);
    setFilename('');
    setPreview(null);
    setError('');
    setAuthorize(false);
  };
  const switchMode = (next: 'export' | 'import') => {
    setMode(next);
    setError('');
    setPreview(null);
    setMessage('');
    setExportPassword('');
    setExportConfirm('');
    setImportPassword('');
  };
  async function exportBackup() {
    if (exportPassword !== exportConfirm) {
      setError('Backup passwords do not match');
      return;
    }
    if (exportPassword.length < 12) {
      setError('Use at least 12 characters for the backup password');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/config-backup/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          password: exportPassword,
          ...(selection.length ? { siteIds: selection } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw Error(data.error || `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      downloadBlob(blob, `website-auditor-config-${new Date().toISOString().slice(0, 10)}.encrypted.json`);
      setMessage('Encrypted JSON downloaded. Store its password separately; it cannot be recovered.');
      setExportPassword('');
      setExportConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }
  async function loadFile(chosen?: File) {
    setFile(null);
    setPreview(null);
    setFilename('');
    setError('');
    if (!chosen) return;
    if (chosen.size > 3_000_000) {
      setError('Encrypted backup must be under 3 MB');
      return;
    }
    try {
      const value: unknown = JSON.parse(await chosen.text());
      const envelope = value as Partial<Envelope>;
      if (
        envelope?.format !== 'website-auditor-config-backup' ||
        envelope.version !== 1 ||
        !envelope.kdf ||
        !envelope.cipher ||
        typeof (envelope.kdf as { salt?: unknown }).salt !== 'string' ||
        typeof (envelope.cipher as { data?: unknown }).data !== 'string'
      )
        throw Error('Not a supported encrypted Website Auditor backup');
      setFile(envelope as Envelope);
      setFilename(chosen.name);
    } catch {
      setError('Invalid encrypted JSON backup');
    }
  }
  async function makePreview() {
    if (!file) {
      setError('Select an encrypted JSON backup first');
      return;
    }
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const value = await post<Preview>('preview', {
        envelope: file,
        password: importPassword,
        strategy,
        authorizationConfirmed: authorize,
      });
      setPreview(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview backup');
    } finally {
      setBusy(false);
    }
  }
  async function applyImport() {
    if (!preview || !file) return;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ outcome: Record<string, number> }>('apply', {
        envelope: file,
        password: importPassword,
        strategy,
        authorizationConfirmed: authorize,
        previewToken: preview.previewToken,
      });
      setMessage(
        `Import completed: ${result.outcome.websitesCreated} websites created, ${result.outcome.websitesUpdated} updated, ${result.outcome.profilesCreated} profiles created and ${result.outcome.profilesUpdated} updated.`,
      );
      setImportPassword('');
      setFile(null);
      setPreview(null);
      setFilename('');
      setAuthorize(false);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ActionButton
        onClick={() => {
          setOpen(true);
          setMessage('');
        }}
        title="Export or restore encrypted website and login profile settings"
      >
        <FileJson2 size={15} /> Configuration backup
      </ActionButton>
      <Dialog
        title="Website & profile backup"
        open={open}
        onClose={close}
        footer={
          <div className="flex w-full flex-wrap justify-end gap-2">
            <ActionButton onClick={close} disabled={busy}>
              Close
            </ActionButton>
            {mode === 'export' ? (
              <ActionButton
                variant="primary"
                loading={busy}
                disabled={!sites.length || exportPassword.length < 12 || exportPassword !== exportConfirm}
                onClick={() => void exportBackup()}
              >
                <Download size={15} /> Download encrypted JSON
              </ActionButton>
            ) : preview ? (
              <ActionButton
                variant="primary"
                loading={busy}
                disabled={preview.summary.conflicts > 0}
                onClick={() => setConfirmImportOpen(true)}
              >
                Confirm import
              </ActionButton>
            ) : (
              <ActionButton
                variant="primary"
                loading={busy}
                disabled={!file || !authorize || importPassword.length < 12}
                onClick={() => void makePreview()}
              >
                Preview import
              </ActionButton>
            )}
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <TabBar
            label="Configuration backup actions"
            value={mode}
            onChange={(value) => switchMode(value as 'export' | 'import')}
            tabs={[
              { value: 'export', label: 'Export' },
              { value: 'import', label: 'Import' },
            ]}
          />
          <p className="muted">
            A single AES-256-GCM encrypted JSON file includes website settings, profile login URLs, usernames,
            and passwords. It contains no scan history, session cookies or evidence.
          </p>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          {message && <InlineAlert tone="success">{message}</InlineAlert>}
          {mode === 'export' ? (
            <>
              <fieldset className="space-y-2">
                <legend className="font-semibold">Websites to export</legend>
                <p className="muted text-xs">
                  With none selected, all registered websites will be exported (up to 50).
                </p>
                <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {sites.map((site) => (
                    <label key={site._id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selection.includes(site._id)}
                        onChange={(e) =>
                          setSelection((current) =>
                            e.target.checked
                              ? [...current, site._id]
                              : current.filter((id) => id !== site._id),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <strong>{site.name}</strong>
                        <span className="muted block text-xs break-all">{site.baseUrl}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <ActionButton
                  size="small"
                  onClick={() =>
                    setSelection(selection.length === sites.length ? [] : sites.map((site) => site._id))
                  }
                >
                  {selection.length === sites.length ? 'Clear selection' : 'Select all'}
                </ActionButton>
              </fieldset>
              <label className="block">
                <span className="field-label">Backup encryption password (minimum 12 characters)</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  className="input"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="field-label">Confirm backup password</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  className="input"
                  value={exportConfirm}
                  onChange={(e) => setExportConfirm(e.target.value)}
                />
              </label>
              <p className="muted text-xs">
                <LockKeyhole size={13} className="mr-1 inline" />
                This password is not saved by Website Auditor. Losing it means the backup cannot be decrypted.
              </p>
            </>
          ) : (
            <>
              <label className="block">
                <span className="field-label">Encrypted JSON file</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  className="input"
                  onChange={(e) => void loadFile(e.currentTarget.files?.[0])}
                />
                {filename && <span className="muted text-xs">{filename}</span>}
              </label>
              <label className="block">
                <span className="field-label">Backup password</span>
                <input
                  autoComplete="off"
                  type="password"
                  className="input"
                  value={importPassword}
                  onChange={(e) => {
                    setImportPassword(e.target.value);
                    resetImportPreview();
                  }}
                />
              </label>
              <label className="block">
                <span className="field-label">When the website already exists</span>
                <select
                  className="input"
                  value={strategy}
                  onChange={(e) => {
                    setStrategy(e.target.value as Strategy);
                    resetImportPreview();
                  }}
                >
                  <option value="skip">Skip duplicates (default, safest)</option>
                  <option value="update">Update existing websites and matching profiles</option>
                  <option value="create">Create new only — report conflicts for existing URLs</option>
                </select>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={authorize}
                  onChange={(e) => {
                    setAuthorize(e.target.checked);
                    resetImportPreview();
                  }}
                />
                <span>
                  I own or am authorized to configure all imported websites and their login profiles.
                </span>
              </label>
              {preview && (
                <div className="space-y-2 rounded-xl border p-3" aria-live="polite">
                  <h3 className="font-semibold">Import preview — no changes made yet</h3>
                  <p className="muted text-xs">
                    Websites: {preview.summary.websitesCreate} new · {preview.summary.websitesUpdate} update ·{' '}
                    {preview.summary.websitesSkip} skipped. Profiles: {preview.summary.profilesCreate} new ·{' '}
                    {preview.summary.profilesUpdate} update. Conflicts: {preview.summary.conflicts}.
                  </p>
                  <div className="max-h-52 space-y-3 overflow-y-auto">
                    {preview.websites.map((website) => (
                      <div key={website.baseUrl} className="border-b pb-2 last:border-0">
                        <p>
                          <strong>{website.name}</strong> — {website.action}
                        </p>
                        <p className="muted text-xs break-all">{website.baseUrl}</p>
                        <p className="muted text-xs">
                          Profiles:{' '}
                          {website.profiles
                            .map((profile) => `${profile.name} (${profile.action})`)
                            .join(', ') || 'none'}
                        </p>
                      </div>
                    ))}
                  </div>
                  {preview.summary.conflicts > 0 && (
                    <p className="text-red-600">
                      Resolve duplicate URLs by selecting Update or Skip and preview again.
                    </p>
                  )}
                </div>
              )}
              <p className="muted text-xs">
                <Upload size={13} className="mr-1 inline" />
                Only website/profile configuration changes. Existing scans, findings, and RustFS evidence are
                not imported or overwritten.
              </p>
            </>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmImportOpen}
        title="Import website and authentication profiles?"
        description={`Apply the confirmed configuration? ${preview?.summary.websitesUpdate ?? 0} website(s) and ${preview?.summary.profilesUpdate ?? 0} profile(s) may be updated. Historical scans, findings and evidence remain unchanged.`}
        confirmLabel="Apply import"
        busy={busy}
        onClose={() => setConfirmImportOpen(false)}
        onConfirm={() => {
          setConfirmImportOpen(false);
          void applyImport();
        }}
      />
    </>
  );
}
