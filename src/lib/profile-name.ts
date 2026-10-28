/** Canonical comparison key for per-website authentication profile names. */
export function profileNameKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
