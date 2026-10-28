import { buildXlsx } from './xlsx-export';
import type { PageResult } from './types';
import { redactText, redactUrl, escapeHtml } from './redact';
import { safeCsvCell } from './review-export';
import { publicPerformance } from './performance';
export type DiagnosticExportFormat = 'csv' | 'json' | 'html';
export function diagnosticExportRows(pages: PageResult[]) {
  return pages.map((page) => ({
    websiteId: page.siteId,
    scanId: page.scanId,
    profileId: page.authProfileId || '',
    url: redactUrl(page.url),
    finalUrl: redactUrl(page.finalUrl),
    title: redactText(page.title),
    http: page.status ?? '',
    classification: page.classification,
    durationMs: page.durationMs,
    capturedAt: page.capturedAt,
    issues: page.issues.map((i) => `${redactText(i.category)}: ${redactText(String(i.message))}`),
    warnings: (page.warnings || []).map(redactText),
    consoleErrors: page.consoleErrors.map(redactText),
    pageErrors: page.pageErrors.map(redactText),
    failedRequests: page.failedRequests.map((r) => ({
      url: redactUrl(r.url),
      method: r.method,
      status: r.status,
      failure: r.failure ? redactText(r.failure) : undefined,
    })),
    performance: page.performance ? publicPerformance(page.performance) : undefined,
    evidence: Object.keys(page.evidence || {}), // No RustFS keys in unrestricted exports.
  }));
}
export function buildDiagnosticExport(pages: PageResult[], format: DiagnosticExportFormat): string {
  const rows = diagnosticExportRows(pages);
  if (format === 'json') return JSON.stringify(rows, null, 2);
  const keys: Array<keyof (typeof rows)[number]> = [
    'websiteId',
    'scanId',
    'profileId',
    'url',
    'finalUrl',
    'title',
    'http',
    'classification',
    'durationMs',
    'capturedAt',
    'issues',
    'warnings',
    'consoleErrors',
    'pageErrors',
    'failedRequests',
    'performance',
    'evidence',
  ];
  const field = (row: (typeof rows)[number], key: (typeof keys)[number]) => {
    const v = row[key];
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
  };
  if (format === 'csv')
    return [
      keys.map(safeCsvCell).join(','),
      ...rows.map((r) => keys.map((key) => safeCsvCell(field(r, key))).join(',')),
    ].join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Website Auditor · Diagnostics</title><style>body{font:14px system-ui;max-width:1600px;margin:2rem auto;padding:1rem;color:#172337}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere}thead{background:#e9eefb}@media print{body{margin:.5cm;font-size:10px}}</style></head><body><h1>Website Auditor · Page Diagnostics</h1><p>${rows.length} saved page records · ${escapeHtml(new Date().toISOString())}</p><table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${escapeHtml(field(row, key))}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Private screenshots, HTML snapshots and traces remain available only in the authenticated dashboard.</p></body></html>`;
}

/** Portable Excel diagnostics, with the same sanitized fields as JSON/CSV/HTML. */
export function buildDiagnosticWorkbook(pages: PageResult[]): Buffer {
  const keys = [
    'websiteId',
    'scanId',
    'profileId',
    'url',
    'finalUrl',
    'title',
    'http',
    'classification',
    'durationMs',
    'capturedAt',
    'issues',
    'warnings',
    'consoleErrors',
    'pageErrors',
    'failedRequests',
    'performance',
    'evidence',
  ] as const;
  const rows = diagnosticExportRows(pages);
  return buildXlsx(
    [...keys],
    rows.map((row) =>
      keys.map((key) => {
        const value = row[key];
        return typeof value === 'object' && value !== null && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    ),
    'Page Diagnostics',
  );
}
