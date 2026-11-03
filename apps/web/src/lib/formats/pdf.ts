import { PDFDocument } from 'pdf-lib';
import type { ExportResult, Limits, Metadata, ParsedBook, Progress } from '../types';

export async function parsePdf(bytes: Uint8Array, name: string, limits: Limits, progress?: Progress): Promise<ParsedBook> {
  if (bytes.length > limits.fileBytes) throw new Error('PDF exceeds file size limit.');
  progress?.(10, 'Reading PDF');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false }).catch(error => {
    if (error instanceof Error && /encrypt/i.test(error.message)) throw new Error('Password-protected or encrypted PDFs are unsupported. Open an unprotected copy.');
    throw new Error('Could not read this PDF. It may be damaged or use an unsupported structure.');
  });
  const count = pdf.getPageCount();
  if (!count || count > limits.units) throw new Error('PDF page count exceeds limit or is empty.');
  const metadata: Metadata = {};
  for (const [key, value] of Object.entries({ title: pdf.getTitle(), author: pdf.getAuthor(), subject: pdf.getSubject(), keywords: pdf.getKeywords(), creator: pdf.getCreator(), producer: pdf.getProducer() })) {
    if (value !== undefined) metadata[key] = value;
  }
  progress?.(100, `Read ${count} pages`);
  return { bytes, info: { format: 'pdf', name, size: bytes.length, metadata, warnings: ['Rebuilt PDFs may not preserve bookmarks, forms, signatures, or other document-level features. Keep your original.'], units: Array.from({ length: count }, (_, index) => ({ id: `page-${index + 1}`, index, title: `Page ${index + 1}` })) } };
}

export async function exportPdf(book: ParsedBook, order: string[], metadata: Metadata, progress?: Progress): Promise<ExportResult> {
  if (!book.bytes || book.info.format !== 'pdf') throw new Error('Missing source PDF.');
  if (!order.length || new Set(order).size !== order.length) throw new Error('Select unique PDF pages to export.');
  const units = new Map(book.info.units.map(unit => [unit.id, unit]));
  const indices = order.map(id => {
    const unit = units.get(id);
    if (!unit) throw new Error('Unknown PDF page.');
    return unit.index;
  });
  progress?.(5, 'Copying PDF pages');
  const source = await PDFDocument.load(book.bytes, { updateMetadata: false });
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, indices);
  pages.forEach((page, index) => { target.addPage(page); progress?.(10 + (index + 1) / pages.length * 70, 'Copying PDF pages'); });
  target.setTitle(metadata.title ?? '');
  target.setAuthor(metadata.author ?? '');
  target.setSubject(metadata.subject ?? '');
  target.setKeywords(metadata.keywords ? metadata.keywords.split(/[,;]\s*/) : []);
  target.setCreator(metadata.creator ?? '');
  target.setProducer(metadata.producer ?? '');
  const bytes = await target.save();
  progress?.(100, 'PDF ready');
  return { bytes, mime: 'application/pdf', extension: 'pdf', warnings: ['Page content is preserved; document-level outlines, forms, and signatures are not preserved.'] };
}
