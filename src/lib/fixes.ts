import { realpath, mkdir, copyFile, stat, open, lstat } from 'node:fs/promises';
import { join, resolve, sep, dirname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import type { Site, PageResult } from './types';

export async function authorizedSource(site: Site): Promise<string> {
  if (!site.sourcePath) throw Error('This site has no local source-code path');
  if (!process.env.LOCAL_SOURCE_ROOT)
    throw Error('LOCAL_SOURCE_ROOT must explicitly authorize local source inspection');
  const allowed = await realpath(process.env.LOCAL_SOURCE_ROOT),
    actual = await realpath(site.sourcePath);
  if (actual !== allowed && !actual.startsWith(allowed + sep))
    throw Error('Target project is outside LOCAL_SOURCE_ROOT');
  return actual;
}
export async function inspectSource(
  site: Site,
  page: PageResult,
): Promise<{ source: string; hints: string[]; logTail: string }> {
  const source = await authorizedSource(site);
  const hints = page.issues.map((issue) => {
    if (issue.category === 'http' && page.status === 403)
      return 'Inspect route middleware, authentication guards and role/permission policies.';
    if (issue.category === 'http' && page.status === 419)
      return 'Inspect session lifetime, CSRF state and cross-origin cookie configuration.';
    if (issue.category === 'http' && (page.status ?? 0) >= 500)
      return 'Inspect application logs at the matching request timestamp and check the exception stack trace.';
    if (issue.category === 'javascript')
      return 'Inspect browser stack traces, component boundaries and recent asset builds.';
    if (issue.category === 'network')
      return 'Inspect the failing request URL, method, payload and server response.';
    return 'Compare the saved DOM and screenshot against the expected rendering.';
  });
  let logTail = 'No recognized application log found; use browser evidence instead.';
  try {
    const file = join(source, 'storage', 'logs', 'laravel.log');
    const info = await stat(file),
      handle = await open(file, 'r');
    try {
      const size = Math.min(100000, info.size),
        buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, info.size - size);
      logTail = buffer
        .toString('utf8')
        .replace(/(password|authorization|cookie|token|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
    } finally {
      await handle.close();
    }
  } catch {}
  return { source, hints: [...new Set(hints)], logTail };
}
export function patchPaths(patch: string): string[] {
  if (patch.length > 300000) throw Error('Patch exceeds 300KB safety limit');
  if (/^(?:GIT binary patch|Binary files |rename (?:from|to) |copy (?:from|to) )/m.test(patch))
    throw Error('Binary, copy or rename patches are not supported');
  const files = [...patch.matchAll(/^diff --git a\/(.+) b\/([^\n]+)$/gm)].map((m) => {
    if (m[1] !== m[2]) throw Error('Rename patches are unsupported');
    return m[1];
  });
  if (!files.length) throw Error('No unified Git patch paths were found');
  for (const file of files) {
    if (
      file.includes('..') ||
      file.includes('\\') ||
      file.startsWith('/') ||
      file.includes('\0') ||
      isAbsolute(file) ||
      /(^|\/)(?:\.git|\.env[^/]*|vendor|node_modules|storage|\.next|public\/uploads)(\/|$)/.test(file)
    )
      throw Error(`Forbidden file path: ${file}`);
    if (!/\.(?:php|blade\.php|ts|tsx|js|jsx|vue|css|scss)$/.test(file))
      throw Error(`Only source-code files may be patched: ${file}`);
  }
  return [...new Set(files)];
}
async function gitApply(cwd: string, patch: string, check: boolean): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const args = ['apply', ...(check ? ['--check'] : []), '--whitespace=error', '-'];
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    });
    let err = '';
    child.stderr.on('data', (v) => {
      err += v.toString().slice(0, 5000);
    });
    child.stdout.on('data', () => {});
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(Error(`git apply ${check ? '--check ' : ''}failed: ${err.slice(0, 2000)}`)),
    );
    child.stdin.end(patch);
  });
}
export async function validatePatch(site: Site, patch: string): Promise<{ paths: string[]; source: string }> {
  const source = await authorizedSource(site),
    paths = patchPaths(patch);
  for (const path of paths) {
    const absolute = resolve(source, path);
    if (!absolute.startsWith(source + sep)) throw Error('Unsafe file path');
    // Guard symlink traversal on all existing components.
    let part = source;
    for (const name of path.split('/')) {
      part = join(part, name);
      try {
        if ((await lstat(part)).isSymbolicLink()) throw Error(`Symlink in patch path: ${path}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw e;
      }
    }
  }
  await gitApply(source, patch, true);
  return { paths, source };
}
export async function applyApprovedPatch(
  site: Site,
  patch: string,
  proposalId: string,
): Promise<{ backup: string; paths: string[] }> {
  const { source, paths } = await validatePatch(site, patch);
  const backup = resolve(process.cwd(), '.auditor-backups', proposalId);
  for (const path of paths) {
    const from = join(source, path);
    try {
      await stat(from);
      await mkdir(dirname(join(backup, path)), { recursive: true });
      await copyFile(from, join(backup, path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  await gitApply(source, patch, false);
  return { backup, paths };
}
