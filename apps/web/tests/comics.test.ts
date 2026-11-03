import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, strFromU8 } from 'fflate';
import { readZip } from '../src/lib/archive';
import { exportComic, parseComic } from '../src/lib/formats/comics';
import { assertRasterBudget, rasterInfo } from '../src/lib/images';
import { DEFAULT_LIMITS } from '../src/lib/types';
import { elements, xml } from '../src/lib/xml';
import { png } from './fixtures/original';

test('comic image signatures, stable natural ordering, byte preservation and ComicInfo remapping', () => {
  const entries = { 'page10.PNG': png(10), 'page2.png': png(2), 'Page2.png': png(3), 'page1.data': png(1), 'unsafe.svg': strToU8('<svg/>'), 'ComicInfo.xml': strToU8('<ComicInfo><Title>Original</Title><Writer>Writer</Writer><PageCount>4</PageCount><Pages><Page Image="0" Type="FrontCover"/><Page Image="1" Type="Story" Bookmark="start"/><Page Image="3" Type="BackCover"/></Pages></ComicInfo>') };
  const book = parseComic(entries, 'cbz', 'comic.cbz', 1000, DEFAULT_LIMITS);
  assert.deepEqual(book.info.units.map(unit => unit.path), ['page1.data', 'Page2.png', 'page2.png', 'page10.PNG']);
  assert.equal(book.info.metadata.author, 'Writer');
  const result = exportComic(book, ['image-4', 'image-2'], { ...book.info.metadata, title: 'Selected' });
  const output = readZip(result.bytes, DEFAULT_LIMITS);
  assert.deepEqual(Object.keys(output), ['0001.png', '0002.png', 'ComicInfo.xml']);
  assert.deepEqual(output['0001.png'], entries['page10.PNG']);
  assert.deepEqual(output['0002.png'], entries['Page2.png']);
  const doc = xml(strFromU8(output['ComicInfo.xml']));
  assert.equal(elements(doc, 'Title')[0].textContent, 'Selected');
  assert.equal(elements(doc, 'PageCount')[0].textContent, '2');
  const pages = elements(doc, 'Page');
  assert.equal(pages.find(page => page.getAttribute('Bookmark') === 'start')?.getAttribute('Image'), '1');
  assert.equal(pages.find(page => page.getAttribute('Type') === 'FrontCover')?.getAttribute('Image'), '0');
  assert.equal(pages.length, 2);
});

test('comic export keeps surviving cover on its remapped page', () => {
  const book = parseComic({ '1.png': png(), '2.png': png(2), 'ComicInfo.xml': strToU8('<ComicInfo><Pages><Page Image="0" Type="FrontCover"/></Pages></ComicInfo>') }, 'cbr', 'comic.cbr', 1000, DEFAULT_LIMITS);
  const output = readZip(exportComic(book, ['image-2', 'image-1'], {}).bytes, DEFAULT_LIMITS);
  const pages = elements(xml(strFromU8(output['ComicInfo.xml'])), 'Page');
  assert.equal(pages[0].getAttribute('Image'), '1');
  assert.equal(pages[0].getAttribute('Type'), 'FrontCover');
});

test('comic rejects invalid signatures, unsafe XML and page limits', () => {
  assert.throws(() => parseComic({ 'fake.png': strToU8('not an image') }, 'cbz', 'bad.cbz', 100, DEFAULT_LIMITS), /signature/i);
  assert.throws(() => parseComic({ 'only.svg': strToU8('<svg/>') }, 'cbz', 'bad.cbz', 100, DEFAULT_LIMITS), /no supported/i);
  assert.throws(() => parseComic({ '1.png': png() }, 'cbz', 'bad.cbz', 100, { ...DEFAULT_LIMITS, units: 0 }), /limit/i);
  assert.throws(() => parseComic({ '../1.png': png() }, 'cbz', 'bad.cbz', 100, DEFAULT_LIMITS), /path/i);
  assert.throws(() => parseComic({ '1.png': png(), 'ComicInfo.xml': strToU8('<!DOCTYPE ComicInfo><ComicInfo/>') }, 'cbz', 'bad.cbz', 1000, DEFAULT_LIMITS), /document types/i);
});

test('raster headers parse PNG, GIF, JPEG SOF, all WebP variants, and BMP', () => {
  const image = png();
  assert.deepEqual(rasterInfo(image), { mime: 'image/png', extension: 'png', width: 1, height: 1 });
  const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 2, 0, 3, 0, 0, 0, 0]);
  assert.deepEqual(rasterInfo(gif), { mime: 'image/gif', extension: 'gif', width: 2, height: 3 });
  const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 11, 8, 0, 3, 0, 2, 1, 1, 17, 0]);
  assert.deepEqual(rasterInfo(jpeg), { mime: 'image/jpeg', extension: 'jpg', width: 2, height: 3 });
  const webp = (tag: string, data: number[]) => {
    const bytes = new Uint8Array(20 + data.length + (data.length & 1)), view = new DataView(bytes.buffer);
    bytes.set(strToU8('RIFF'), 0); view.setUint32(4, bytes.length - 8, true);
    bytes.set(strToU8('WEBP' + tag), 8); view.setUint32(16, data.length, true);
    bytes.set(data, 20); return bytes;
  };
  const vp8x = webp('VP8X', [0, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
  const vp8 = webp('VP8 ', [0, 0, 0, 0x9d, 1, 0x2a, 2, 0, 3, 0]);
  const vp8l = webp('VP8L', [0x2f, 1, 0x80, 0, 0]);
  for (const bytes of [vp8x, vp8, vp8l]) assert.deepEqual(rasterInfo(bytes), { mime: 'image/webp', extension: 'webp', width: 2, height: 3 });
  const bmp = new Uint8Array(54), view = new DataView(bmp.buffer);
  bmp.set(strToU8('BM')); view.setUint32(2, 54, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, 2, true); view.setInt32(22, -3, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  assert.deepEqual(rasterInfo(bmp), { mime: 'image/bmp', extension: 'bmp', width: 2, height: 3 });
  for (const bytes of [gif, jpeg, vp8x, vp8, vp8l, bmp]) assert.throws(() => assertRasterBudget(bytes, 5), /dimensions.*budget/i);
  assert.equal(rasterInfo(strToU8('<svg/>')), undefined);
});

test('raster budget rejects huge decoded dimensions and malformed known headers before preview', () => {
  const huge = png().slice(), view = new DataView(huge.buffer);
  view.setUint32(16, 16_001); view.setUint32(20, 1);
  assert.throws(() => assertRasterBudget(huge), /dimensions.*budget/i);
  view.setUint32(16, 10_000); view.setUint32(20, 10_000);
  assert.throws(() => assertRasterBudget(huge), /dimensions.*budget/i);
  assert.equal(assertRasterBudget(huge, 100_000_000)?.width, 10_000);
  assert.throws(() => parseComic({ 'cover.png': huge }, 'cbz', 'huge.cbz', 1000, DEFAULT_LIMITS), /dimensions.*budget/i);
  assert.equal(parseComic({ 'cover.png': huge }, 'cbz', 'huge.cbz', 1000, { ...DEFAULT_LIMITS, imagePixels: 100_000_000 }).info.units.length, 1);
  for (const bytes of [png().subarray(0, 20), strToU8('GIF89a'), Uint8Array.from([255, 216, 255, 192, 0, 2]), strToU8('RIFF\x00\x00\x00\x00WEBP'), strToU8('BM')]) {
    assert.throws(() => rasterInfo(bytes), /malformed/i);
  }
  assert.throws(() => parseComic({ 'cover.data': strToU8('GIF89a') }, 'cbz', 'bad.cbz', 100, DEFAULT_LIMITS), /malformed GIF/i);
  assert.throws(() => assertRasterBudget(png(), Number.NaN), /invalid.*budget/i);
});
