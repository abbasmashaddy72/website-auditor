/** Bounded, redacted, authenticated-only offline debugging bundle. */
import { zipEntries } from './zip';
import { diagnosticExportRows } from './diagnostic-export';
import { redactHtml, redactText, redactUrl } from './redact';
import type { PageResult } from './types';

type ArtifactName = 'rendered' | 'original' | 'network' | 'console' | 'screenshot';
export type ArtifactReader = (key: string) => Promise<{ bytes: Buffer; contentType: string }>;
export interface BundleOptions {
  includeScreenshots?: boolean;
  maxBytes?: number;
}
export async function buildEvidenceBundle(
  pages: PageResult[],
  read: ArtifactReader,
  options: BundleOptions = {},
): Promise<Buffer> {
  if (pages.length > 100) throw Error('Evidence bundle exceeds 100 pages; narrow report filters');
  const cap = Math.min(Math.max(options.maxBytes ?? 25_000_000, 1_000_000), 50_000_000);
  let used = 0;
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  const warnings: string[] = [];
  const add = (name: string, bytes: Buffer) => {
    if (bytes.length + used > cap) {
      warnings.push(`${name}: excluded by bundle size limit`);
      return;
    }
    entries.push({ name, bytes });
    used += bytes.length;
  };
  const rows = diagnosticExportRows(pages);
  add('diagnostics.json', Buffer.from(JSON.stringify(rows, null, 2)));
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const stem = `pages/${String(i + 1).padStart(3, '0')}`;
    const expected = `websites/${page.siteId}/scans/${page.scanId}/`;
    const references: Partial<Record<ArtifactName, string>> = {};
    for (const kind of ['rendered', 'original', 'network', 'console', 'screenshot'] as const) {
      if (kind === 'screenshot' && !options.includeScreenshots) continue;
      const key = page.evidence?.[kind];
      if (!key) continue;
      // Never fetch arbitrary RustFS objects supplied by malformed or legacy records.
      if (!key.startsWith(expected) || key.includes('..')) {
        warnings.push(`${stem}: out-of-scope ${kind} evidence reference`);
        continue;
      }
      try {
        const artifact = await read(key);
        if (artifact.bytes.length > 8_000_000) {
          warnings.push(`${stem}: oversized ${kind} omitted`);
          continue;
        }
        const filename =
          kind === 'screenshot'
            ? `${stem}/screenshot.png`
            : kind === 'network' || kind === 'console'
              ? `${stem}/${kind}.json`
              : `${stem}/${kind}.html.txt`;
        const raw = artifact.bytes.toString('utf8');
        const contents =
          kind === 'screenshot'
            ? artifact.bytes
            : kind === 'rendered' || kind === 'original'
              ? Buffer.from(sanitizeSnapshot(raw), 'utf8')
              : Buffer.from(sanitizeEvidenceJson(raw), 'utf8');
        // Explicitly keep offline HTML as text: it must never execute in a browser.
        if (kind === 'screenshot' && !artifact.contentType.startsWith('image/png')) {
          warnings.push(`${stem}: unexpected screenshot format`);
          continue;
        }
        if (used + contents.length > cap) {
          warnings.push(`${stem}: ${kind} excluded by bundle size limit`);
          continue;
        }
        add(filename, contents);
        references[kind] = filename;
      } catch {
        warnings.push(`${stem}: ${kind} not available in evidence storage`);
      }
    }
    add(
      `${stem}/metadata.json`,
      Buffer.from(
        JSON.stringify(
          {
            url: redactUrl(page.url),
            scanId: page.scanId,
            siteId: page.siteId,
            classification: page.classification,
            http: page.status ?? null,
            capturedAt: page.capturedAt,
            artifacts: references,
          },
          null,
          2,
        ),
      ),
    );
  }
  add(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        {
          schema: 'website-auditor-diagnostic-bundle',
          version: 1,
          exportedAt: new Date().toISOString(),
          pages: pages.length,
          includedScreenshots: Boolean(options.includeScreenshots),
          warnings,
          note: 'HTML evidence is stored as inert text. Redaction is best effort: inspect the archive before sharing. Screenshots may contain personal or confidential data.',
        },
        null,
        2,
      ),
    ),
  );
  return zipEntries(entries);
}
/** Keep nested URLs and query secrets out of captured network JSON. */
export function sanitizeEvidenceJson(raw: string): string {
  try {
    const scrub = (value: unknown, key = ''): unknown => {
      if (
        /(?:cookie|authorization|password|secret|token|session|api[_-]?key|credential|requestBody|postData|storageState)/i.test(
          key,
        )
      )
        return '[REDACTED]';
      if (Array.isArray(value)) return value.map((item) => scrub(item));
      if (typeof value === 'string')
        return /^(?:https?:)\/\//.test(value) ? redactUrl(value) : redactText(value);
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
      return value;
    };
    return JSON.stringify(scrub(JSON.parse(raw)), null, 2);
  } catch {
    return redactText(raw);
  }
}

/** Remove form field values from inert developer snapshots as an additional precaution. */
function sanitizeSnapshot(html: string): string {
  return redactHtml(html)
    .replace(/(<input\b[^>]*?)\s+value\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '$1 value="[REDACTED]"')
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, '$1[REDACTED]$2');
}
