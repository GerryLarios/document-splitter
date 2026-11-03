import { createExtractorFromData, UnrarError } from 'node-unrar-js/esm/index.esm';
import { safePath } from '../archive';
import type { Entries, Limits, Progress } from '../types';

export async function readRar(bytes: Uint8Array, limits: Limits, wasmBinary: ArrayBuffer, progress?: Progress): Promise<Entries> {
  if (bytes.length > limits.fileBytes) throw new Error('RAR exceeds file size limit.');
  try {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const extractor = await createExtractorFromData({ data, wasmBinary });
    const list = extractor.getFileList();
    if (list.arcHeader.flags.volume || list.arcHeader.flags.headerEncrypted) throw new Error('Multipart or encrypted RAR archives are not supported.');
    const headers = new Map<string, { path: string; size: number; compressed: number; directory: boolean }>();
    const paths = new Set<string>();
    let declared = 0;
    for (const header of list.fileHeaders) {
      if (headers.size >= limits.entries) throw new Error('RAR entry count exceeds limit.');
      if (header.flags.encrypted) throw new Error('Encrypted RAR archives are not supported. Remove archive password protection before importing.');
      const path = safePath(header.name);
      if (paths.has(path)) throw new Error('Duplicate RAR archive path.');
      paths.add(path);
      if (!Number.isSafeInteger(header.unpSize) || !Number.isSafeInteger(header.packSize) || header.unpSize < 0 || header.packSize < 0 || header.unpSize > limits.entryBytes || header.unpSize > header.packSize * limits.ratio) {
        throw new Error('RAR entry exceeds decompression limit.');
      }
      declared += header.unpSize;
      if (declared > limits.totalBytes || declared > bytes.length * limits.ratio) throw new Error('RAR exceeds decompression limit.');
      headers.set(header.name, { path, size: header.unpSize, compressed: header.packSize, directory: header.flags.directory });
    }
    // ExtractorData.write copies bytes into an unbounded DataFile; guard before that copy.
    const bounded = extractor as unknown as {
      create(name: string): number;
      write(fd: number, buf: number, size: number): boolean;
    };
    const originalCreate = bounded.create.bind(extractor), originalWrite = bounded.write.bind(extractor);
    const fds = new Map<number, { size: number; compressed: number; written: number }>();
    let total = 0;
    bounded.create = name => {
      const header = headers.get(name);
      if (!header || header.directory) throw new Error('Unexpected RAR entry.');
      const fd = originalCreate(name);
      fds.set(fd, { size: header.size, compressed: header.compressed, written: 0 });
      return fd;
    };
    bounded.write = (fd, buf, size) => {
      const file = fds.get(fd);
      if (!file || !Number.isSafeInteger(size) || size < 0 || file.written + size > file.size || file.written + size > limits.entryBytes || file.written + size > file.compressed * limits.ratio || total + size > limits.totalBytes || total + size > bytes.length * limits.ratio) {
        throw new Error('RAR exceeds actual decompression limit.');
      }
      file.written += size;
      total += size;
      return originalWrite(fd, buf, size);
    };
    const entries: Entries = Object.create(null);
    const extracted = extractor.extract();
    if (extracted.arcHeader.flags.volume || extracted.arcHeader.flags.headerEncrypted) throw new Error('Multipart or encrypted RAR archives are not supported.');
    let done = 0;
    for (const file of extracted.files) {
      const header = headers.get(file.fileHeader.name);
      if (!header) throw new Error('Unexpected RAR entry.');
      if (!header.directory) {
        if (!file.extraction || file.extraction.length !== header.size || Object.hasOwn(entries, header.path)) throw new Error('Incomplete RAR extraction.');
        entries[header.path] = file.extraction;
      }
      done++;
      progress?.(done / Math.max(headers.size, 1) * 100, `Read ${header.path}`);
    }
    if (done !== headers.size) throw new Error('Truncated RAR archive.');
    return entries;
  } catch (error) {
    if (error instanceof UnrarError && ['ERAR_MISSING_PASSWORD', 'ERAR_BAD_PASSWORD'].includes(error.reason)) {
      throw new Error('Encrypted RAR archives are not supported. Remove archive password protection before importing.', { cause: error });
    }
    if (error instanceof UnrarError && ['ERAR_UNKNOWN_FORMAT', 'ERAR_EREFERENCE'].includes(error.reason)) {
      throw new Error('Unsupported RAR variant. Repack as CBZ or a non-encrypted, single-volume RAR archive.', { cause: error });
    }
    throw error;
  }
}
