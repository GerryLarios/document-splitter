import { strToU8, zlibSync } from 'fflate';

// Original redistributable fixtures, generated here from a one-pixel RGBA image.
// RAR4 uses the public stored-file header layout; no third-party sample files.
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export function png(red = 255): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(strToU8(type), 4);
    bytes.set(data, 8);
    view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)));
    return bytes;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1);
  header[8] = 8; header[9] = 6;
  return concat([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(Uint8Array.from([0, red, 0, 0, 255]))), chunk('IEND', new Uint8Array())]);
}

export function rarStored(files: Record<string, Uint8Array>, options: { archiveFlags?: number; fileFlags?: number; declaredSize?: number } = {}): Uint8Array {
  const header = (type: number, flags: number, length: number) => {
    const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
    bytes[2] = type; view.setUint16(3, flags, true); view.setUint16(5, length, true);
    return bytes;
  };
  const seal = (bytes: Uint8Array) => { new DataView(bytes.buffer).setUint16(0, crc32(bytes.subarray(2)) & 0xffff, true); return bytes; };
  const parts = [Uint8Array.from([82, 97, 114, 33, 26, 7, 0]), seal(header(0x73, options.archiveFlags ?? 0, 13))];
  for (const [name, data] of Object.entries(files)) {
    const filename = strToU8(name), bytes = header(0x74, 0x8000 | (options.fileFlags ?? 0), 32 + filename.length), view = new DataView(bytes.buffer);
    view.setUint32(7, data.length, true); view.setUint32(11, options.declaredSize ?? data.length, true);
    bytes[15] = 2; view.setUint32(16, crc32(data), true); bytes[24] = 20; bytes[25] = 0x30;
    view.setUint16(26, filename.length, true); view.setUint32(28, 0x20, true); bytes.set(filename, 32);
    parts.push(seal(bytes), data);
  }
  parts.push(seal(header(0x7b, 0, 7)));
  return concat(parts);
}
