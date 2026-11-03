import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import type { Entries, Limits, Progress } from './types';

export function safePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized || /^[\/]|^[a-z]:/i.test(normalized) || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new Error('Unsafe archive path.');
  }
  const parts = normalized.split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || part.includes(':'))) throw new Error('Unsafe archive path.');
  return parts.join('/');
}

export function resolvePath(baseFile: string, reference: string): string {
  const base = safePath(baseFile);
  const ref = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  if (!ref) return base;
  if (/^\/|^[a-z][a-z\d+.-]*:/i.test(ref) || /[\x00-\x1f\x7f]/.test(ref)) throw new Error('Unsafe package reference.');
  const parts = base.split('/').slice(0, -1);
  for (const part of ref.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Package reference escapes archive.');
      parts.pop();
    } else parts.push(part);
  }
  return safePath(parts.join('/'));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

export function readZip(bytes: Uint8Array, limits: Limits, progress?: Progress): Entries {
  if (bytes.length > limits.fileBytes) throw new Error('Archive exceeds file size limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true);
  const u32 = (p: number) => view.getUint32(p, true);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  }
  if (end < 0 || end < bytes.length - 65557) throw new Error('Malformed or truncated ZIP archive.');
  const count = u16(end + 10), centralSize = u32(end + 12), centralOffset = u32(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || (end >= 20 && u32(end - 20) === 0x07064b50)) {
    throw new Error('ZIP64 archives are not supported.');
  }
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) throw new Error('Multipart ZIP archives are not supported.');
  if (count > limits.entries) throw new Error('Archive entry count exceeds limit.');
  if (centralOffset + centralSize !== end) throw new Error('Malformed ZIP central directory.');
  const records = new Map<string, { path: string; size: number; compressed: number; crc: number; offset: number; dataEnd: number; flags: number; directory: boolean }>();
  const paths = new Set<string>();
  let p = centralOffset, declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) throw new Error('Malformed ZIP central directory.');
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), compressed = u32(p + 20), size = u32(p + 24);
    const nameLength = u16(p + 28), extraLength = u16(p + 30), commentLength = u16(p + 32), offset = u32(p + 42);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || u16(p + 34)) throw new Error('Malformed or multipart ZIP entry.');
    if (flags & (1 | 0x40 | 0x2000)) throw new Error('Encrypted ZIP archives are not supported.');
    if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression method.');
    if ([size, compressed, offset].includes(0xffffffff)) throw new Error('ZIP64 archives are not supported.');
    for (let e = p + 46 + nameLength; e < p + 46 + nameLength + extraLength;) {
      if (e + 4 > p + 46 + nameLength + extraLength) throw new Error('Malformed ZIP extra field.');
      if (u16(e) === 1) throw new Error('ZIP64 archives are not supported.');
      e += 4 + u16(e + 2);
      if (e > p + 46 + nameLength + extraLength) throw new Error('Malformed ZIP extra field.');
    }
    const rawName = bytes.subarray(p + 46, p + 46 + nameLength);
    const name = flags & 0x800 ? new TextDecoder('utf-8', { fatal: true }).decode(rawName) : strFromU8(rawName, true);
    const path = safePath(name), directory = /[\\/]$/.test(name);
    if (paths.has(path)) throw new Error('Duplicate ZIP archive path.');
    paths.add(path);
    if (size > limits.entryBytes || size > compressed * limits.ratio || (method === 0 && size !== compressed)) throw new Error('Archive entry exceeds decompression limit.');
    declaredTotal += size;
    if (declaredTotal > limits.totalBytes || declaredTotal > bytes.length * limits.ratio) throw new Error('Archive exceeds decompression limit.');
    if (offset + 30 > centralOffset || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) throw new Error('Malformed ZIP local header.');
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (dataEnd > centralOffset || localNameLength !== nameLength || !rawName.every((byte, j) => byte === bytes[offset + 30 + j])) throw new Error('Malformed ZIP entry data.');
    if (u32(offset + 18) === 0xffffffff || u32(offset + 22) === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
    for (let e = offset + 30 + localNameLength; e < dataStart;) {
      if (e + 4 > dataStart) throw new Error('Malformed ZIP local extra field.');
      if (u16(e) === 1) throw new Error('ZIP64 archives are not supported.');
      e += 4 + u16(e + 2);
      if (e > dataStart) throw new Error('Malformed ZIP local extra field.');
    }
    if (!(flags & 8) && (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== size)) throw new Error('Inconsistent ZIP entry sizes or CRC.');
    if (directory && size) throw new Error('ZIP directory contains data.');
    records.set(name, { path, size, compressed, crc, offset, dataEnd, flags, directory });
    p = next;
  }
  if (p !== end) throw new Error('Malformed ZIP central directory length.');
  let localEnd = 0;
  const localRecords = [...records.values()].sort((a, b) => a.offset - b.offset);
  for (const record of localRecords) {
    if (record.offset !== localEnd) throw new Error('Overlapping or unlisted ZIP entries.');
    localEnd = record.dataEnd;
    if (record.flags & 8) {
      if (localEnd + 12 > centralOffset) throw new Error('Truncated ZIP data descriptor.');
      if (localEnd + 16 <= centralOffset && u32(localEnd) === 0x08074b50 && u32(localEnd + 4) === record.crc && u32(localEnd + 8) === record.compressed && u32(localEnd + 12) === record.size) localEnd += 4;
      if (localEnd + 12 > centralOffset || u32(localEnd) !== record.crc || u32(localEnd + 4) !== record.compressed || u32(localEnd + 8) !== record.size) throw new Error('Malformed ZIP data descriptor.');
      localEnd += 12;
    }
  }
  if (localEnd !== centralOffset) throw new Error('Unlisted ZIP entry data.');
  const entries: Entries = Object.create(null);
  let total = 0, completed = 0, seen = 0;
  const unzip = new Unzip(file => {
    const record = records.get(file.name);
    if (!record || Object.hasOwn(entries, record.path)) throw new Error('Unexpected ZIP entry.');
    seen++;
    let size = 0, crc = 0xffffffff;
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      total += chunk.length;
      if (size > limits.entryBytes || size > record.size || size > record.compressed * limits.ratio || total > limits.totalBytes || total > bytes.length * limits.ratio) {
        file.terminate();
        throw new Error('Archive exceeds actual decompression limit.');
      }
      for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      chunks.push(chunk);
      if (final) {
        if (size !== record.size || ((crc ^ 0xffffffff) >>> 0) !== record.crc) throw new Error('ZIP entry size or CRC mismatch.');
        if (!record.directory) {
          const output = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) { output.set(part, offset); offset += part.length; }
          entries[record.path] = output;
        }
        completed++;
        progress?.(completed / Math.max(count, 1) * 100, `Read ${record.path}`);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (const record of localRecords) {
    const dataStart = record.dataEnd - record.compressed;
    // Use verified sizes, not signature scanning through descriptor-bearing payloads.
    const header = bytes.slice(record.offset, dataStart), local = new DataView(header.buffer);
    local.setUint16(6, record.flags & ~8, true);
    local.setUint32(14, record.crc, true);
    local.setUint32(18, record.compressed, true);
    local.setUint32(22, record.size, true);
    unzip.push(header, false);
    // Deflate can expand a tiny input enormously. Bound each synchronous inflate step.
    for (let offset = dataStart; offset < record.dataEnd; offset += 1024) unzip.push(bytes.subarray(offset, Math.min(offset + 1024, record.dataEnd)), false);
  }
  // Central comments can contain local-header signatures. Only feed a fixed terminator.
  unzip.push(Uint8Array.from([0x50, 0x4b, 1, 2, 0, 0, 0, 0]), true);
  if (seen !== count || completed !== count) throw new Error('Truncated ZIP entry.');
  return entries;
}
