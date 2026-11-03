import { strFromU8, strToU8, zipSync } from 'fflate';
import { safePath } from '../archive';
import { assertRasterBudget, rasterInfo } from '../images';
import type { Entries, ExportResult, Limits, Metadata, ParsedBook, Progress } from '../types';
import { elements, serialize, xml } from '../xml';

const metadataTags: Record<string, string> = { title: 'Title', author: 'Writer', subject: 'Summary', keywords: 'Tags' };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const infoPaths = (entries: Entries) => Object.keys(entries).filter(path => /(^|\/)ComicInfo\.xml$/i.test(path));

export function parseComic(entries: Entries, format: 'cbz' | 'cbr', name: string, size: number, limits: Limits & { imagePixels?: number }, progress?: Progress): ParsedBook {
  if (size > limits.fileBytes) throw new Error('Comic exceeds file size limit.');
  const paths = Object.keys(entries), canonical = new Set<string>();
  if (paths.length > limits.entries) throw new Error('Comic entry count exceeds limit.');
  let total = 0;
  for (const path of paths) {
    const normalized = safePath(path);
    if (normalized !== path || canonical.has(normalized)) throw new Error('Unsafe or duplicate comic path.');
    canonical.add(normalized);
    total += entries[path].length;
    if (entries[path].length > limits.entryBytes || total > limits.totalBytes || total > size * limits.ratio) throw new Error('Comic exceeds decompression limit.');
  }
  const images = paths.map(path => {
    const type = assertRasterBudget(entries[path], limits.imagePixels);
    if (!type && /\.(?:jpe?g|png|gif|webp|bmp)$/i.test(path)) throw new Error(`Invalid image signature: ${path}`);
    return type ? { path, ...type } : undefined;
  }).filter(image => image !== undefined)
    .sort((a, b) => collator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!images.length || images.length > limits.units) throw new Error('Comic has no supported images or exceeds page limit.');
  const metadata: Metadata = {};
  const infos = infoPaths(entries);
  if (infos.length > 1) throw new Error('Multiple ComicInfo documents are ambiguous.');
  if (infos.length) {
    const doc = xml(strFromU8(entries[infos[0]]));
    if (doc.documentElement.localName !== 'ComicInfo') throw new Error('Invalid ComicInfo root.');
    for (const node of Array.from(doc.documentElement.childNodes)) {
      if (node.nodeType !== 1) continue;
      const tag = (node as Element).localName;
      if (tag === 'Pages' || tag === 'PageCount') continue;
      const key = Object.keys(metadataTags).find(key => metadataTags[key] === tag) ?? tag.toLowerCase();
      metadata[key] = node.textContent ?? '';
    }
  }
  progress?.(100, `Read ${images.length} comic pages`);
  return { entries, info: { format, name, size, metadata, warnings: format === 'cbr' ? ['RAR input exports as CBZ.'] : [], units: images.map((image, index) => ({ id: `image-${index + 1}`, index, title: image.path.split('/').at(-1)!, path: image.path, mime: image.mime })) } };
}

export function exportComic(book: ParsedBook, order: string[], metadata: Metadata, progress?: Progress): ExportResult {
  if (!book.entries || !['cbz', 'cbr'].includes(book.info.format)) throw new Error('Missing source comic.');
  if (!order.length || new Set(order).size !== order.length) throw new Error('Select unique comic pages to export.');
  const units = new Map(book.info.units.map(unit => [unit.id, unit]));
  const selected = order.map(id => {
    const unit = units.get(id);
    if (!unit?.path || !book.entries![unit.path]) throw new Error('Unknown comic page.');
    return unit;
  });
  const output: Entries = Object.create(null), width = Math.max(4, String(selected.length).length);
  for (const [index, unit] of selected.entries()) {
    const bytes = book.entries[unit.path!], type = rasterInfo(bytes);
    if (!type) throw new Error('Invalid comic image signature.');
    output[`${String(index + 1).padStart(width, '0')}.${type.extension}`] = bytes;
    progress?.((index + 1) / selected.length * 80, 'Ordering comic pages');
  }
  const infos = infoPaths(book.entries);
  const doc = infos.length ? xml(strFromU8(book.entries[infos[0]])) : xml('<ComicInfo/>');
  const root = doc.documentElement;
  const setText = (tag: string, text: string) => {
    let node = Array.from(root.childNodes).find(node => node.nodeType === 1 && (node as Element).localName === tag) as Element | undefined;
    if (!node) { node = doc.createElement(tag); root.appendChild(node); }
    node.textContent = text;
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[a-z_][\w.-]*$/i.test(key)) throw new Error('Invalid ComicInfo metadata key.');
    const existing = Array.from(root.childNodes).find(node => node.nodeType === 1 && (node as Element).localName.toLowerCase() === key) as Element | undefined;
    setText(metadataTags[key] ?? existing?.localName ?? key[0].toUpperCase() + key.slice(1), value);
  }
  setText('PageCount', String(selected.length));
  const remap = new Map(selected.map((unit, index) => [unit.index, index]));
  const pages = elements(doc, 'Page');
  const hadCover = pages.some(page => page.getAttribute('Type') === 'FrontCover');
  let coverRemains = false;
  for (const page of pages) {
    const value = page.getAttribute('Image') ?? '', oldIndex = /^\d+$/.test(value) ? Number(value) : -1;
    const index = remap.get(oldIndex);
    if (index === undefined) page.parentNode?.removeChild(page);
    else {
      page.setAttribute('Image', String(index));
      if (page.getAttribute('Type') === 'FrontCover') coverRemains = true;
    }
  }
  if (hadCover && !coverRemains) {
    let container = elements(doc, 'Pages')[0];
    if (!container) { container = doc.createElement('Pages'); root.appendChild(container); }
    let page = elements(container, 'Page').find(page => page.getAttribute('Image') === '0');
    if (!page) { page = doc.createElement('Page'); page.setAttribute('Image', '0'); container.appendChild(page); }
    page.setAttribute('Type', 'FrontCover');
  }
  output['ComicInfo.xml'] = strToU8(serialize(doc));
  const bytes = zipSync(output, { level: 0 });
  progress?.(100, 'CBZ ready');
  return { bytes, mime: 'application/vnd.comicbook+zip', extension: 'cbz', warnings: book.info.format === 'cbr' ? ['Converted RAR comic to CBZ.'] : [] };
}
