import type { PageResult } from './types';
import { redactText, redactUrl } from './redact';

export function buildIssueExport(pages: PageResult[], format: 'csv' | 'json'): string {
  const rows = pages.flatMap((page) =>
    (page.issues.length ? page.issues : [{ category: 'unclassified', message: 'Failed without detail' }]).map(
      (issue) => ({
        websiteId: page.siteId,
        scanId: page.scanId,
        profileId: page.authProfileId || '',
        url: redactUrl(page.url),
        http: page.status ?? '',
        category: issue.category,
        message: redactText(
          typeof issue.message === 'string' ? issue.message : JSON.stringify(issue.message),
        ),
        durationMs: page.durationMs,
        recordedAt: page.capturedAt instanceof Date ? page.capturedAt.toISOString() : String(page.capturedAt),
      }),
    ),
  );
  if (format === 'json') return JSON.stringify(rows, null, 2);
  const header = [
    'Website ID',
    'Scan ID',
    'Profile ID',
    'URL',
    'HTTP',
    'Category',
    'Message',
    'Duration ms',
    'Recorded at',
  ];
  const escape = (v: unknown): string => {
    const text = String(v ?? '');
    // Prevent spreadsheet formula injection, also when cells begin with whitespace.
    const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [header.map(escape).join(','), ...rows.map((r) => Object.values(r).map(escape).join(','))].join(
    '\n',
  );
}
