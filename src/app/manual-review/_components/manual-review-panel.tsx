'use client';
import { useMemo, useState } from 'react';
import { CheckSquare, Download, Eye } from 'lucide-react';
import type { TableColumn } from '@/components/ui';
import {
  ActionButton,
  Dialog,
  Tooltip,
  TabBar,
  TextInput,
  SelectInput,
  TextAreaInput,
  CheckInput,
  InlineAlert,
  DataTable,
} from '@/components/ui';

type ReviewEvent = {
  id: string;
  at: string;
  actor: string;
  decision: string;
  from: string;
  to: string;
  reviewState: string;
  comment: string;
};
export type Finding = {
  _id: string;
  siteId: string;
  url: string;
  category: string;
  message: string;
  status: string;
  reviewState?: string;
  reviewHistory?: ReviewEvent[];
  lastDetectedAt: string;
};
const decisions = [
  { value: 'reviewed', label: 'Mark reviewed' },
  { value: 'confirmed', label: 'Confirm issue' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'accepted', label: "Accept / Won't fix" },
  { value: 'reopen', label: 'Reopen investigation' },
  { value: 'return_active', label: 'Return to active errors' },
  { value: 'rollback', label: 'Roll back last review decision' },
] as const;
export default function ManualReviewPanel({
  findings,
  onChanged,
  siteName,
}: {
  findings: Finding[];
  onChanged: () => Promise<void>;
  siteName: (id: string) => string;
}) {
  const [siteId, setSiteId] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Finding | null>(null);
  const [decision, setDecision] = useState('reviewed');
  const [reason, setReason] = useState('');
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewTab, setReviewTab] = useState<'active' | 'history'>('active');
  const visible = useMemo(
    () =>
      findings.filter(
        (f) =>
          (reviewTab === 'active' ? f.status === 'manual_review' : Boolean(f.reviewHistory?.length)) &&
          (!siteId || f.siteId === siteId) &&
          `${f.url} ${f.message} ${f.reviewState || ''}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [findings, reviewTab, siteId, query],
  );
  const eligible = visible.filter((f) => f.status === 'manual_review');
  const allSelected = eligible.length > 0 && eligible.every((f) => selected.includes(f._id));
  const scopes = [...new Set(findings.map((f) => f.siteId))];
  function openDecision(next: string, ids: string[]) {
    setSelected(ids);
    setDecision(next);
    setReason('');
    setError('');
    setDialog(true);
  }
  async function submit() {
    if (
      ['false_positive', 'accepted', 'reopen', 'return_active', 'rollback'].includes(decision) &&
      reason.trim().length < 3
    ) {
      setError('A reason of at least 3 characters is required for this decision.');
      return;
    }
    const allowedIds = selected.filter((id) =>
      (decision === 'rollback' ? visible : eligible).some((f) => f._id === id),
    );
    if (!allowedIds.length) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/issues/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIds: allowedIds, decision, comment: reason }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      if (data.failed)
        throw Error(
          `${data.updated} saved; ${data.failed} failed. ${data.results?.find((x: { error?: string }) => x.error)?.error || ''}`,
        );
      setNotice(`${data.updated} finding(s) updated. Review history preserved.`);
      setSelected([]);
      setDialog(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const reviewColumns: TableColumn<Finding>[] = [
    {
      id: 'select',
      header: 'Choose',
      sortable: false,
      render: (finding) => (
        <CheckInput
          aria-label={`Select ${finding.url}`}
          disabled={finding.status !== 'manual_review'}
          checked={selected.includes(finding._id)}
          onChange={(event) =>
            setSelected((previous) =>
              event.target.checked
                ? [...new Set([...previous, finding._id])]
                : previous.filter((id) => id !== finding._id),
            )
          }
        />
      ),
    },
    {
      id: 'finding',
      header: 'Finding',
      accessor: (finding) => finding.message,
      render: (finding) => (
        <>
          <div className="max-w-[540px] font-semibold wrap-break-word">{finding.message}</div>
          <div className="muted mt-1 text-xs">
            {siteName(finding.siteId)} · {finding.url}
          </div>
          <div className="muted text-xs">
            Latest: {finding.reviewHistory?.at(-1)?.comment || 'No review comments'}
          </div>
        </>
      ),
    },
    {
      id: 'status',
      header: 'Review status',
      accessor: (finding) => finding.reviewState || finding.status,
      render: (finding) => (
        <span className="pill manual_review">
          {finding.reviewState || (finding.status === 'manual_review' ? 'pending' : 'previously reviewed')}
        </span>
      ),
    },
    {
      id: 'seen',
      header: 'Last seen',
      accessor: (finding) => new Date(finding.lastDetectedAt),
      render: (finding) => (
        <span className="text-xs">{new Date(finding.lastDetectedAt).toLocaleString()}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      sortable: false,
      render: (finding) => (
        <div className="flex flex-wrap gap-2">
          <Tooltip text="Inspect review decisions and comments without changing evidence">
            <ActionButton size="small" onClick={() => setDetail(finding)}>
              <Eye size={14} /> History
            </ActionButton>
          </Tooltip>
          {finding.status === 'manual_review' && (
            <>
              <ActionButton
                variant="primary"
                size="small"
                onClick={() => openDecision('reviewed', [finding._id])}
              >
                Review
              </ActionButton>
              <ActionButton size="small" onClick={() => openDecision('confirmed', [finding._id])}>
                Confirm
              </ActionButton>
              <ActionButton size="small" onClick={() => openDecision('false_positive', [finding._id])}>
                False positive
              </ActionButton>
              <ActionButton size="small" onClick={() => openDecision('accepted', [finding._id])}>
                Accept
              </ActionButton>
              <ActionButton size="small" onClick={() => openDecision('return_active', [finding._id])}>
                Return active
              </ActionButton>
            </>
          )}
          {finding.status !== 'manual_review' && Boolean(finding.reviewHistory?.length) && (
            <ActionButton size="small" onClick={() => openDecision('rollback', [finding._id])}>
              Rollback
            </ActionButton>
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="muted text-sm">
            Decisions and comments are appended to an immutable review timeline.
          </p>
        </div>
        <div className="flex gap-2">
          {(['csv', 'json', 'html', 'xlsx'] as const).map((format) => (
            <Tooltip key={format} text={`Export review comments and history as ${format.toUpperCase()}`}>
              <a
                className="btn"
                href={`/api/exports/reviews?format=${format}${siteId ? `&siteId=${siteId}` : ''}`}
              >
                <Download size={14} />
                {format.toUpperCase()}
              </a>
            </Tooltip>
          ))}
        </div>
      </div>
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {error && !dialog && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="surface flex flex-wrap items-end gap-3 p-4">
        <label className="flex-1">
          <span className="field-label">Search review findings</span>
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find URL, decision or description"
          />
        </label>
        <label className="min-w-[180px]">
          <span className="field-label">Website</span>
          <SelectInput
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setSelected([]);
            }}
          >
            <option value="">All websites</option>
            {scopes.map((id) => (
              <option key={id} value={id}>
                {siteName(id)}
              </option>
            ))}
          </SelectInput>
        </label>
        <TabBar
          label="Manual Review scope"
          value={reviewTab}
          onChange={(next) => {
            setReviewTab(next as 'active' | 'history');
            setSelected([]);
          }}
          tabs={[
            {
              value: 'active',
              label: 'Pending and reviewed',
              count: findings.filter((f) => f.status === 'manual_review').length,
            },
            {
              value: 'history',
              label: 'Decision history',
              count: findings.filter((f) => Boolean(f.reviewHistory?.length)).length,
            },
          ]}
        />
      </div>
      <div className="surface flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2 text-sm">
          <CheckInput
            aria-label="Select all eligible review findings"
            checked={allSelected}
            onChange={(e) => setSelected(e.target.checked ? eligible.map((f) => f._id) : [])}
          />
          Select all eligible ({eligible.length})
        </label>
        <span className="muted text-sm">{selected.length} selected</span>
        <ActionButton disabled={!selected.length} onClick={() => openDecision('reviewed', selected)}>
          <CheckSquare size={14} />
          Review selected
        </ActionButton>
      </div>
      <DataTable
        rows={visible}
        rowKey={(finding) => finding._id}
        caption="Manual Review findings"
        initialSort="seen"
        initialDirection="desc"
        columns={reviewColumns}
        emptyMessage="No Manual Review findings match these filters."
      />
      <Dialog
        open={Boolean(detail)}
        title="Finding review history"
        onClose={() => setDetail(null)}
        footer={<ActionButton onClick={() => setDetail(null)}>Close</ActionButton>}
      >
        {detail && (
          <div className="space-y-4">
            <p className="text-sm break-all">{detail.url}</p>
            <p className="text-sm">{detail.message}</p>
            <a className="btn" href={`/routes?site=${encodeURIComponent(detail.siteId)}`}>
              View protected historical routes and evidence
            </a>
            <ol className="space-y-3">
              {(detail.reviewHistory || []).map((event) => (
                <li
                  key={event.id}
                  className="rounded-lg border p-3 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <strong>{event.decision.replaceAll('_', ' ')}</strong>
                  <div className="muted text-xs">
                    {new Date(event.at).toLocaleString()} · {event.actor} · {event.from} → {event.to}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{event.comment || 'No comment'}</p>
                </li>
              ))}
            </ol>
            {!(detail.reviewHistory || []).length && (
              <p className="muted text-sm">Historical finding; no review events recorded yet.</p>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={dialog}
        title="Confirm Manual Review decision"
        onClose={() => !busy && setDialog(false)}
        footer={
          <>
            <ActionButton disabled={busy} onClick={() => setDialog(false)}>
              Cancel
            </ActionButton>
            <ActionButton variant="primary" loading={busy} onClick={() => void submit()}>
              Confirm {decision.replaceAll('_', ' ')}
            </ActionButton>
          </>
        }
      >
        <p className="text-sm">
          Apply this decision to {selected.length} finding(s). Original scan evidence and all prior review
          events will be retained.
        </p>
        <label className="mt-3 block">
          <span className="field-label">Decision</span>
          <SelectInput value={decision} onChange={(e) => setDecision(e.target.value)}>
            {decisions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="mt-3 block">
          <span className="field-label">
            Reason / comment{' '}
            {['false_positive', 'accepted', 'reopen', 'return_active', 'rollback'].includes(decision) &&
              '(required)'}
          </span>
          <TextAreaInput
            className="min-h-28"
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-500">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  );
}
