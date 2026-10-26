import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
function key(): Buffer {
  const v = Buffer.from(process.env.AUTH_ENCRYPTION_KEY || '', 'hex');
  if (v.length !== 32) throw Error('AUTH_ENCRYPTION_KEY must be 64 hex characters');
  return v;
}
export function encrypt(data: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv),
    value = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), value.toString('hex')].join('.');
}
export function decrypt(value: string): string {
  const [iv, tag, ciphertext] = value.split('.');
  const dec = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  dec.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([dec.update(Buffer.from(ciphertext, 'hex')), dec.final()]).toString('utf8');
}
