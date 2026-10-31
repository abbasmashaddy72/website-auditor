/** Severity derives from the recorded issue, not just the document HTTP code. */
export type FindingEvidence = {
  _id: string;
  category: string;
  message: string;
  url: string;
  latestHttpStatus?: number;
};
export function findingSeverity(
  item: Pick<FindingEvidence, 'category' | 'message' | 'latestHttpStatus'>,
): 'error' | 'warning' {
  const category = item.category.toLowerCase();
  const code = item.latestHttpStatus;
  if (category === 'authentication-expected' && (code === 401 || code === 403)) return 'warning';
  // A recorded failure cannot be erased by an inconsistent later HTTP 200 field.
  if (/\b(?:HTTP|status)\s*5\d\d\b/i.test(item.message)) return 'error';
  if (code !== undefined && code >= 500) return 'error';
  if (
    ['javascript', 'framework', 'network', 'security', 'interaction', 'server', 'authentication'].includes(
      category,
    )
  )
    return 'error';
  if (category === 'http' || category === 'status') {
    if (code === undefined) return 'error';
    if ([401, 403, 404, 408, 409, 410, 422, 429].includes(code)) return 'error';
    return code >= 400 ? 'error' : 'warning';
  }
  if (category === 'console')
    return /error|failed|uncaught|exception|404|500/i.test(item.message || '') ? 'error' : 'warning';
  if (
    [
      'warning',
      'performance',
      'accessibility',
      'seo',
      'informational',
      'best-practice',
      'best_practice',
      'content',
      'assets',
      'ui',
    ].includes(category)
  )
    return 'warning';
  // Unknown categories are not silently downgraded.
  return 'error';
}
/** A diagnostic signature is based on the detected problem, never the affected route.
 * Keep HTTP response codes distinct: 500 and 502 are different root causes.
 * Mask volatile IDs, URLs and counts, preserving original findings and evidence.
 */
export function findingIssueSignature(
  item: Pick<FindingEvidence, 'category' | 'message' | 'latestHttpStatus'>,
): string {
  const category = item.category.trim().toLowerCase() || 'unknown';
  const message = (item.message || 'Unspecified issue')
    .replace(/\bhttps?:\/\/[^\s<>'"`]+/gi, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b[0-9a-f]{24}\b/gi, '[id]')
    .replace(/\b\d+\b/g, (match) => {
      const value = Number(match);
      return match.length === 3 && value >= 100 && value <= 599 ? match : '#';
    })
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  // HTTP status is significant for a network/document error even when its text omits the code.
  const code =
    ['http', 'status', 'network'].includes(category) && item.latestHttpStatus && item.latestHttpStatus >= 400
      ? ` [http:${item.latestHttpStatus}]`
      : '';
  return `${category}: ${message.slice(0, 180)}${code}`;
}

export type FindingGroup = {
  signature: string;
  label: string;
  category: string;
  severity: 'error' | 'warning';
  count: number;
  ids: string[];
  routes: number;
};

/** Group by normalized detected issue rather than URL or scan ID; keep every finding ID. */
export function groupActiveFindings<T extends FindingEvidence>(items: readonly T[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup & { routeSet: Set<string> }>();
  for (const item of items) {
    const signature = findingIssueSignature(item);
    const severity = findingSeverity(item);
    const groupKey = `${severity}|${signature}`;
    let group = groups.get(groupKey);
    if (!group) {
      const prefix = `${item.category.toLowerCase()}:`;
      const label = item.message.trim().toLowerCase().startsWith(prefix)
        ? item.message.trim()
        : `${prefix} ${item.message}`;
      group = {
        signature,
        label,
        category: item.category,
        severity,
        count: 0,
        ids: [],
        routes: 0,
        routeSet: new Set<string>(),
      };
      groups.set(groupKey, group);
    }
    group.count += 1;
    group.ids.push(item._id);
    group.routeSet.add(item.url);
    group.routes = group.routeSet.size;
  }
  return [...groups.values()]
    .map((group) => ({
      signature: group.signature,
      label: group.label,
      category: group.category,
      severity: group.severity,
      count: group.count,
      ids: group.ids,
      routes: group.routes,
    }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
}

/** Count all active records supplied by MongoDB; no front-end pagination is involved. */
export function countFindingSeverities(
  items: Array<Pick<FindingEvidence, 'category' | 'message' | 'latestHttpStatus'>>,
) {
  const result = { error: 0, warning: 0 };
  for (const item of items) result[findingSeverity(item)]++;
  return result;
}
