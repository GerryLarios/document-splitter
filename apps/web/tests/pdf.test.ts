import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { exportPdf, parsePdf } from '../src/lib/formats/pdf';
import { DEFAULT_LIMITS } from '../src/lib/types';

test('PDF selected page order and all editable metadata survive export', async () => {
  const source = await PDFDocument.create();
  source.addPage([100, 200]); source.addPage([300, 400]); source.addPage([500, 600]);
  source.setTitle('Original'); source.setAuthor('Author'); source.setSubject('Subject');
  source.setKeywords(['one', 'two']); source.setCreator('Creator'); source.setProducer('Producer');
  const book = await parsePdf(await source.save(), 'original.pdf', DEFAULT_LIMITS);
  assert.equal(book.info.metadata.title, 'Original'); assert.equal(book.info.metadata.author, 'Author');
  assert.equal(book.info.metadata.subject, 'Subject'); assert.equal(book.info.metadata.creator, 'Creator');
  assert.equal(book.info.metadata.producer, 'Producer'); assert.match(book.info.metadata.keywords, /one.*two/);
  const metadata = { title: 'Selected', author: 'New Author', subject: 'New Subject', keywords: 'alpha, beta', creator: 'New Creator', producer: 'New Producer' };
  const result = await exportPdf(book, ['page-3', 'page-1'], metadata);
  const exported = await PDFDocument.load(result.bytes, { updateMetadata: false });
  assert.deepEqual(exported.getPages().map(page => page.getSize()), [{ width: 500, height: 600 }, { width: 100, height: 200 }]);
  const roundtrip = await parsePdf(result.bytes, 'selected.pdf', DEFAULT_LIMITS);
  assert.deepEqual(roundtrip.info.metadata, { ...metadata, keywords: 'alpha beta' });
  await assert.rejects(exportPdf(book, [], metadata), /unique/i);
  await assert.rejects(exportPdf(book, ['page-1', 'page-1'], metadata), /unique/i);
  await assert.rejects(exportPdf(book, ['missing'], metadata), /unknown/i);
  await assert.rejects(parsePdf(book.bytes!, 'large.pdf', { ...DEFAULT_LIMITS, fileBytes: 1 }), /limit/i);
  await assert.rejects(parsePdf(book.bytes!, 'many.pdf', { ...DEFAULT_LIMITS, units: 2 }), /limit/i);
});

test('encrypted PDF is rejected without ignoreEncryption', async () => {
  const source = await PDFDocument.create(); source.addPage();
  const encryption = source.context.register(PDFDict.withContext(source.context));
  source.context.lookup(encryption, PDFDict).set(PDFName.of('Filter'), PDFName.of('Standard'));
  source.context.lookup(encryption, PDFDict).set(PDFName.of('V'), PDFNumber.of(1));
  source.context.trailerInfo.Encrypt = encryption;
  await assert.rejects(parsePdf(await source.save(), 'locked.pdf', DEFAULT_LIMITS), /encrypted/i);
});
