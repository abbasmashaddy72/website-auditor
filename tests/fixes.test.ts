import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchPaths } from '../src/lib/fixes';
test('unified diff source path allowlist', () => {
  const patch =
    'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n';
  assert.deepEqual(patchPaths(patch), ['src/app.ts']);
  assert.throws(() => patchPaths(patch.replaceAll('src/app.ts', '../../.env')));
  assert.throws(() => patchPaths(patch.replaceAll('src/app.ts', 'vendor/file.php')));
});
