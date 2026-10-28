import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { safeConfigBackupError } from '../src/lib/config-backup-api';
test('wrong backup password is distinguishable without revealing secrets', () => {
  const result = safeConfigBackupError(Error('Incorrect backup password or invalid encrypted backup'));
  assert.equal(result.code, 'BACKUP_DECRYPT');
  assert.doesNotMatch(result.error, /secret-value/i);
});
test('invalid stored encryption key gives actionable setup advice', () => {
  const result = safeConfigBackupError(Error('AUTH_ENCRYPTION_KEY must be 64 hex characters'));
  assert.equal(result.code, 'BACKUP_SERVER_CONFIG');
});
test('unknown raw stack does not appear in client error', () => {
  const result = safeConfigBackupError(Error('database password secret-value'));
  assert.equal(result.code, 'BACKUP_INVALID');
  assert.doesNotMatch(JSON.stringify(result), /secret-value/);
});
