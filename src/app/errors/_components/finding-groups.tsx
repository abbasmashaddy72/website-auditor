'use client';
import { useMemo } from 'react';
import { Eye, Layers3 } from 'lucide-react';
import { ActionButton, Card, EmptyState, StatusBadge, Tooltip } from '@/components/ui';
import type { FindingEvidence, FindingGroup } from '@/lib/finding-severity';

type Finding = FindingEvidence & { occurrences?: number };

/** One expandable row per detected issue, independent of affected pages.
 * Selection operates on original IDs, so review and retry history remain intact.
 */
export function FindingGroups<T extends Finding>({
  groups,
  findings,
  selectedIds,
  onSelectionChange,
  onInspect,
}: {
  groups: readonly FindingGroup[];
  findings: readonly T[];
  selectedIds: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  onInspect: (finding: T) => void;
}) {
  const lookup = useMemo(() => new Map(findings.map((finding) => [finding._id, finding])), [findings]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  if (!groups.length) return <EmptyState message="No active findings match the selected filters." />;
  return (
    <div className="space-y-3" aria-label="Findings grouped by detected issue">
      <p className="muted text-xs">
        {groups.length} distinct detected issue types across {findings.length} loaded findings. Expand a group
        to see each affected route and its evidence.
      </p>
      {groups.map((group) => {
        const groupRows = group.ids.map((id) => lookup.get(id)).filter((row): row is T => Boolean(row));
        const allSelected = groupRows.length > 0 && groupRows.every((row) => selectedSet.has(row._id));
        return (
          <Card
            as="article"
            key={`${group.severity}:${group.signature}`}
            className="finding-group overflow-hidden"
          >
            <div className="flex min-w-0 items-start gap-3 p-4">
              <label
                className="finding-group__select mt-1 shrink-0"
                title="Select or deselect all findings in this detected issue group"
              >
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={allSelected}
                  aria-label={`Select all ${group.count} findings for ${group.label}`}
                  onChange={(event) => {
                    const ids = new Set(selectedIds);
                    for (const row of groupRows)
                      event.target.checked ? ids.add(row._id) : ids.delete(row._id);
                    onSelectionChange([...ids]);
                  }}
                />
              </label>
              <details className="group min-w-0 flex-1">
                <summary className="finding-group__summary flex min-w-0 flex-wrap items-center gap-2">
                  <Layers3 size={17} className="shrink-0 text-blue-500" aria-hidden="true" />
                  <strong className="min-w-0 flex-1 text-sm break-words">{group.label}</strong>
                  <StatusBadge status={group.severity} />
                  <span className="muted text-xs">
                    {group.count} findings · {group.routes} routes
                  </span>
                </summary>
                <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
                  {groupRows.map((row) => (
                    <div
                      key={row._id}
                      className="finding-group__row flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium" title={row.url}>
                          {row.url}
                        </div>
                        <div className="muted text-[11px]">
                          HTTP {row.latestHttpStatus ?? '—'} · {row.occurrences ?? 1} occurrence(s)
                        </div>
                      </div>
                      <Tooltip text="Open the original page diagnostics and evidence">
                        <ActionButton size="small" variant="outline" onClick={() => onInspect(row)}>
                          <Eye size={14} /> Inspect
                        </ActionButton>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
