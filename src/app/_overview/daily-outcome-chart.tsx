/** Compact dashboard-only visualization; no navigation tables or evidence viewers. */
export type DailyOutcome = { day: string; passed: number; warnings: number; failed: number };
export default function DailyOutcomeChart({ buckets, label }: { buckets: DailyOutcome[]; label: string }) {
  const peak = Math.max(1, ...buckets.map((b) => b.passed + b.warnings + b.failed));
  const totals = buckets.reduce(
    (a, b) => ({
      passed: a.passed + b.passed,
      warnings: a.warnings + b.warnings,
      failed: a.failed + b.failed,
    }),
    { passed: 0, warnings: 0, failed: 0 },
  );
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Daily page results</h3>
          <p className="muted text-xs">{label} · measured observations only</p>
        </div>
        <span className="muted text-xs tabular-nums">
          {totals.passed} passed · {totals.warnings} warnings · {totals.failed} failed
        </span>
      </div>
      <div
        className="flex items-end justify-between gap-1 overflow-x-auto pb-2"
        role="img"
        aria-label={`Daily audit observations: ${totals.passed} passed, ${totals.warnings} warnings and ${totals.failed} failed`}
      >
        {buckets.map((b) => {
          const total = b.passed + b.warnings + b.failed;
          const height = total ? Math.max(6, (total / peak) * 100) : 0;
          return (
            <div
              key={b.day}
              className="flex min-w-7 flex-1 flex-col items-center justify-end gap-2"
              title={`${b.day}: ${b.passed} passed, ${b.warnings} warnings, ${b.failed} failed`}
            >
              <span className="muted text-[10px] tabular-nums">{total || '·'}</span>
              <div className="flex h-26 w-full max-w-7 flex-col justify-end rounded bg-[var(--hover)] p-[1px]">
                <div
                  className="flex w-full flex-col overflow-hidden rounded-t-sm"
                  style={{ height: `${height}%` }}
                >
                  {total > 0 && (
                    <>
                      {b.failed > 0 && (
                        <div className="bg-rose-500" style={{ height: `${(b.failed / total) * 100}%` }} />
                      )}
                      {b.warnings > 0 && (
                        <div className="bg-amber-400" style={{ height: `${(b.warnings / total) * 100}%` }} />
                      )}
                      {b.passed > 0 && (
                        <div className="bg-emerald-500" style={{ height: `${(b.passed / total) * 100}%` }} />
                      )}
                    </>
                  )}
                </div>
              </div>
              <span className="muted text-[10px] tabular-nums">{b.day.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <p className="muted text-right text-[11px]">Maximum observed: {peak} pages/day</p>
    </div>
  );
}
