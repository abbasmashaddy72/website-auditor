import { buildXlsx } from './xlsx-export';
import type { Issue } from './types';
import { redactText, redactUrl } from './redact';

export function safeCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reviewExportRows(findings: Issue[]) {
  return findings.map((finding) => ({
    id: finding._id?.toString() || '',
    websiteId: finding.siteId,
    scanId: finding.scanId,
    pageId: finding.pageId,
    profileId: finding.authProfileId || '',
    url: redactUrl(finding.url),
    category: finding.category,
    message: redactText(finding.message),
    http: finding.latestHttpStatus ?? '',
    status: finding.status,
    reviewState: finding.reviewState || '',
    firstDetectedAt: finding.firstDetectedAt,
    lastDetectedAt: finding.lastDetectedAt,
    occurrences: finding.occurrences,
    history: (finding.reviewHistory || []).map(
      ({ id, at, actor, decision, from, to, reviewState, comment }) => ({
        id,
        at,
        actor,
        decision,
        from,
        to,
        reviewState,
        comment: redactText(comment),
      }),
    ),
  }));
}
export function buildReviewExport(findings: Issue[], format: 'json' | 'csv' | 'html') {
  const rows = reviewExportRows(findings);
  if (format === 'json') return JSON.stringify(rows, null, 2);
  const headings = [
    'id',
    'websiteId',
    'scanId',
    'pageId',
    'profileId',
    'url',
    'category',
    'message',
    'http',
    'status',
    'reviewState',
    'firstDetectedAt',
    'lastDetectedAt',
    'occurrences',
    'history',
  ];
  if (format === 'csv')
    return [
      headings.map(safeCsvCell).join(','),
      ...rows.map((row) =>
        headings
          .map((key) =>
            safeCsvCell(key === 'history' ? JSON.stringify(row.history) : row[key as keyof typeof row]),
          )
          .join(','),
      ),
    ].join('\n');
  const escapeHtml = (value: unknown) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character,
    );
  const body = rows
    .map(
      (row) =>
        `<tr>${headings
          .map(
            (key) =>
              `<td>${escapeHtml(
                key === 'history'
                  ? row.history.map((e) => `${e.at}: ${e.decision} — ${e.comment}`).join(' | ')
                  : row[key as keyof typeof row],
              )}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Website Auditor Manual Reviews</title><style>body{font:14px system-ui;margin:2rem;color:#172337}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:8px;text-align:left;overflow-wrap:anywhere}tr:nth-child(even){background:#f4f6fa}@media print{body{margin:0.5cm}}</style></head><body><h1>Website Auditor · Manual Review</h1><p>${rows.length} findings · Generated ${escapeHtml(new Date().toISOString())}</p><table><thead><tr>${headings.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** Separate decision history is preserved inside a literal (non-formula) Excel text cell. */
export function buildReviewWorkbook(findings: Issue[]): Buffer {
  const headings = [
    'id',
    'websiteId',
    'scanId',
    'pageId',
    'profileId',
    'url',
    'category',
    'message',
    'http',
    'status',
    'reviewState',
    'firstDetectedAt',
    'lastDetectedAt',
    'occurrences',
    'history',
  ] as const;
  const rows = reviewExportRows(findings);
  return buildXlsx(
    [...headings],
    rows.map((row) =>
      headings.map((key) => {
        const value = row[key];
        return Array.isArray(value) ? JSON.stringify(value) : value;
      }),
    ),
    'Manual Reviews',
  );
}
