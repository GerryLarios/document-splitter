import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { exportEpub, parseEpub, previewEpub } from '../src/lib/formats/epub';
import { readZip } from '../src/lib/archive';
import { DEFAULT_LIMITS, type Entries } from '../src/lib/types';
import { elements, xml } from '../src/lib/xml';
import { png } from './fixtures/original';

const OPF = 'http://www.idpf.org/2007/opf';
const XHTML = 'http://www.w3.org/1999/xhtml';
const DC = 'http://purl.org/dc/elements/1.1/';
function fixture(version = '3.0'): Entries {
  const files: Record<string, string | Uint8Array> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<package xmlns="${OPF}" version="${version}" unique-identifier="uid"><metadata xmlns:dc="${DC}"><dc:identifier id="uid">urn:uuid:unchanged</dc:identifier><dc:title>Original</dc:title><dc:creator id="author">Writer</dc:creator><dc:creator id="author2">Second</dc:creator><dc:language>en</dc:language><meta property="role" refines="#author2">aut</meta><meta property="test" refines="#gone">stale</meta></metadata><manifest><item id="first" href="text/z.xhtml" media-type="application/xhtml+xml"/><item id="gone" href="text/a.xhtml" media-type="application/xhtml+xml"/><item id="last" href="text/m.xhtml" media-type="application/xhtml+xml"/><item id="css" href="styles/book.css" media-type="text/css"/><item id="pic" href="images/p.png" media-type="image/png" properties="cover-image"/><item id="font" href="fonts/f.woff" media-type="font/woff"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${version.startsWith('3') ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}</manifest><spine toc="ncx"><itemref idref="first" linear="no" id="ref-first"/><itemref idref="gone"/><itemref idref="last"/></spine><guide><reference type="text" title="Removed" href="text/a.xhtml"/></guide></package>`,
    'OPS/text/z.xhtml': `<html xmlns="${XHTML}"><head><title>Head first</title><link rel="stylesheet" href="../styles/book.css"/></head><body><h1>Heading first</h1><p><a href="a.xhtml#old" class="kept">Before <em>child</em></a></p><img src="../images/p.png" alt="Cover"/></body></html>`,
    'OPS/text/a.xhtml': `<html xmlns="${XHTML}"><head><title>Removed</title></head><body><h1>Removed</h1></body></html>`,
    'OPS/text/m.xhtml': `<html xmlns="${XHTML}"><head><title>Last</title></head><body><h1>Last</h1><a href="https://example.com">Inert preview</a></body></html>`,
    'OPS/toc.ncx': '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:unchanged"/></head><docTitle><text>Original</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>NCX First</text></navLabel><content src="text/z.xhtml"/></navPoint><navPoint id="n2" playOrder="2"><navLabel><text>NCX Removed</text></navLabel><content src="text/a.xhtml"/></navPoint><navPoint id="n3" playOrder="3"><navLabel><text>NCX Last</text></navLabel><content src="text/m.xhtml"/></navPoint></navMap></ncx>',
    'OPS/styles/book.css': '@font-face{font-family:test;src:url("../fonts/f.woff")}body{background-image:url(../images/p.png)}',
    'OPS/fonts/f.woff': new Uint8Array([119, 79, 70, 70]),
    'OPS/images/p.png': png(),
  };
  if (version.startsWith('3')) files['OPS/nav.xhtml'] = `<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="text/z.xhtml">Nav First</a></li><li><a href="text/a.xhtml">Nav Removed</a></li><li><a href="text/m.xhtml">Nav Last</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a href="text/a.xhtml">Old landmark</a></li></ol></nav></body></html>`;
  return unzipSync(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value]))));
}
const parse = (entries: Entries) => parseEpub(entries, 'fixture.epub', 1000, DEFAULT_LIMITS);
const text = (entries: Entries, path: string) => strFromU8(entries[path]);
function replace(entries: Entries, path: string, from: string, to: string) { entries[path] = strToU8(text(entries, path).replace(from, to)); }

for (const version of ['2.0', '3.0']) test(`EPUB ${version}: spine order, export resources, metadata, navigation and deleted links`, () => {
  const source = fixture(version);
  const book = parse(source);
  assert.deepEqual(book.info.units.map(unit => unit.id), ['first', 'gone', 'last']);
  assert.match(book.info.units[0].title, /First/);
  const result = exportEpub(book, ['last', 'first'], { title: 'Edited & title', author: 'New author', language: 'fr', description: 'New <description>' });
  const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0, 'mimetype must be stored');
  const nameLength = view.getUint16(26, true);
  assert.equal(strFromU8(result.bytes.subarray(30, 30 + nameLength)), 'mimetype');
  const out = readZip(result.bytes, DEFAULT_LIMITS);
  assert.equal(text(out, 'mimetype'), 'application/epub+zip');
  assert.equal(out['OPS/text/a.xhtml'], undefined);
  for (const path of ['OPS/styles/book.css', 'OPS/images/p.png', 'OPS/fonts/f.woff']) assert.deepEqual(out[path], source[path]);
  const opf = xml(text(out, 'OPS/book.opf'));
  assert.deepEqual(elements(opf, 'itemref').map(el => el.getAttribute('idref')), ['last', 'first']);
  assert.equal(elements(opf, 'itemref')[1].getAttribute('linear'), 'no');
  assert.equal(elements(opf, 'itemref')[1].getAttribute('id'), 'ref-first');
  assert.equal(elements(opf, 'identifier')[0].textContent, 'urn:uuid:unchanged');
  assert.equal(opf.documentElement.getAttribute('version'), version);
  assert.equal(elements(opf, 'title')[0].namespaceURI, DC);
  assert.equal(elements(opf, 'title')[0].textContent, 'Edited & title');
  assert.equal(elements(opf, 'creator')[0].textContent, 'New author');
  assert.equal(elements(opf, 'language')[0].textContent, 'fr');
  assert.equal(elements(opf, 'description')[0].textContent, 'New <description>');
  assert.equal(elements(opf, 'reference').length, 0);
  assert.ok(!elements(opf, 'meta').some(el => ['#gone', '#author2'].includes(el.getAttribute('refines') || '')));
  const chapter = text(out, 'OPS/text/z.xhtml');
  assert.match(chapter, /<span class="kept">Before <em>child<\/em><\/span>/);
  assert.ok(!chapter.includes('a.xhtml'));
  assert.ok(result.warnings?.length);
  const ncx = xml(text(out, 'OPS/toc.ncx'));
  assert.deepEqual(elements(ncx, 'content').map(el => el.getAttribute('src')), ['text/m.xhtml', 'text/z.xhtml']);
  for (const name of ['dtb:uid', 'dtb:depth', 'dtb:totalPageCount', 'dtb:maxPageNumber']) assert.equal(elements(ncx, 'meta').filter(el => el.getAttribute('name') === name).length, 1);
  assert.equal(elements(ncx, 'meta').find(el => el.getAttribute('name') === 'dtb:uid')?.getAttribute('content'), 'urn:uuid:unchanged');
  if (version.startsWith('3')) {
    assert.deepEqual(elements(xml(text(out, 'OPS/nav.xhtml')), 'a').map(el => el.getAttribute('href')), ['text/m.xhtml', 'text/z.xhtml']);
    assert.match(text(out, 'OPS/book.opf'), /dcterms:modified/);
  }
  assert.deepEqual(parse(out).info.units.map(unit => unit.id), ['last', 'first']);
  assert.deepEqual(source['OPS/text/a.xhtml'], book.entries!['OPS/text/a.xhtml'], 'export leaves source untouched');
});

test('preview permits no source executable markup, network URLs or publisher CSS', () => {
  const book = parse(fixture());
  const html = previewEpub(book, 'first').html!;
  assert.match(html, /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src &apos;none&apos;/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Before <em>child<\/em>/);
  assert.ok(!html.includes('href=') && !html.includes('@font-face'));
  book.entries!['OPS/text/z.xhtml'] = strToU8(`<html xmlns="${XHTML}"><head><title>X</title></head><body><script>alert(1)</script><base href="https://evil.test"/><meta http-equiv="refresh" content="0;url=https://evil.test"/><form><input/></form><svg xmlns="http://www.w3.org/2000/svg"><script/></svg><p onclick="evil()" style="background:url(https://evil.test)">Safe</p><img src="../../../../secret"/><a href="javascript:evil()">Link</a></body></html>`);
  const hostile = previewEpub(book, 'first').html!;
  assert.ok(!/evil|onclick|<script|<form|<base|<svg|<input|href=/.test(hostile));
  assert.match(hostile, /<p>Safe<\/p>/);
  assert.match(hostile, /<span>Link<\/span>/);
});

test('generated nav avoids filename collisions', () => {
  const entries = fixture();
  replace(entries, 'OPS/book.opf', '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '');
  entries['OPS/splicer-nav.xhtml'] = strToU8('do not overwrite');
  const book = parse(entries);
  assert.ok(book.info.warnings.some(warning => warning.includes('navigation')));
  const out = readZip(exportEpub(book, ['first'], {}).bytes, DEFAULT_LIMITS);
  assert.equal(text(out, 'OPS/splicer-nav.xhtml'), 'do not overwrite');
  assert.ok(out['OPS/splicer-nav1.xhtml']);
  assert.equal(parse(out).epub?.navPath, 'OPS/splicer-nav1.xhtml');
});

test('EPUB 2 accepts standard XHTML and NCX external DTD declarations without fetching entities', () => {
  const entries = fixture('2.0');
  entries['OPS/text/z.xhtml'] = strToU8('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">' + text(entries, 'OPS/text/z.xhtml'));
  entries['OPS/toc.ncx'] = strToU8('<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">' + text(entries, 'OPS/toc.ncx'));
  assert.equal(parse(entries).info.units[0].title, 'NCX First');
  entries['OPS/text/z.xhtml'] = strToU8(text(entries, 'OPS/text/z.xhtml').replace('<!DOCTYPE html PUBLIC', '<!DOCTYPE html SYSTEM'));
  assert.throws(() => parse(entries), /document types/);
});

test('EPUB 3 accepts HTML5 doctype, rejects internal entities and invalid export language', () => {
  const entries = fixture();
  entries['OPS/text/z.xhtml'] = strToU8('<!doctype html>' + text(entries, 'OPS/text/z.xhtml'));
  const book = parse(entries);
  assert.equal(book.info.units.length, 3);
  assert.throws(() => exportEpub(book, ['first'], { language: 'not a language' }), /language tag/);
  entries['OPS/text/z.xhtml'] = strToU8('<!DOCTYPE html [<!ENTITY bad "bad">]>' + text(entries, 'OPS/text/z.xhtml'));
  assert.throws(() => parse(entries), /document types/);
});

test('rejects DRM and explicitly identifies unsupported font obfuscation', () => {
  for (const [algorithm, message] of [['http://www.idpf.org/2008/embedding', /Obfuscated EPUB fonts/], ['http://ns.adobe.com/pdf/enc#RC', /Obfuscated EPUB fonts/], ['http://www.w3.org/2001/04/xmlenc#aes256-cbc', /DRM/]] as const) {
    const entries = fixture();
    entries['META-INF/encryption.xml'] = strToU8(`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="OPS/fonts/f.woff"/></CipherData></EncryptedData></encryption>`);
    assert.throws(() => parse(entries), message);
  }
});

test('rejects fixed layout, vendor metadata, spine overrides and unsupported profiles', () => {
  for (const marker of ['<meta property="rendition:layout">pre-paginated</meta>', '<meta name="fixed-layout" content="true"/>', '<meta name="original-resolution" content="1200x800"/>', '<meta name="ibooks:fixed-layout" content="true"/>', '<dc:type>comic</dc:type>']) {
    const entries = fixture(); replace(entries, 'OPS/book.opf', '</metadata>', `${marker}</metadata>`);
    assert.throws(() => parse(entries), /Fixed-layout|multimodal|Multimodal/);
  }
  for (const properties of ['rendition:layout-pre-paginated', 'page-spread-left']) {
    const entries = fixture(); replace(entries, 'OPS/book.opf', 'idref="gone"', `idref="gone" properties="${properties}"`);
    assert.throws(() => parse(entries), /spine overrides/);
  }
  for (const attr of ['properties="scripted"', 'properties="remote-resources"', 'media-overlay="audio"']) {
    const entries = fixture(); replace(entries, 'OPS/book.opf', 'id="first"', `id="first" ${attr}`);
    assert.throws(() => parse(entries), /unsupported/);
  }
});

test('rejects malformed namespaces, XML, missing resources and unsafe paths', () => {
  const cases: Array<(entries: Entries) => void> = [
    entries => replace(entries, 'OPS/book.opf', OPF, 'https://wrong.test'),
    entries => replace(entries, 'OPS/book.opf', '</manifest>', '</wrong>'),
    entries => replace(entries, 'OPS/book.opf', 'text/z.xhtml', '../../../escape.xhtml'),
    entries => replace(entries, 'OPS/book.opf', 'text/z.xhtml', 'https://evil.test/a.xhtml'),
    entries => replace(entries, 'OPS/book.opf', 'text/z.xhtml', '%2e%2e/%2e%2e/escape.xhtml'),
    entries => { entries['../escape'] = strToU8('x'); },
    entries => { delete entries['OPS/images/p.png']; },
    entries => replace(entries, 'OPS/styles/book.css', '../fonts/f.woff', 'https://evil.test/f.woff'),
    entries => { entries['OPS/styles/hidden.css'] = strToU8('body{background:url(https://evil.test/p.png)}'); entries['OPS/styles/book.css'] = strToU8('@import "hidden.css";'); },
    entries => { entries['OPS/styles/book.css'] = strToU8('body{background:image-set("https://evil.test/p.png" 1x)}'); },
    entries => replace(entries, 'OPS/text/z.xhtml', '../images/p.png', 'https://evil.test/p.png'),
    entries => replace(entries, 'OPS/text/z.xhtml', '<h1>', '<script>'),
    entries => replace(entries, 'OPS/text/z.xhtml', '<body>', '<body onload="evil()">'),
    entries => replace(entries, 'OPS/text/z.xhtml', '<body>', '<body><meta http-equiv="refresh" content="0;url=https://evil.test"/>'),
    entries => replace(entries, 'OPS/text/z.xhtml', 'a.xhtml#old', 'javascript:evil()'),
    entries => replace(entries, 'OPS/text/z.xhtml', '<body>', '<body><iframe src="evil"/>'),
    entries => replace(entries, 'OPS/text/z.xhtml', '<body>', '<body><math xmlns="http://www.w3.org/1998/Math/MathML"><script/></math>'),
    entries => replace(entries, 'OPS/text/z.xhtml', '<body>', '<body><img srcset="https://evil.test/a.png 1x"/>'),
  ];
  for (const change of cases) { const entries = fixture(); change(entries); assert.throws(() => parse(entries)); }
  assert.throws(() => parseEpub(fixture(), 'large.epub', DEFAULT_LIMITS.fileBytes + 1, DEFAULT_LIMITS), /limits/);
  assert.throws(() => exportEpub(parse(fixture()), ['first', 'first'], {}), /unique/);
  assert.throws(() => exportEpub(parse(fixture()), ['unknown'], {}), /unique/);
});

test('normal reflowable rendition hints, publisher CSS escapes, SVG and MathML survive export', () => {
  const entries = fixture();
  replace(entries, 'OPS/book.opf', '</metadata>', '<meta property="rendition:layout">reflowable</meta><meta property="rendition:orientation">portrait</meta><meta property="rendition:spread">auto</meta><meta name="ibooks:specified-fonts" content="true"/></metadata>');
  replace(entries, 'OPS/book.opf', 'idref="last"', 'idref="last" properties="rendition:layout-reflowable rendition:orientation-landscape rendition:spread-none"');
  replace(entries, 'OPS/book.opf', 'id="first"', 'id="first" properties="svg mathml"');
  replace(entries, 'OPS/text/z.xhtml', '<body>', '<body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="a.xhtml"><text>Old SVG link</text></a><rect width="10" height="10"/></svg><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math>');
  replace(entries, 'OPS/text/z.xhtml', '<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1"/>');
  entries['OPS/styles/book.css'] = strToU8('/* publisher comment */ p::before{content:"\\2022"}body{background:url(../images/p.png)}');
  const book = parse(entries);
  const out = readZip(exportEpub(book, ['last', 'first'], {}).bytes, DEFAULT_LIMITS);
  assert.deepEqual(out['OPS/styles/book.css'], entries['OPS/styles/book.css']);
  assert.match(text(out, 'OPS/text/z.xhtml'), /<math/);
  assert.match(text(out, 'OPS/text/z.xhtml'), /<g><text>Old SVG link<\/text><\/g>/);
  assert.match(text(out, 'OPS/book.opf'), /rendition:orientation-landscape/);
  assert.deepEqual(parse(out).info.units.map(unit => unit.id), ['last', 'first']);
  assert.match(previewEpub(book, 'first').html!, /x\+1/);
  entries['OPS/styles/book.css'] = strToU8('body{background:u\\72l(https://evil.test/p.png)}');
  assert.throws(() => parse(entries), /Remote/);
});

test('metadata edits clear stale file-as, preserve identifiers and unchanged multiauthor metadata, update NCX author', () => {
  for (const version of ['2.0', '3.0']) {
    const entries = fixture(version);
    replace(entries, 'OPS/book.opf', '<dc:creator id="author">', '<dc:creator xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="Writer, Old" id="author">');
    replace(entries, 'OPS/book.opf', '</metadata>', '<meta property="file-as" refines="#author">Writer, Old</meta><dc:identifier id="other">isbn:retained</dc:identifier></metadata>');
    replace(entries, 'OPS/toc.ncx', '<navMap>', '<docAuthor><text>Writer</text></docAuthor><navMap>');
    const book = parse(entries);
    const unchanged = readZip(exportEpub(book, ['last', 'first'], book.info.metadata).bytes, DEFAULT_LIMITS);
    assert.equal(elements(xml(text(unchanged, 'OPS/book.opf')), 'creator').length, 2);
    const out = readZip(exportEpub(book, ['last', 'first'], { author: 'New Writer' }).bytes, DEFAULT_LIMITS);
    const opf = xml(text(out, 'OPS/book.opf'));
    assert.deepEqual(elements(opf, 'identifier').map(el => el.textContent), ['urn:uuid:unchanged', 'isbn:retained']);
    assert.equal(elements(opf, 'creator')[0].hasAttributeNS(OPF, 'file-as'), false);
    assert.ok(!elements(opf, 'meta').some(el => el.getAttribute('property') === 'file-as'));
    assert.equal(elements(xml(text(out, 'OPS/toc.ncx')), 'docAuthor')[0].textContent, 'New Writer');
  }
});

test('EPUB 3 missing TOC and modification timestamp repaired; EPUB 2 NCX author added if absent', () => {
  const epub3 = fixture();
  replace(epub3, 'OPS/nav.xhtml', 'epub:type="toc"', 'epub:type="other"');
  const book = parse(epub3);
  assert.ok(book.info.warnings.some(warning => warning.includes('table of contents')));
  assert.ok(book.info.warnings.some(warning => warning.includes('modification timestamp')));
  const out = readZip(exportEpub(book, ['first'], {}).bytes, DEFAULT_LIMITS);
  const opf = xml(text(out, 'OPS/book.opf'));
  assert.match(elements(opf, 'meta').find(el => el.getAttribute('property') === 'dcterms:modified')?.textContent || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(elements(xml(text(out, 'OPS/nav.xhtml')), 'nav').filter(el => el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'toc').length, 1);
  const epub2 = readZip(exportEpub(parse(fixture('2.0')), ['first'], { author: 'Updated' }).bytes, DEFAULT_LIMITS);
  assert.equal(elements(xml(text(epub2, 'OPS/toc.ncx')), 'docAuthor')[0].textContent, 'Updated');
});

test('nav replacement preserves TOC id, avoids other ids, repairs removed spine nav and empty landmarks', () => {
  const entries = fixture();
  replace(entries, 'OPS/nav.xhtml', '<body>', '<body><p id="splicer-toc">Keep this id</p>');
  replace(entries, 'OPS/nav.xhtml', '<nav epub:type="toc">', '<nav epub:type="toc" id="original-toc">');
  const book = parse(entries);
  const out = readZip(exportEpub(book, ['last', 'first'], {}).bytes, DEFAULT_LIMITS);
  const nav = xml(text(out, 'OPS/nav.xhtml'));
  const ids = Array.from(nav.getElementsByTagName('*')).map(el => el.getAttribute('id')).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(elements(nav, 'nav')[0].getAttribute('id'), 'original-toc');
  assert.equal(elements(nav, 'nav').length, 1);
  replace(entries, 'OPS/book.opf', '<spine toc="ncx">', '<spine toc="ncx"><itemref idref="nav" linear="no"/>');
  const removed = readZip(exportEpub(parse(entries), ['last', 'first'], {}).bytes, DEFAULT_LIMITS);
  assert.equal(removed['OPS/nav.xhtml'], undefined);
  assert.ok(removed['OPS/splicer-nav.xhtml']);
  const repaired = parse(removed);
  assert.equal(repaired.epub?.navPath, 'OPS/splicer-nav.xhtml');
  assert.deepEqual(repaired.info.units.map(unit => unit.id), ['last', 'first']);
});

test('nonspine XHTML TOC links pruned, XHTML head/title/body constraints checked, linear-only selection repaired', () => {
  const entries = fixture();
  replace(entries, 'OPS/book.opf', '</manifest>', '<item id="extra" href="extra.xhtml" media-type="application/xhtml+xml"/></manifest>');
  entries['OPS/extra.xhtml'] = strToU8(`<html xmlns="${XHTML}"><head><title>Extra</title></head><body><a href="text/a.xhtml"><em>Gone</em></a></body></html>`);
  const result = exportEpub(parse(entries), ['first'], {});
  const out = readZip(result.bytes, DEFAULT_LIMITS);
  assert.match(text(out, 'OPS/extra.xhtml'), /<span><em>Gone<\/em><\/span>/);
  assert.equal(elements(xml(text(out, 'OPS/book.opf')), 'itemref')[0].getAttribute('linear'), 'yes');
  assert.ok(result.warnings?.some(message => message.includes('linear')));
  assert.equal(elements(xml(text(out, 'OPS/text/z.xhtml')), 'title').length, 1);
  for (const change of [
    (files: Entries) => replace(files, 'OPS/text/z.xhtml', '<title>Head first</title>', ''),
    (files: Entries) => replace(files, 'OPS/text/z.xhtml', '</head>', '<title>Duplicate</title></head>'),
    (files: Entries) => replace(files, 'OPS/text/z.xhtml', '<body>', '<body><p id="same"/><p id="same"/>'),
    (files: Entries) => { replace(files, 'OPS/book.opf', 'idref="gone"', 'idref="gone" linear="no"'); replace(files, 'OPS/book.opf', 'idref="last"', 'idref="last" linear="no"'); },
  ]) { const files = fixture(); change(files); assert.throws(() => parse(files)); }
});

test('preview repeated images respect aggregate data budget, oversized images fall back to alt', () => {
  const entries = fixture();
  const image = new Uint8Array(1024 * 1024);
  image.set(entries['OPS/images/p.png']);
  entries['OPS/images/p.png'] = image;
  const repeated = '<img src="../images/p.png" alt="Budget fallback"/>'.repeat(30);
  replace(entries, 'OPS/text/z.xhtml', '<body>', `<body>${repeated}`);
  const html = previewEpub(parse(entries), 'first').html!;
  assert.ok(html.length < 8 * 1024 * 1024 + 10000);
  assert.match(html, /Budget fallback/);
  assert.ok((html.match(/data:image\/png/g) || []).length < 30);
});
