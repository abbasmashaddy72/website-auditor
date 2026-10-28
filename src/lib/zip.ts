/** Dependency-free ZIP writer for XLSX and private diagnostic bundles. */
import { deflateRawSync } from 'node:zlib';
const encode = (value: string): Buffer => Buffer.from(value, 'utf8');
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let code = i;
  for (let j = 0; j < 8; j++) code = code & 1 ? (code >>> 1) ^ 0xedb88320 : code >>> 1;
  return code >>> 0;
});
function crc32(payload: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of payload) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipEntries(entries: Array<{ name: string; bytes: Buffer }>): Buffer {
  if (entries.length > 65000) throw Error('ZIP entry limit exceeded');
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry.name ||
      entry.name.startsWith('/') ||
      entry.name.includes('\\') ||
      entry.name.split('/').some((segment) => segment === '..' || segment === '.') ||
      seen.has(entry.name)
    )
      throw Error('Invalid or duplicate ZIP entry path');
    seen.add(entry.name);
  }
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const encodedName = encode(name),
      compressed = deflateRawSync(bytes),
      crc = crc32(bytes);
    const local = Buffer.alloc(30 + encodedName.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(encodedName.length, 26);
    encodedName.copy(local, 30);
    locals.push(local, compressed);
    const entry = Buffer.alloc(46 + encodedName.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(encodedName.length, 28);
    entry.writeUInt32LE(offset, 42);
    encodedName.copy(entry, 46);
    central.push(entry);
    offset += local.length + compressed.length;
  }
  const centralBytes = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
