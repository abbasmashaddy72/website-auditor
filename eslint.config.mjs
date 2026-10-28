import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  eslintConfigPrettier,
  globalIgnores([
    '.auditor-fix-backups/**',
    '.auditor-backups/**',
    '.auditor-update-stage/**',
    'storage/test-reports/**',
    'storage/generated/**',
  ]),
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
]);
