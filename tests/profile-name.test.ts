import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileNameKey } from '../src/lib/profile-name';
test('duplicate profile detection is insensitive to whitespace, case and unicode width', () => {
  assert.equal(profileNameKey('  Root   Admin  '), profileNameKey('root admin'));
  assert.equal(profileNameKey('ＲＯＯＴ'), profileNameKey('root'));
});
