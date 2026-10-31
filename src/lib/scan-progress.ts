import type { PageResult, Scan } from './types';

/** Partition unique persisted page observations; findings are separate records. */
export function summarizeScanProgress(
  pages: readonly Pick<PageResult, 'classification'>[],
  discovered: number,
  skipped = 0,
): Scan['progress'] {
  const passed = pages.filter((page) => page.classification === 'passed').length;
  const failed = pages.filter((page) => page.classification === 'failed').length;
  const warnings = pages.filter((page) => page.classification === 'warning').length;
  const visited = pages.length;
  return {
    visited,
    passed,
    failed,
    warnings,
    discovered: Math.max(discovered, visited + skipped),
    skipped,
  };
}
