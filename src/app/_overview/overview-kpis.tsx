import { Activity, AlertTriangle, CheckCircle2, Globe2, ScanSearch } from 'lucide-react';
import { Card } from '@/components/ui';

export type OverviewTotals = {
  sites?: number;
  scans?: number;
  issues?: number;
  resolved?: number;
  activeScans?: number;
};

/** Overview contains summary KPIs only; detailed lists belong in their own workspaces. */
export function OverviewKpis({ totals }: { totals: OverviewTotals | null }) {
  const items = [
    { label: 'Registered websites', value: totals?.sites, icon: Globe2 },
    { label: 'Total scans', value: totals?.scans, icon: ScanSearch },
    { label: 'Active findings', value: totals?.issues, icon: AlertTriangle },
    { label: 'Resolved findings', value: totals?.resolved, icon: CheckCircle2 },
    { label: 'Active scans', value: totals?.activeScans, icon: Activity },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Audit summary">
      {items.map(({ label, value, icon: Icon }) => (
        <Card key={label} className="min-w-0 p-4 lg:p-5" aria-label={label}>
          <div className="flex items-center justify-between gap-2">
            <span className="muted text-xs">{label}</span>
            <Icon size={19} className="shrink-0 text-[#6a8be1]" aria-hidden="true" />
          </div>
          <div className="mt-3 text-[26px] font-bold tracking-tight tabular-nums">
            {typeof value === 'number' ? value.toLocaleString() : '—'}
          </div>
        </Card>
      ))}
    </div>
  );
}
