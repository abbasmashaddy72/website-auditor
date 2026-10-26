import type { PageResult, Scan, Site } from './types';
import { escapeHtml, redactText, redactUrl } from './redact';
import { putEvidence } from './storage';
export function generateReport(site: Site, scan: Scan, pages: PageResult[]): string {
  const counts = {
    passed: pages.filter((p) => p.classification === 'passed').length,
    warning: pages.filter((p) => p.classification === 'warning').length,
    failed: pages.filter((p) => p.classification === 'failed').length,
  };
  const rows = pages
    .map(
      (p) =>
        `<tr data-class="${p.classification}"><td>${escapeHtml(p.classification)}</td><td>${p.status ?? 'network'}</td><td><a href="${escapeHtml(redactUrl(p.url))}" rel="noopener noreferrer">${escapeHtml(redactUrl(p.url))}</a></td><td>${p.durationMs} ms</td><td>${escapeHtml(
          redactText(
            p.issues
              .map((e) => e.message)
              .join('; ')
              .slice(0, 500),
          ),
        )}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website Audit · ${escapeHtml(site.name)}</title><style>body{font:14px system-ui;margin:3rem auto;max-width:1280px;padding:0 1rem;color:#1c2432;background:#f7f9fc}h1{font-size:2rem}.summary{display:flex;gap:1rem;flex-wrap:wrap}.summary b{padding:1rem;background:white;border:1px solid #ddd;border-radius:8px}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}tr[data-class=failed]{background:#fff0f0}tr[data-class=warning]{background:#fffae8}input{padding:12px;width:100%;margin:1rem 0}small{color:#666}@media(prefers-color-scheme:dark){body{background:#10141c;color:#eee}table,.summary b{background:#1d2430;color:#eee}tr[data-class=failed]{background:#422}tr[data-class=warning]{background:#453c24}}</style></head><body><h1>Website audit: ${escapeHtml(site.name)}</h1><p>${escapeHtml(site.environment)} · ${escapeHtml(redactUrl(site.baseUrl))} · ${new Date().toISOString()} · Profile: ${escapeHtml(scan.authProfileName || (scan.authProfileId ? 'Authenticated' : 'Unauthenticated'))}</p><div class="summary"><b>${pages.length} visited</b><b>${counts.passed} passed</b><b>${counts.warning} warnings</b><b>${counts.failed} failed</b></div><label for="search">Search results</label><input id="search" oninput="filterRows(this.value)" placeholder="Filter URL, issue or status"><table><thead><tr><th>Result</th><th>HTTP</th><th>Page</th><th>Time</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table><p><small>Static report. Private evidence, authentication and full browser traces are available only through the protected auditor dashboard.</small></p><script>function filterRows(q){document.querySelectorAll('tbody tr').forEach(r=>{r.hidden=!r.textContent.toLowerCase().includes(q.toLowerCase())})}</script></body></html>`;
}
export function pagesCsv(pages: PageResult[], profileName = 'Unauthenticated'): string {
  const field = (v: unknown) =>
    `"${String(v ?? '')
      .replaceAll('"', '""')
      .replace(/^[=+@-]/, '\u0027$&')}"`;
  return [
    ['Profile', 'URL', 'HTTP', 'Result', 'Duration ms', 'Issues'].map(field).join(','),
    ...pages.map((p) =>
      [
        profileName,
        redactUrl(p.url),
        p.status ?? '',
        p.classification,
        p.durationMs,
        redactText(p.issues.map((i) => i.message).join(' | ')),
      ]
        .map(field)
        .join(','),
    ),
  ].join('\n');
}
export async function persistReports(
  site: Site,
  scan: Scan,
  pages: PageResult[],
): Promise<Record<string, string>> {
  const prefix = `websites/${site._id}/scans/${scan._id}/reports`;
  const keys = { html: `${prefix}/index.html`, json: `${prefix}/results.json`, csv: `${prefix}/results.csv` };
  await Promise.all([
    putEvidence(keys.html, generateReport(site, scan, pages), 'text/html'),
    putEvidence(
      keys.json,
      JSON.stringify(
        pages.map((p) => ({
          ...p,
          authProfileName: scan.authProfileName || (scan.authProfileId ? 'Authenticated' : 'Unauthenticated'),
          url: redactUrl(p.url),
          finalUrl: redactUrl(p.finalUrl),
          issues: p.issues.map((v) => ({ ...v, message: redactText(v.message) })),
          consoleErrors: p.consoleErrors.map(redactText),
          pageErrors: p.pageErrors.map(redactText),
          failedRequests: p.failedRequests.map((r) => ({
            ...r,
            url: redactUrl(r.url),
            failure: r.failure ? redactText(r.failure) : undefined,
          })),
          redirects: p.redirects.map((r) => ({ ...r, url: redactUrl(r.url) })),
          discoveredLinks: undefined,
        })),
        null,
        2,
      ),
      'application/json',
    ),
    putEvidence(
      keys.csv,
      pagesCsv(pages, scan.authProfileName || (scan.authProfileId ? 'Authenticated' : 'Unauthenticated')),
      'text/csv',
    ),
  ]);
  return keys;
}
