import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate';
import { readZip, resolvePath, safePath } from '../src/lib/archive';
import { DEFAULT_LIMITS } from '../src/lib/types';

test('safe archive paths and package references reject escapes', () => {
  assert.equal(safePath('a\\b/./c'), 'a/b/c');
  assert.equal(resolvePath('OPS/package.opf', '../images/a%20b.png#cover'), 'images/a b.png');
  assert.equal(resolvePath('OPS/package.opf', '#item'), 'OPS/package.opf');
  for (const path of ['../a', '/a', 'C:\\a', 'a/../../b', 'a\0b', '__proto__/../x']) assert.throws(() => safePath(path));
  for (const ref of ['../../a', '%2e%2e/%2e%2e/a', 'https://example.com/a', '%2fa']) assert.throws(() => resolvePath('OPS/package.opf', ref));
});

test('ZIP streams stored and deflated entries, including prototype names', () => {
  const data = Object.create(null) as Record<string, Uint8Array>;
  data['__proto__'] = strToU8('safe'); data['folder/a.txt'] = strToU8('abc'.repeat(10000));
  for (const level of [0, 6] as const) {
    // fflate's ZIP writer uses a plain object internally; patch an equal-length name.
    const bytes = zipSync({ '__pr0to__': data['__proto__'], 'folder/a.txt': data['folder/a.txt'] }, { level });
    const placeholder = strToU8('__pr0to__');
    for (let i = 0; i <= bytes.length - placeholder.length; i++) {
      if (placeholder.every((byte, j) => bytes[i + j] === byte)) bytes.set(strToU8('__proto__'), i);
    }
    const result = readZip(bytes, { ...DEFAULT_LIMITS, ratio: 2000 });
    assert.deepEqual(result['folder/a.txt'], data['folder/a.txt']);
    assert.deepEqual(result['__proto__'], data['__proto__']);
    assert.equal(Object.getPrototypeOf(result), null);
  }
});

test('ZIP rejects duplicates, traversal, encryption, CRC corruption and truncation', () => {
  assert.throws(() => readZip(zipSync({ '../a': strToU8('x') }), DEFAULT_LIMITS), /path/i);
  assert.throws(() => readZip(zipSync({ 'a/b': strToU8('x'), 'a\\b': strToU8('y') }), DEFAULT_LIMITS), /duplicate/i);
  const bytes = zipSync({ 'a.txt': strToU8('payload') }, { level: 0 });
  const central = bytes.findIndex((byte, i) => byte === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 1 && bytes[i + 3] === 2);
  const encrypted = bytes.slice(), encryptedView = new DataView(encrypted.buffer);
  encryptedView.setUint16(central + 8, 1, true);
  assert.throws(() => readZip(encrypted, DEFAULT_LIMITS), /encrypted/i);
  const corrupted = bytes.slice(); corrupted[35] ^= 1;
  assert.throws(() => readZip(corrupted, DEFAULT_LIMITS), /CRC/i);
  assert.throws(() => readZip(bytes.slice(0, -1), DEFAULT_LIMITS), /truncated|malformed/i);
  assert.throws(() => readZip(bytes, { ...DEFAULT_LIMITS, entries: 0 }), /count/i);
  assert.throws(() => readZip(bytes, { ...DEFAULT_LIMITS, entryBytes: 2 }), /limit/i);
});

test('ZIP checks actual output, not just forged advertised sizes', () => {
  const bytes = zipSync({ 'bomb.txt': strToU8('A'.repeat(200000)) }, { level: 9 });
  const view = new DataView(bytes.buffer);
  const central = bytes.findIndex((byte, i) => byte === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 1 && bytes[i + 3] === 2);
  view.setUint32(22, 1, true); view.setUint32(central + 24, 1, true);
  assert.throws(() => readZip(bytes, { ...DEFAULT_LIMITS, entryBytes: 1024 }), /actual decompression/i);
});

test('ZIP rejects multipart and ZIP64 metadata', () => {
  const bytes = zipSync({ a: strToU8('x') }), end = bytes.length - 22;
  const multipart = bytes.slice(); new DataView(multipart.buffer).setUint16(end + 4, 1, true);
  assert.throws(() => readZip(multipart, DEFAULT_LIMITS), /multipart/i);
  const zip64 = bytes.slice(); new DataView(zip64.buffer).setUint16(end + 10, 0xffff, true);
  assert.throws(() => readZip(zip64, DEFAULT_LIMITS), /ZIP64/i);
});

test('ZIP reads streaming data descriptors, empty directories and header-like comments', () => {
  const parts: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => { if (error) throw error; parts.push(chunk); });
  const file = new ZipDeflate('stream.txt'); zip.add(file);
  const payload = strToU8('streamed data'.repeat(1000));
  file.push(payload.subarray(0, 300), false); file.push(payload.subarray(300), true); zip.end();
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  assert.deepEqual(readZip(bytes, { ...DEFAULT_LIMITS, ratio: 1000 })['stream.txt'], payload);
  const descriptor = bytes.findIndex((byte, i) => byte === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 7 && bytes[i + 3] === 8);
  const unsigned = new Uint8Array(bytes.length - 4);
  unsigned.set(bytes.subarray(0, descriptor)); unsigned.set(bytes.subarray(descriptor + 4), descriptor);
  const unsignedView = new DataView(unsigned.buffer), end = unsigned.length - 22;
  unsignedView.setUint32(end + 16, unsignedView.getUint32(end + 16, true) - 4, true);
  assert.deepEqual(readZip(unsigned, { ...DEFAULT_LIMITS, ratio: 1000 })['stream.txt'], payload);
  const ordinary = zipSync({ 'folder/': new Uint8Array(), 'empty': new Uint8Array(), 'a': strToU8('content') }, { level: 0, comment: 'PK\x03\x04' + 'x'.repeat(100) });
  assert.deepEqual(Object.keys(readZip(ordinary, DEFAULT_LIMITS)), ['empty', 'a']);
});
