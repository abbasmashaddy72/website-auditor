import { canonicalLink, isSafeLink, isCrawlablePageUrl } from './scope';
export function parseImportedRoutes(
  text: string,
  format: 'json' | 'csv' | 'txt',
  baseUrl: string,
): { urls: string[]; skipped: string[] } {
  let values: string[] = [];
  if (format === 'json') {
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) throw Error('Routes JSON must be an array');
    values = data.flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (!item || typeof item !== 'object') return [];
      const route = item as Record<string, unknown>;
      const method = String(route.method || 'GET').split('|');
      if (!method.includes('GET')) return [];
      return [String(route.uri || route.path || route.url || '')];
    });
  } else if (format === 'csv') {
    const lines = text.split(/\r?\n/);
    values = lines.slice(0, 2001).map((l) => l.split(',')[0]?.replace(/^"|"$/g, '').trim());
    if (/^(url|uri|path|route)$/i.test(values[0] || '')) values.shift();
  } else
    values = text
      .split(/\r?\n/)
      .slice(0, 2001)
      .map((v) => v.trim());
  const urls = new Set<string>(),
    skipped: string[] = [];
  for (const raw of values.slice(0, 2000)) {
    if (!raw || raw.startsWith('#') || /[{}*]/.test(raw) || /^api\//i.test(raw.replace(/^\//, ''))) {
      if (raw) skipped.push(raw);
      continue;
    }
    const url = canonicalLink(raw, baseUrl);
    if (!url || !isSafeLink(url) || !isCrawlablePageUrl(url)) {
      skipped.push(raw);
      continue;
    }
    if (new URL(url).hostname !== new URL(baseUrl).hostname) {
      skipped.push(raw);
      continue;
    }
    urls.add(url);
  }
  return { urls: [...urls], skipped };
}
