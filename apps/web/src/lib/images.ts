export interface RasterInfo {
  mime: string;
  extension: string;
  width: number;
  height: number;
}

export function rasterInfo(bytes: Uint8Array): RasterInfo | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  let format = 'Raster';
  const malformed = (): never => { throw new Error(`Malformed ${format} image header.`); };
  const need = (end: number) => { if (end > bytes.length) malformed(); };
  const info = (mime: string, extension: string, width: number, height: number): RasterInfo => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) malformed();
    return { mime, extension, width, height };
  };
  if (bytes[0] === 137 && text(1, 3) === 'PNG') {
    format = 'PNG'; need(33);
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) || view.getUint32(8) !== 13 || text(12, 4) !== 'IHDR') malformed();
    const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] || bytes[27] || bytes[28] > 1) malformed();
    return info('image/png', 'png', view.getUint32(16), view.getUint32(20));
  }
  if (text(0, 3) === 'GIF') {
    format = 'GIF'; need(13);
    if (!/^GIF8[79]a$/.test(text(0, 6))) malformed();
    if (bytes[10] & 0x80) need(13 + 3 * 2 ** ((bytes[10] & 7) + 1));
    return info('image/gif', 'gif', view.getUint16(6, true), view.getUint16(8, true));
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    format = 'JPEG';
    let p = 2;
    while (p < bytes.length) {
      if (bytes[p++] !== 255) malformed();
      while (bytes[p] === 255) p++;
      need(p + 1);
      const marker = bytes[p++];
      if (marker === 0 || marker === 0xd8 || marker === 0xd9 || marker === 0xda) malformed();
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      need(p + 2);
      const length = view.getUint16(p);
      if (length < 2) malformed();
      need(p + length);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8 || !bytes[p + 7] || length !== 8 + 3 * bytes[p + 7]) malformed();
        return info('image/jpeg', 'jpg', view.getUint16(p + 5), view.getUint16(p + 3));
      }
      p += length;
    }
    malformed();
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    format = 'WebP'; need(20);
    const end = view.getUint32(4, true) + 8;
    if (end < 20) malformed();
    need(end);
    for (let p = 12; p < end;) {
      if (p + 8 > end) malformed();
      const type = text(p, 4), size = view.getUint32(p + 4, true), data = p + 8;
      if (data + size + (size & 1) > end) malformed();
      if (type === 'VP8X') {
        if (size !== 10) malformed();
        const u24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
        return info('image/webp', 'webp', u24(data + 4) + 1, u24(data + 7) + 1);
      }
      if (type === 'VP8 ') {
        if (size < 10 || (bytes[data] & 1) || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 1 || bytes[data + 5] !== 0x2a) malformed();
        return info('image/webp', 'webp', view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
      }
      if (type === 'VP8L') {
        if (size < 5 || bytes[data] !== 0x2f) malformed();
        const dimensions = view.getUint32(data + 1, true);
        if (dimensions >>> 29) malformed();
        return info('image/webp', 'webp', (dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1);
      }
      p = data + size + (size & 1);
    }
    malformed();
  }
  if (text(0, 2) === 'BM') {
    format = 'BMP'; need(18);
    const dib = view.getUint32(14, true);
    if (![12, 40, 52, 56, 64, 108, 124].includes(dib)) malformed();
    need(14 + dib);
    const offset = view.getUint32(10, true), size = view.getUint32(2, true);
    if (offset < 14 + dib || offset > bytes.length || (size && (size < offset || size > bytes.length))) malformed();
    const core = dib === 12, planes = view.getUint16(core ? 22 : 26, true), depth = view.getUint16(core ? 24 : 28, true);
    if (planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(depth)) malformed();
    if (!core && ![0, 1, 2, 3, 6].includes(view.getUint32(30, true))) malformed();
    return info('image/bmp', 'bmp', core ? view.getUint16(18, true) : view.getInt32(18, true), core ? view.getUint16(20, true) : Math.abs(view.getInt32(22, true)));
  }
}

export function assertRasterBudget(bytes: Uint8Array, maxPixels = 40_000_000, maxDimension = 16_000): RasterInfo | undefined {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 0 || !Number.isSafeInteger(maxDimension) || maxDimension < 0) throw new Error('Invalid decoded image budget.');
  const info = rasterInfo(bytes);
  if (info && (info.width > maxDimension || info.height > maxDimension || info.width * info.height > maxPixels)) {
    throw new Error(`Image dimensions exceed decoded image budget (${maxPixels} pixels, ${maxDimension} per dimension).`);
  }
  return info;
}
