import { lookup } from 'node:dns/promises';
import type { Site } from './types';

export function normalizeUrl(raw: string): string {
  const candidate = /^[a-z][\w+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const u = new URL(candidate);
  if (!['http:', 'https:'].includes(u.protocol)) throw Error('Only HTTP and HTTPS are supported');
  if (u.username || u.password) throw Error('Embedded URL credentials are not permitted');
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if (!u.pathname) u.pathname = '/';
  return u.toString();
}
export function effectivePort(url: URL): number {
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}
export function isLoopback(ip: string): boolean {
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
}
export function isPrivate(ip: string): boolean {
  if (isLoopback(ip)) return true;
  if (ip.includes(':')) {
    const s = ip.toLowerCase();
    return (
      s === '::' ||
      s.startsWith('fe80:') ||
      s.startsWith('fc') ||
      s.startsWith('fd') ||
      s.startsWith('::ffff:10.') ||
      s.startsWith('::ffff:192.168.') ||
      s.startsWith('::ffff:172.')
    );
  }
  const p = ip.split('.').map(Number);
  return (
    p[0] === 10 ||
    p[0] === 0 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    p[0] >= 224
  );
}
function metadataBlocked(ip: string) {
  return (
    ip === '169.254.169.254' || ip === '100.100.100.200' || ip === '168.63.129.16' || ip === '169.254.170.2'
  );
}
export async function assertTargetAllowed(raw: string, site: Site): Promise<URL> {
  const normalized = normalizeUrl(raw);
  const url = new URL(normalized);
  if (!site.allowedHosts.some((h) => h.toLowerCase() === url.hostname))
    throw Error(`Host out of scope: ${url.hostname}`);
  if (!site.allowedPorts.includes(effectivePort(url)))
    throw Error(`Port out of scope: ${effectivePort(url)}`);
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) throw Error(`DNS returned no addresses: ${url.hostname}`);
  for (const { address } of records) {
    if (metadataBlocked(address) || address === '::') throw Error('Sensitive network destination blocked');
    if (isLoopback(address) && !site.allowLocalhost)
      throw Error(`Loopback access not approved for ${url.hostname}`);
    if (isPrivate(address) && !isLoopback(address) && !site.allowPrivateNetwork)
      throw Error(`Private/LAN address not approved: ${address}`);
  }
  return url;
}
export function sameHost(a: string, b: string): boolean {
  return new URL(a).host === new URL(b).host;
}
export function canonicalLink(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    u.searchParams.sort();
    return normalizeUrl(u.toString());
  } catch {
    return null;
  }
}
/** A downloadable/static resource or framework endpoint is not a browser page. */
export function isCrawlablePageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const path = decodeURIComponent(url.pathname).toLowerCase();
    const assetExtension =
      /\.(?:js|mjs|cjs|css|map|json|xml|txt|md|pdf|csv|zip|gz|tar|7z|rar|png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot|mp[34]|webm|mov|wav|ogg|wasm)(?:$|\/)/i;
    const assetDirectory =
      /(?:^|\/)(?:_next|_nuxt|build\/assets|vendor|storage|assets|node_modules)(?:\/|$)/i;
    const frameworkEndpoint = /^\/(?:api|livewire(?:-[a-z0-9]+)?|_debugbar|telescope|horizon\/api)(?:\/|$)/i;
    return !assetExtension.test(path) && !assetDirectory.test(path) && !frameworkEndpoint.test(path);
  } catch {
    return false;
  }
}

export function isSafeLink(url: string): boolean {
  const u = new URL(url);
  const text = `${u.pathname}${u.search}`.toLowerCase();
  return !/(^|[\/_?&=.-])(logout|signout|delete|destroy|remove|payment|checkout|purchase|import|export|trigger|run-job|unsubscribe|reset-password)([\/_?&=.-]|$)/.test(
    text,
  );
}

// Approved scope entries may be bare hostnames, host:port, or complete HTTP(S) URLs.
// URL paths are NOT used as discovery seed routes; register them in an auth profile.
export function parseAllowedHosts(entries: string[]): { hosts: string[]; ports: number[] } {
  const hosts = new Set<string>(),
    ports = new Set<number>();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const parsed = new URL(/^[a-z][\w+.-]*:\/\//i.test(entry) ? entry : `https://${entry}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw Error('Only approved HTTP(S) host entries without credentials are supported');
    const host = parsed.hostname.toLowerCase();
    if (!host || host.includes('*') || /[\s/]/.test(host)) throw Error(`Invalid host scope entry: ${entry}`);
    hosts.add(host);
    if (entry.includes('://') || parsed.port) ports.add(effectivePort(parsed));
  }
  return { hosts: [...hosts], ports: [...ports] };
}
