import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { exportEpub, parseEpub } from '../src/lib/formats/epub';
import { DEFAULT_LIMITS } from '../src/lib/types';
import { elements, xml } from '../src/lib/xml';
import { fixture } from './fixtures/valid-epub';

for (const version of ['2.0', '3.0'] as const) test(`valid EPUB ${version}: selection, metadata, namespaces and resource references`, () => {
  const source = fixture(version);
  const book = parseEpub(source, 'valid.epub', 1000, DEFAULT_LIMITS);
  assert.deepEqual(book.info.units.map(unit => unit.id), ['first', 'last']);
  for (const order of [['last', 'first'], ['first']]) {
    const out = unzipSync(exportEpub(book, order, { title: 'Edited & Book', author: 'New Author', language: 'fr', description: 'New <description>' }).bytes);
    const opf = xml(strFromU8(out['OPS/book.opf']));
    assert.equal(opf.documentElement.namespaceURI, 'http://www.idpf.org/2007/opf');
    assert.equal(opf.documentElement.getAttribute('version'), version);
    assert.deepEqual(elements(opf, 'itemref').map(el => el.getAttribute('idref')), order);
    for (const [name, value] of Object.entries({ title: 'Edited & Book', creator: 'New Author', language: 'fr', description: 'New <description>' })) {
      const el = elements(opf, name)[0];
      assert.equal(el.namespaceURI, 'http://purl.org/dc/elements/1.1/');
      assert.equal(el.textContent, value);
    }
    for (const item of elements(opf, 'item')) assert.ok(out[`OPS/${item.getAttribute('href')}`]);
    const ncx = xml(strFromU8(out['OPS/toc.ncx']));
    assert.equal(ncx.documentElement.namespaceURI, 'http://www.daisy.org/z3986/2005/ncx/');
    assert.deepEqual(elements(ncx, 'content').map(el => el.getAttribute('src')), order.map(id => `text/${id}.xhtml`));
    if (version === '3.0') {
      const nav = xml(strFromU8(out['OPS/nav.xhtml']));
      assert.equal(nav.documentElement.namespaceURI, 'http://www.w3.org/1999/xhtml');
      assert.equal(elements(nav, 'nav')[0].getAttributeNS('http://www.idpf.org/2007/ops', 'type'), 'toc');
      assert.deepEqual(elements(nav, 'a').map(el => el.getAttribute('href')), order.map(id => `text/${id}.xhtml`));
    }
    for (const path of ['OPS/styles/book.css', 'OPS/images/p.png']) assert.deepEqual(out[path], source[path]);
    assert.equal(out['OPS/text/last.xhtml'] !== undefined, order.includes('last'));
  }
});
