import { strFromU8, strToU8, zipSync } from 'fflate';
import { resolvePath, safePath } from '../archive';
import { assertRasterBudget } from '../images';
import type { Entries, ExportResult, Limits, Metadata, ParsedBook, PreviewResult, Progress } from '../types';
import { elements, escapeXml, serialize, xml } from '../xml';

const OPF = 'http://www.idpf.org/2007/opf';
const DC = 'http://purl.org/dc/elements/1.1/';
const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATH = 'http://www.w3.org/1998/Math/MathML';
const EPUB = 'http://www.idpf.org/2007/ops';
const NCX = 'http://www.daisy.org/z3986/2005/ncx/';
const CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container';
const decoder = new TextDecoder('utf-8', { fatal: true });
const own = (entries: Entries, path: string) => Object.hasOwn(entries, path);
const tokens = (value: string | null) => (value || '').split(/\s+/).filter(Boolean);
const children = (root: Element, name: string, ns: string) => Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name && (node as Element).namespaceURI === ns);
const descendants = (root: Document | Element, name: string, ns: string) => elements(root, name).filter(el => el.namespaceURI === ns);

function documentAt(entries: Entries, path: string, ns: string, root: string): Document {
  if (!own(entries, path)) throw new Error(`Missing EPUB resource: ${path}`);
  // EPUB 2 commonly includes a standard public DTD. Remove only known external
  // declarations; the shared XML parser still rejects entities and other DTDs.
  const content = decoder.decode(entries[path]).replace(/<!DOCTYPE\s+html\s*>/gi, '').replace(/<!DOCTYPE\s+(html|ncx)\s+PUBLIC\s+"([^"]+)"\s+"([^"]+)"\s*>/gi, (whole, name, publicId, systemId) => {
    if (name === 'html' && publicId === '-//W3C//DTD XHTML 1.1//EN' && systemId === 'http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd') return '';
    if (name === 'html' && /^-\/\/W3C\/\/DTD XHTML 1\.0 (?:Strict|Transitional)\/\/EN$/.test(publicId) && /^http:\/\/www\.w3\.org\/TR\/xhtml1\/DTD\/xhtml1-(?:strict|transitional)\.dtd$/.test(systemId)) return '';
    if (name === 'ncx' && publicId === '-//NISO//DTD ncx 2005-1//EN' && systemId === 'http://www.daisy.org/z3986/2005/ncx-2005-1.dtd') return '';
    return whole;
  });
  const doc = xml(content);
  if (doc.documentElement.localName !== root || doc.documentElement.namespaceURI !== ns) throw new Error(`Invalid ${root} namespace: ${path}`);
  if (Array.from(doc.getElementsByTagName('*')).some(el => el.hasAttributeNS('http://www.w3.org/XML/1998/namespace', 'base'))) throw new Error('EPUB xml:base is unsupported.');
  const ids = new Set<string>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const id = el.getAttribute('id') || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
    if (id && ids.has(id)) throw new Error(`Duplicate XML identifier in ${path}: ${id}`);
    if (id) ids.add(id);
  }
  if (root === 'html' && (descendants(doc, 'head', XHTML).length !== 1 || descendants(doc, 'body', XHTML).length !== 1 || children(descendants(doc, 'head', XHTML)[0], 'title', XHTML).length !== 1)) throw new Error(`EPUB XHTML requires one head, title and body: ${path}`);
  return doc;
}

function localRef(base: string, reference: string): string {
  if (/^[a-z][a-z\d+.-]*:|^\/\/|^\//i.test(reference.trim())) throw new Error(`Remote or absolute EPUB resource is unsupported: ${reference}`);
  return resolvePath(base, reference);
}

function packageParts(entries: Entries, path: string) {
  const doc = documentAt(entries, path, OPF, 'package');
  const metadata = children(doc.documentElement, 'metadata', OPF)[0];
  const manifest = children(doc.documentElement, 'manifest', OPF)[0];
  const spine = children(doc.documentElement, 'spine', OPF)[0];
  if (!metadata || !manifest || !spine || ['metadata', 'manifest', 'spine'].some(name => children(doc.documentElement, name, OPF).length !== 1)) throw new Error('EPUB package requires exactly one metadata, manifest and spine.');
  const items = children(manifest, 'item', OPF);
  const refs = children(spine, 'itemref', OPF);
  return { doc, metadata, manifest, spine, items, refs };
}

function itemPath(packagePath: string, item: Element): string {
  const href = item.getAttribute('href');
  if (!href || /[#?]/.test(href)) throw new Error('Manifest resources must have local paths without fragments or queries.');
  return localRef(packagePath, href);
}

function requiredResource(entries: Entries, base: string, ref: string) {
  if (/^data:/i.test(ref.trim())) throw new Error('Embedded data resources in EPUB source are unsupported.');
  const path = localRef(base, ref);
  if (!own(entries, path)) throw new Error(`Missing EPUB resource: ${path}`);
}

function validateContent(entries: Entries, path: string, mime: string) {
  if (mime === 'text/css') {
    validateCssAttribute(entries, path, decoder.decode(entries[path]));
    return;
  }
  if (mime !== 'application/xhtml+xml' && mime !== 'image/svg+xml') return;
  const doc = documentAt(entries, path, mime === 'image/svg+xml' ? 'http://www.w3.org/2000/svg' : XHTML, mime === 'image/svg+xml' ? 'svg' : 'html');
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (/^(script|iframe|frame|frameset|object|embed|audio|video|source|track|form|input|button|select|textarea|foreignObject|base|animate|animateMotion|animateTransform|set)$/i.test(el.localName)) throw new Error(`Unsupported scripted or multimodal EPUB content: ${el.localName}`);
    if (el.localName === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')) throw new Error('EPUB refresh controls are unsupported.');
    if (el.localName === 'meta' && (/^(fixed-layout|original-resolution)$/i.test(el.getAttribute('name') || '') || (el.getAttribute('name') === 'viewport' && /(?:^|[,\s])(?:width|height)\s*=\s*\d+/i.test(el.getAttribute('content') || '')))) throw new Error('Fixed-layout chapter metadata is unsupported.');
    if (![XHTML, SVG, MATH].includes(el.namespaceURI || '')) throw new Error('Unsupported EPUB content namespace.');
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.localName)) throw new Error('Scripted EPUB content is unsupported.');
      if (attr.localName === 'srcset') throw new Error('EPUB responsive image sources are unsupported.');
      if (attr.localName === 'style') validateCssAttribute(entries, path, attr.value);
      if (el.namespaceURI === SVG && /url\s*\(|\\/i.test(attr.value)) validateCssAttribute(entries, path, attr.value);
      if (attr.localName === 'src' || attr.localName === 'poster' || (attr.localName === 'href' && !['a', 'area'].includes(el.localName))) requiredResource(entries, path, attr.value);
      if (attr.localName === 'href' && ['a', 'area'].includes(el.localName)) {
        if (/^[a-z][a-z\d+.-]*:/i.test(attr.value)) {
          if (!/^(https?:|mailto:)/i.test(attr.value)) throw new Error('Executable EPUB hyperlinks are unsupported.');
        } else localRef(path, attr.value);
      }
    }
    if (el.localName === 'style') validateCssAttribute(entries, path, el.textContent || '');
  }
}

function validateCssAttribute(entries: Entries, path: string, css: string) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Decode CSS escapes for validation only; preserve the original publisher CSS.
  css = css.replace(/\\(?:([\da-f]{1,6})\s?|\r\n|[\n\r\f]|([^\n\r\f]))/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char || '');
  if (/\\|\/\*|image-set\s*\(/i.test(css)) throw new Error('Complex CSS resources are unsupported.');
  const refs = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)|@import\s+(['"])([\s\S]*?)\3/gi;
  const rest = css.replace(refs, (_, _quote, url, _importQuote, imported) => { requiredResource(entries, path, (url ?? imported).trim()); return ''; });
  if (/@import\b|url\s*\(/i.test(rest)) throw new Error('Unsupported CSS resource reference.');
}

export function parseEpub(entries: Entries, name: string, size: number, limits: Limits, progress?: Progress): ParsedBook {
  progress?.(10, 'Reading EPUB package');
  const paths = Object.keys(entries);
  if (size > limits.fileBytes || paths.length > limits.entries) throw new Error('EPUB exceeds archive limits.');
  let total = 0;
  for (const path of paths) {
    if (safePath(path) !== path) throw new Error(`Unsafe EPUB resource path: ${path}`);
    total += entries[path].byteLength;
    if (entries[path].byteLength > limits.entryBytes || total > limits.totalBytes) throw new Error('EPUB exceeds resource limits.');
  }
  if (!own(entries, 'mimetype') || strFromU8(entries.mimetype) !== 'application/epub+zip') throw new Error('Invalid EPUB mimetype.');
  if (own(entries, 'META-INF/encryption.xml')) {
    const encryption = documentAt(entries, 'META-INF/encryption.xml', CONTAINER, 'encryption');
    const methods = descendants(encryption, 'EncryptionMethod', 'http://www.w3.org/2001/04/xmlenc#');
    if (methods.length && methods.every(el => ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(el.getAttribute('Algorithm') || ''))) throw new Error('Obfuscated EPUB fonts are unsupported; unobfuscated fonts are required.');
    throw new Error('Encrypted or DRM-protected EPUBs are unsupported.');
  }
  const container = documentAt(entries, 'META-INF/container.xml', CONTAINER, 'container');
  const roots = descendants(container, 'rootfile', CONTAINER);
  if (roots.length !== 1 || roots[0].getAttribute('media-type') !== 'application/oebps-package+xml') throw new Error('Only single-package EPUB containers are supported.');
  const packagePath = safePath(roots[0].getAttribute('full-path') || '');
  const { doc, metadata, items, refs, spine } = packageParts(entries, packagePath);
  const version = doc.documentElement.getAttribute('version') || '';
  if (!/^(2\.0|3\.[0-3])$/.test(version)) throw new Error('Only EPUB 2 and EPUB 3 are supported.');
  const identifierId = doc.documentElement.getAttribute('unique-identifier');
  if (!identifierId || !descendants(metadata, 'identifier', DC).some(el => el.getAttribute('id') === identifierId && el.textContent?.trim())) throw new Error('EPUB unique identifier is missing.');
  if (!descendants(metadata, 'title', DC)[0]?.textContent?.trim() || !descendants(metadata, 'language', DC)[0]?.textContent?.trim()) throw new Error('EPUB title and language are required.');
  for (const meta of descendants(metadata, 'meta', OPF)) {
    const key = `${meta.getAttribute('property') || ''} ${meta.getAttribute('name') || ''}`.trim();
    const value = (meta.getAttribute('content') || meta.textContent || '').trim();
    if ((/(?:^|:)layout$|fixed-layout|original-resolution/i.test(key) && !/^(reflowable|false|no)$/i.test(value)) || /pre-paginated/i.test(value)) throw new Error('Fixed-layout EPUBs are unsupported.');
    if (/^(?:rendition:)?(?:orientation|spread)$/.test(key) && !/^(auto|portrait|landscape|none|both)$/.test(value)) throw new Error('Unsupported EPUB rendition override.');
    if (/(?:^|:)(?:book-type|type|interactive|multimedia)$/.test(key) && /comic|audio|video|interactive|multimedia/i.test(value)) throw new Error('Multimodal EPUB profiles are unsupported.');
  }
  if (descendants(metadata, 'type', DC).some(el => /comic|audio|video|interactive/i.test(el.textContent || ''))) throw new Error('Multimodal EPUB profiles are unsupported.');
  const byId = new Map<string, Element>();
  const byPath = new Map<string, Element>();
  let navPath: string | undefined;
  let ncxPath: string | undefined;
  for (const item of items) {
    const id = item.getAttribute('id') || '';
    const path = itemPath(packagePath, item);
    const mime = item.getAttribute('media-type') || '';
    if (!id || byId.has(id) || byPath.has(path)) throw new Error('Duplicate or missing EPUB manifest identifiers or paths.');
    if (!own(entries, path)) throw new Error(`Missing EPUB resource: ${path}`);
    if (item.hasAttribute('media-overlay') || tokens(item.getAttribute('properties')).some(value => ['scripted', 'remote-resources'].includes(value)) || /^(audio|video)\//.test(mime) || /(?:javascript|ecmascript|smil)/i.test(mime)) throw new Error('Scripted, remote or multimodal EPUB resources are unsupported.');
    byId.set(id, item);
    byPath.set(path, item);
    if (tokens(item.getAttribute('properties')).includes('nav')) {
      if (navPath || mime !== 'application/xhtml+xml') throw new Error('Invalid EPUB navigation manifest.');
      navPath = path;
    }
  }
  const declared: Entries = Object.create(null);
  for (const path of byPath.keys()) declared[path] = entries[path];
  for (const [path, item] of byPath) {
    const mime = item.getAttribute('media-type') || '';
    if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime)) {
      if (!assertRasterBudget(entries[path], limits.imagePixels)) throw new Error(`Invalid raster image: ${path}`);
    }
    validateContent(declared, path, mime);
  }
  const tocId = spine.getAttribute('toc');
  if (tocId) {
    const toc = byId.get(tocId);
    if (!toc || toc.getAttribute('media-type') !== 'application/x-dtbncx+xml') throw new Error('Invalid EPUB NCX reference.');
    ncxPath = itemPath(packagePath, toc);
  } else {
    const toc = items.find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
    if (toc) ncxPath = itemPath(packagePath, toc);
  }
  if (version.startsWith('2') && !ncxPath) throw new Error('EPUB 2 requires NCX navigation.');
  const titles = new Map<string, string>();
  if (ncxPath) {
    const ncx = documentAt(entries, ncxPath, NCX, 'ncx');
    if (children(ncx.documentElement, 'head', NCX).length !== 1 || children(ncx.documentElement, 'docTitle', NCX).length !== 1 || children(ncx.documentElement, 'navMap', NCX).length !== 1) throw new Error('Invalid NCX head, title or navigation map.');
    for (const point of descendants(ncx, 'navPoint', NCX)) {
      const content = children(point, 'content', NCX)[0];
      const label = children(point, 'navLabel', NCX)[0]?.textContent?.trim();
      if (content && label) { const path = localRef(ncxPath, content.getAttribute('src') || ''); if (!titles.has(path)) titles.set(path, label); }
    }
  }
  if (navPath) {
    const nav = documentAt(entries, navPath, XHTML, 'html');
    const tocNodes = descendants(nav, 'nav', XHTML).filter(el => tokens(el.getAttributeNS(EPUB, 'type')).includes('toc'));
    if (tocNodes.length > 1) throw new Error('EPUB navigation contains multiple tables of contents.');
    for (const toc of tocNodes) {
      for (const anchor of descendants(toc, 'a', XHTML)) {
        const ref = anchor.getAttribute('href');
        if (ref && anchor.textContent?.trim()) { const path = localRef(navPath, ref); titles.set(path, anchor.textContent.trim()); }
      }
    }
  }
  if (!refs.length || refs.length > limits.units) throw new Error('EPUB spine is empty or exceeds chapter limits.');
  const seen = new Set<string>();
  const units = refs.map((ref, index) => {
    const id = ref.getAttribute('idref') || '';
    const item = byId.get(id);
    if (!item || seen.has(id) || item.getAttribute('media-type') !== 'application/xhtml+xml') throw new Error('EPUB spine must contain unique XHTML documents.');
    if (tokens(ref.getAttribute('properties')).some(value => /^(?:rendition:)?(?:page-spread-|layout-|orientation-|spread-)/.test(value) && !/^(?:rendition:)?(?:layout-reflowable|orientation-(?:auto|portrait|landscape)|spread-(?:auto|none|both))$/.test(value)) || ref.hasAttribute('media-overlay')) throw new Error('Fixed-layout spine overrides are unsupported.');
    seen.add(id);
    const path = itemPath(packagePath, item);
    const chapter = documentAt(entries, path, XHTML, 'html');
    const heading = ['h1', 'h2', 'h3', 'title'].map(tag => descendants(chapter, tag, XHTML)[0]?.textContent?.trim()).find(Boolean);
    const body = descendants(chapter, 'body', XHTML)[0];
    if (!body) throw new Error('EPUB chapter is missing its body.');
    return { id, index, path, mime: 'application/xhtml+xml', title: titles.get(path) || heading || `Chapter ${index + 1}`, excerpt: (body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180) };
  });
  if (refs.every(ref => ref.getAttribute('linear') === 'no')) throw new Error('EPUB spine requires a linear reading-order chapter.');
  const infoMetadata: Metadata = {};
  for (const [key, local] of Object.entries({ title: 'title', author: 'creator', language: 'language', description: 'description' })) infoMetadata[key] = descendants(metadata, local, DC)[0]?.textContent || '';
  progress?.(100, 'EPUB ready');
  const warnings = ['Preview uses simplified typography; publisher CSS and SVG/MathML are retained in exports. SVG is omitted and MathML shown as text in previews.'];
  if (version.startsWith('3')) {
    if (!navPath) warnings.push('Missing EPUB 3 navigation will be generated on export.');
    else if (!descendants(documentAt(entries, navPath, XHTML, 'html'), 'nav', XHTML).some(el => tokens(el.getAttributeNS(EPUB, 'type')).includes('toc'))) warnings.push('Missing EPUB 3 table of contents will be generated on export.');
    if (!descendants(metadata, 'meta', OPF).some(el => el.getAttribute('property') === 'dcterms:modified')) warnings.push('Missing EPUB 3 modification timestamp will be added on export.');
  }
  return { entries, epub: { packagePath, version, navPath, ncxPath }, info: { format: 'epub', name, size, units, metadata: infoMetadata, warnings } };
}

function relativePath(base: string, target: string): string {
  const from = base.split('/').slice(0, -1);
  const to = target.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].map(part => part === '..' ? part : encodeURIComponent(part)).join('/');
}

function remove(el: Element) { el.parentNode?.removeChild(el); }

function pruneLinks(doc: Document, base: string, removed: Set<string>, warnings: string[], navigation = false) {
  for (const anchor of [...descendants(doc, 'a', XHTML), ...descendants(doc, 'a', SVG)]) {
    const href = anchor.getAttribute('href') || anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    if (!removed.has(localRef(base, href))) continue;
    if (navigation && anchor.parentNode?.nodeType === 1 && (anchor.parentNode as Element).localName === 'li') { remove(anchor.parentNode as Element); continue; }
    const span = doc.createElementNS(anchor.namespaceURI, anchor.namespaceURI === SVG ? 'g' : 'span');
    for (const attr of Array.from(anchor.attributes)) if (!['href', 'target', 'download', 'rel', 'ping'].includes(attr.localName)) span.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    while (anchor.firstChild) span.appendChild(anchor.firstChild);
    anchor.parentNode?.replaceChild(span, anchor);
    warnings.push(`Removed link to deleted chapter in ${base}.`);
  }
}

export function exportEpub(book: ParsedBook, order: string[], metadata: Metadata, progress?: Progress): ExportResult {
  if (!book.entries || !book.epub) throw new Error('Not an EPUB book.');
  const { packagePath, version } = book.epub;
  const entries: Entries = Object.assign(Object.create(null), book.entries);
  const parts = packageParts(entries, packagePath);
  const { doc, manifest, spine, items, refs } = parts;
  const units = new Map(book.info.units.map(unit => [unit.id, unit]));
  if (!order.length || new Set(order).size !== order.length || order.some(id => !units.has(id))) throw new Error('Export order must contain unique known chapter identifiers.');
  const kept = new Set(order);
  const removedPaths = new Set(book.info.units.filter(unit => !kept.has(unit.id)).map(unit => unit.path!));
  const removedIds = new Set<string>();
  const warnings: string[] = [];
  progress?.(10, 'Rebuilding EPUB spine');
  for (const item of items) if (removedPaths.has(itemPath(packagePath, item))) { removedIds.add(item.getAttribute('id')!); remove(item); }
  for (const path of removedPaths) delete entries[path];
  for (const ref of refs) { if (!kept.has(ref.getAttribute('idref') || '') && ref.getAttribute('id')) removedIds.add(ref.getAttribute('id')!); remove(ref); }
  for (const id of order) {
    const ref = refs.find(el => el.getAttribute('idref') === id);
    if (!ref) throw new Error('Chapter is missing its spine reference.');
    spine.appendChild(ref);
  }
  if (children(spine, 'itemref', OPF).every(ref => ref.getAttribute('linear') === 'no')) {
    children(spine, 'itemref', OPF)[0].setAttribute('linear', 'yes');
    warnings.push('Promoted the first retained chapter to linear reading order.');
  }
  for (const item of children(manifest, 'item', OPF)) for (const attr of ['fallback', 'fallback-style', 'media-overlay']) if (removedIds.has(item.getAttribute(attr) || '')) item.removeAttribute(attr);
  for (const reference of descendants(doc, 'reference', OPF)) {
    const href = reference.getAttribute('href');
    if (href && removedPaths.has(localRef(packagePath, href))) { if (reference.getAttribute('id')) removedIds.add(reference.getAttribute('id')!); remove(reference); }
  }
  for (const guide of children(doc.documentElement, 'guide', OPF)) if (!children(guide, 'reference', OPF).length) remove(guide);
  for (const [key, local] of Object.entries({ title: 'title', author: 'creator', language: 'language', description: 'description' })) {
    if (metadata[key] === undefined) continue;
    if (['title', 'language'].includes(key) && !metadata[key].trim()) throw new Error('EPUB title and language cannot be empty.');
    if (key === 'language') {
      try { Intl.getCanonicalLocales(metadata[key].trim()); }
      catch { throw new Error('Use a valid language tag, such as en, fr, or en-US.'); }
    }
    const old = descendants(parts.metadata, local, DC);
    if (old[0]?.textContent === metadata[key]) continue;
    const value = old[0] || doc.createElementNS(DC, `dc:${local}`);
    value.textContent = metadata[key];
    if (!old.length) parts.metadata.insertBefore(value, children(parts.metadata, 'meta', OPF)[0] || null);
    if (key === 'author') {
      value.removeAttributeNS(OPF, 'file-as');
      const authorId = value.getAttribute('id');
      if (authorId) for (const el of descendants(parts.metadata, 'meta', OPF)) if (el.getAttribute('refines') === `#${authorId}` && el.getAttribute('property') === 'file-as') remove(el);
    }
    if (key === 'title') {
      const titleId = value.getAttribute('id');
      if (titleId) for (const el of descendants(parts.metadata, 'meta', OPF)) if (el.getAttribute('refines') === `#${titleId}` && el.getAttribute('property') === 'file-as') remove(el);
    }
    for (const extra of old.slice(1)) { if (extra.getAttribute('id')) removedIds.add(extra.getAttribute('id')!); remove(extra); }
  }
  if (version.startsWith('3')) {
    const modified = descendants(parts.metadata, 'meta', OPF).filter(el => el.getAttribute('property') === 'dcterms:modified');
    const el = modified[0] || doc.createElementNS(OPF, 'meta');
    el.setAttribute('property', 'dcterms:modified');
    el.removeAttribute('refines');
    el.textContent = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (!modified.length) parts.metadata.appendChild(el);
    for (const extra of modified.slice(1)) remove(extra);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of descendants(parts.metadata, 'meta', OPF)) {
      const refines = el.getAttribute('refines') || '';
      if (refines.startsWith('#') && removedIds.has(refines.slice(1))) { if (el.getAttribute('id')) removedIds.add(el.getAttribute('id')!); remove(el); changed = true; }
      if (el.getAttribute('name') === 'cover' && removedIds.has(el.getAttribute('content') || '')) remove(el);
    }
  }
  const title = descendants(parts.metadata, 'title', DC)[0]?.textContent || book.info.name;
  const language = descendants(parts.metadata, 'language', DC)[0]?.textContent || 'en';
  let navPath = book.epub.navPath;
  if (version.startsWith('3')) {
    if (!navPath || removedPaths.has(navPath)) {
      let number = 0;
      do { navPath = localRef(packagePath, `splicer-nav${number++ || ''}.xhtml`); } while (own(entries, navPath));
      let id = 'splicer-nav';
      while (Array.from(doc.getElementsByTagName('*')).some(el => el.getAttribute('id') === id)) id += '-nav';
      const item = doc.createElementNS(OPF, 'item');
      item.setAttribute('id', id); item.setAttribute('href', relativePath(packagePath, navPath)); item.setAttribute('media-type', 'application/xhtml+xml'); item.setAttribute('properties', 'nav'); manifest.appendChild(item);
      entries[navPath] = strToU8(`<html xmlns="${XHTML}" xmlns:epub="${EPUB}"><head><title>Contents</title></head><body/></html>`);
    }
    const nav = documentAt(entries, navPath, XHTML, 'html');
    const body = descendants(nav, 'body', XHTML)[0];
    if (!body) throw new Error('EPUB navigation body is missing.');
    const toc = xml(`<nav xmlns="${XHTML}" xmlns:epub="${EPUB}" epub:type="toc"><h1>${escapeXml(title)}</h1><ol>${order.map(id => `<li><a href="${escapeXml(relativePath(navPath!, units.get(id)!.path!))}">${escapeXml(units.get(id)!.title)}</a></li>`).join('')}</ol></nav>`).documentElement;
    const oldToc = descendants(nav, 'nav', XHTML).find(el => tokens(el.getAttributeNS(EPUB, 'type')).includes('toc'));
    if (oldToc?.getAttribute('id')) toc.setAttribute('id', oldToc.getAttribute('id')!);
    for (const old of descendants(nav, 'nav', XHTML).filter(el => tokens(el.getAttributeNS(EPUB, 'type')).includes('toc'))) remove(old);
    body.appendChild(nav.importNode(toc, true));
    nav.documentElement.setAttribute('lang', language);
    nav.documentElement.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', language);
    for (const el of descendants(nav, 'title', XHTML)) el.textContent = title;
    pruneLinks(nav, navPath, removedPaths, warnings, true);
    for (const el of descendants(nav, 'nav', XHTML)) if (!descendants(el, 'a', XHTML).length) remove(el);
    entries[navPath] = strToU8(serialize(nav));
  }
  if (book.epub.ncxPath && !removedPaths.has(book.epub.ncxPath)) {
    const path = book.epub.ncxPath;
    const ncx = documentAt(entries, path, NCX, 'ncx');
    for (const local of ['navMap', 'pageList', 'navList']) for (const el of children(ncx.documentElement, local, NCX)) remove(el);
    const ncxIds = new Set(Array.from(ncx.getElementsByTagName('*')).map(el => el.getAttribute('id')).filter(Boolean));
    const map = xml(`<navMap xmlns="${NCX}">${order.map((id, index) => {
      let pointId = `splicer-${index + 1}`;
      while (ncxIds.has(pointId)) pointId += '-point';
      ncxIds.add(pointId);
      return `<navPoint id="${pointId}" playOrder="${index + 1}"><navLabel><text>${escapeXml(units.get(id)!.title)}</text></navLabel><content src="${escapeXml(relativePath(path, units.get(id)!.path!))}"/></navPoint>`;
    }).join('')}</navMap>`).documentElement;
    const navMap = ncx.documentElement.appendChild(ncx.importNode(map, true));
    for (const el of descendants(ncx, 'docTitle', NCX)) { el.textContent = ''; const text = ncx.createElementNS(NCX, 'text'); text.textContent = title; el.appendChild(text); }
    if (metadata.author !== undefined) {
      const authors = children(ncx.documentElement, 'docAuthor', NCX);
      const author = authors[0] || ncx.createElementNS(NCX, 'docAuthor');
      author.textContent = '';
      const text = ncx.createElementNS(NCX, 'text'); text.textContent = metadata.author; author.appendChild(text);
      if (!authors.length) ncx.documentElement.insertBefore(author, navMap);
      for (const extra of authors.slice(1)) remove(extra);
    }
    const head = children(ncx.documentElement, 'head', NCX)[0];
    if (!head) throw new Error('NCX head is missing.');
    const uid = descendants(parts.metadata, 'identifier', DC).find(el => el.getAttribute('id') === doc.documentElement.getAttribute('unique-identifier'))?.textContent?.trim();
    if (!uid) throw new Error('EPUB identifier is missing.');
    for (const [name, value] of Object.entries({ 'dtb:uid': uid, 'dtb:depth': '1', 'dtb:totalPageCount': '0', 'dtb:maxPageNumber': '0' })) {
      const old = children(head, 'meta', NCX).filter(el => el.getAttribute('name') === name);
      const el = old[0] || ncx.createElementNS(NCX, 'meta');
      el.setAttribute('name', name); el.setAttribute('content', value);
      if (!old.length) head.appendChild(el);
      for (const extra of old.slice(1)) remove(extra);
    }
    const ncxItem = children(manifest, 'item', OPF).find(item => itemPath(packagePath, item) === path);
    if (ncxItem) spine.setAttribute('toc', ncxItem.getAttribute('id')!);
    entries[path] = strToU8(serialize(ncx));
  }
  for (const item of children(manifest, 'item', OPF)) {
    const path = itemPath(packagePath, item);
    const mime = item.getAttribute('media-type');
    if (!['application/xhtml+xml', 'image/svg+xml'].includes(mime || '') || path === navPath) continue;
    const chapter = documentAt(entries, path, mime === 'image/svg+xml' ? SVG : XHTML, mime === 'image/svg+xml' ? 'svg' : 'html');
    pruneLinks(chapter, path, removedPaths, warnings);
    if (version.startsWith('3') && mime === 'application/xhtml+xml') {
      const properties = new Set(tokens(item.getAttribute('properties')));
      if (descendants(chapter, 'svg', SVG).length) properties.add('svg');
      if (descendants(chapter, 'math', MATH).length) properties.add('mathml');
      if (properties.size) item.setAttribute('properties', [...properties].join(' '));
    }
    entries[path] = strToU8(serialize(chapter));
  }
  const retained: Entries = Object.create(null);
  for (const item of children(manifest, 'item', OPF)) retained[itemPath(packagePath, item)] = entries[itemPath(packagePath, item)];
  for (const item of children(manifest, 'item', OPF)) validateContent(retained, itemPath(packagePath, item), item.getAttribute('media-type') || '');
  entries[packagePath] = strToU8(serialize(doc));
  entries['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><container xmlns="${CONTAINER}" version="1.0"><rootfiles><rootfile full-path="${escapeXml(packagePath)}" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  if (own(entries, 'META-INF/signatures.xml')) { delete entries['META-INF/signatures.xml']; warnings.push('Removed digital signatures invalidated by EPUB edits.'); }
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = Object.create(null);
  files.mimetype = [strToU8('application/epub+zip'), { level: 0 }];
  for (const [path, bytes] of Object.entries(entries)) if (path !== 'mimetype') files[path] = bytes;
  progress?.(80, 'Compressing EPUB');
  const bytes = zipSync(files);
  progress?.(100, 'EPUB exported');
  return { bytes, mime: 'application/epub+zip', extension: 'epub', warnings: [...new Set(warnings)] };
}

function rasterData(entries: Entries, base: string, ref: string, maxBytes: number): string | undefined {
  try {
    const path = localRef(base, ref);
    if (!own(entries, path)) return;
    const bytes = entries[path];
    if (Math.ceil(bytes.length / 3) * 4 > maxBytes) return;
    const mime = assertRasterBudget(bytes)?.mime;
    if (!mime) return;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${mime};base64,${btoa(binary)}`;
  } catch { return; }
}

export function previewEpub(book: ParsedBook, id: string): PreviewResult {
  const unit = book.info.units.find(unit => unit.id === id);
  if (!book.entries || !unit?.path) throw new Error('Unknown EPUB chapter.');
  const chapter = documentAt(book.entries, unit.path, XHTML, 'html');
  const body = descendants(chapter, 'body', XHTML)[0];
  if (!body) throw new Error('EPUB chapter body is missing.');
  const allowed = new Set('p div span section article main header footer aside h1 h2 h3 h4 h5 h6 blockquote pre code em strong b i u s small sub sup br hr ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption img ruby rt rp abbr cite q time'.split(' '));
  const blocked = new Set('script style link meta base iframe frame frameset object embed form input button textarea select option audio video source track svg math template noscript canvas'.split(' '));
  let imageBudget = 8 * 1024 * 1024;
  // ponytail: discard publisher CSS, add a real CSS parser if faithful preview is needed.
  function clean(node: Node): string {
    if (node.nodeType === 3 || node.nodeType === 4) return escapeXml(node.nodeValue || '');
    if (node.nodeType !== 1) return '';
    const el = node as Element;
    if (el.namespaceURI === MATH) return escapeXml(el.textContent || '');
    if (el.namespaceURI !== XHTML || blocked.has(el.localName)) return '';
    const content = Array.from(el.childNodes).map(clean).join('');
    const tag = el.localName === 'a' ? 'span' : el.localName;
    if (!allowed.has(tag)) return content;
    let attrs = '';
    for (const name of ['title', 'lang', 'dir', 'alt', 'colspan', 'rowspan']) {
      const value = el.getAttribute(name);
      if (value && (name !== 'dir' || /^(ltr|rtl|auto)$/.test(value)) && (!['colspan', 'rowspan'].includes(name) || /^\d{1,3}$/.test(value))) attrs += ` ${name}="${escapeXml(value)}"`;
    }
    if (tag === 'img') {
      const data = rasterData(book.entries!, unit!.path!, el.getAttribute('src') || '', imageBudget);
      if (data) imageBudget -= data.length;
      return data ? `<img src="${data}"${attrs}>` : escapeXml(el.getAttribute('alt') || '');
    }
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    return `<${tag}${attrs}>${content}</${tag}>`;
  }
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src 'none'; child-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; media-src 'none'";
  return { html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escapeXml(csp)}"><meta charset="utf-8"><style>body{font:18px/1.7 Georgia,serif;margin:0 auto;padding:24px;max-width:48rem;overflow-wrap:anywhere;color:#202020;background:#fff}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}td,th{padding:.3em}blockquote{margin-inline:1em}</style></head><body>${Array.from(body.childNodes).map(clean).join('')}</body></html>` };
}
