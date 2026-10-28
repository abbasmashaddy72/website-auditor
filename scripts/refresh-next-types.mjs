#!/usr/bin/env node
/**
 * Next 16 route type validators may continue importing deleted routes.
 * Regenerate only Next's generated type folders, never sources or the build cache.
 * Run sequentially (not concurrently with `next dev` / `next build`).
 */
import { lstatSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generatedRoot = join(root, '.next');
if (existsSync(generatedRoot) && lstatSync(generatedRoot).isSymbolicLink()) {
  throw new Error('Refusing to remove generated types through a .next symlink');
}
for (const folder of [join(generatedRoot, 'types'), join(generatedRoot, 'dev', 'types')]) {
  if (!existsSync(folder)) continue;
  if (lstatSync(folder).isSymbolicLink()) {
    throw new Error(`Refusing to remove generated types through symlink: ${folder}`);
  }
  rmSync(folder, { recursive: true, force: true });
  console.log(`Removed stale generated route types: ${folder}`);
}
