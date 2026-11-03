import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { ExtractorData } from 'node-unrar-js/esm/js/ExtractorData';
import { readZip } from '../src/lib/archive';
import { exportComic, parseComic } from '../src/lib/formats/comics';
import { readRar } from '../src/lib/formats/rar';
import { DEFAULT_LIMITS } from '../src/lib/types';
import { png, rarStored } from './fixtures/original';
import { compressedRar, encryptedHeaderRar } from './fixtures/upstream-rar';

const require = createRequire(import.meta.url);
async function wasm(): Promise<ArrayBuffer> {
  const bytes = await readFile(require.resolve('node-unrar-js/esm/js/unrar.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test('original stored RAR extracts exact PNG through real write hook and converts to CBZ', async () => {
  const image = png(), bytes = rarStored({ 'page1.png': image });
  const prototype = ExtractorData.prototype as unknown as { write(fd: number, buf: number, size: number): boolean };
  const original = prototype.write;
  let writes = 0;
  prototype.write = function (fd, buf, size) { writes++; return original.call(this, fd, buf, size); };
  try {
    const entries = await readRar(bytes, DEFAULT_LIMITS, await wasm());
    assert.ok(writes > 0, 'real WASM extraction must invoke the guarded write method');
    assert.deepEqual(entries['page1.png'], image);
    const book = parseComic(entries, 'cbr', 'original.cbr', bytes.length, DEFAULT_LIMITS);
    const result = exportComic(book, [book.info.units[0].id], { title: 'Original fixture' });
    assert.equal(result.extension, 'cbz');
    assert.deepEqual(readZip(result.bytes, DEFAULT_LIMITS)['0001.png'], image);
  } finally { prototype.write = original; }
});

test('RAR limits, encryption, multipart, paths and CRC damage reject', async () => {
  const binary = await wasm(), image = png();
  const bytes = rarStored({ '1.png': image });
  await assert.rejects(readRar(bytes, { ...DEFAULT_LIMITS, entryBytes: 1 }, binary), /limit/i);
  await assert.rejects(readRar(bytes, { ...DEFAULT_LIMITS, entries: 0 }, binary), /count/i);
  await assert.rejects(readRar(bytes, { ...DEFAULT_LIMITS, totalBytes: 1 }, binary), /limit/i);
  await assert.rejects(readRar(rarStored({ '1.png': image }, { archiveFlags: 1 }), DEFAULT_LIMITS, binary), /multipart/i);
  await assert.rejects(readRar(rarStored({ '1.png': image }, { fileFlags: 4 }), DEFAULT_LIMITS, binary), /encrypted|password/i);
  for (const fileFlags of [1, 2]) await assert.rejects(readRar(rarStored({ '1.png': image }, { fileFlags }), DEFAULT_LIMITS, binary));
  await assert.rejects(readRar(rarStored({ '../1.png': image }), DEFAULT_LIMITS, binary), /path/i);
  const damaged = bytes.slice(); damaged[20 + 32 + 5 + 10] ^= 1;
  await assert.rejects(readRar(damaged, DEFAULT_LIMITS, binary), /damaged|CRC|data/i);
});

test('RAR bounded write rejects output before DataFile stores it', async () => {
  const binary = await wasm(), bytes = rarStored({ '1.png': png() });
  let checks = 0;
  const limits = { ...DEFAULT_LIMITS, get entryBytes() { return ++checks === 1 ? DEFAULT_LIMITS.entryBytes : 1; } };
  const prototype = ExtractorData.prototype as unknown as { write(fd: number, buf: number, size: number): boolean };
  const original = prototype.write;
  let stored = 0;
  prototype.write = function (fd, buf, size) { stored += size; return original.call(this, fd, buf, size); };
  try {
    await assert.rejects(readRar(bytes, limits, binary), /actual decompression/i);
    assert.ok(checks > 1, 'limit must be rechecked inside the write callback');
    assert.equal(stored, 0, 'over-limit output must never reach DataFile.write');
  } finally { prototype.write = original; }
});

test('MIT upstream compressed RAR4 extracts generated numeric text, Unicode paths and directories', async () => {
  const bytes = compressedRar();
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), 'c637668cbc0d10beba340607a2f256fb3bafd6e7');
  assert.equal(bytes[20 + 25], 0x33, 'fixture must use Normal compression, not Store');
  const entries = await readRar(bytes, DEFAULT_LIMITS, await wasm());
  let expected = '', n = 0;
  while (expected.length < 1024 * 1024) expected += '1' + '0'.repeat(n++);
  assert.equal(Buffer.from(entries['Folder1/Folder Space/long.txt']).toString('utf8'), expected);
  assert.deepEqual(entries['Folder1/Folder \u4e2d\u6587/2\u4e2d\u6587.txt'], Uint8Array.from([239, 187, 191, 228, 184, 173, 230, 150, 135, 228, 184, 173, 230, 150, 135]));
  assert.equal(Object.keys(entries).length, 2);
});

test('encrypted RAR header errors give actionable password-removal message', async () => {
  const bytes = encryptedHeaderRar();
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), '628e2f245634a7438cbdb1739b7be9776adca78e');
  await assert.rejects(readRar(bytes, DEFAULT_LIMITS, await wasm()), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /encrypted RAR.*Remove archive password protection/i);
    assert.doesNotMatch(error.message, /ERAR_/);
    return true;
  });
});
