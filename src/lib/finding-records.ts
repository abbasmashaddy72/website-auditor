import { isFatalWarning } from './page-classification';
import type { PageResult } from './types';

/** Persist both structured issues and textual warnings, even on the same failed page.
 * Do not turn an uncaught exception hidden in a warning string into a warning finding.
 */
export function pageFindings(page: Pick<PageResult, 'classification' | 'issues' | 'warnings'>) {
  const items = [...page.issues];
  const seen = new Set(items.map((item) => `${item.category}|${item.message}`));
  for (const message of page.warnings || []) {
    if (!message.trim()) continue;
    const category = isFatalWarning(message) ? 'framework' : 'warning';
    const key = `${category}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ category, message });
  }
  return items;
}
