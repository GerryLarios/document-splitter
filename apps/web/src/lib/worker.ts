/// <reference lib="webworker" />
import { readZip } from './archive';
import { parseComic, exportComic } from './formats/comics';
import { parseEpub, exportEpub, previewEpub } from './formats/epub';
import { parsePdf, exportPdf } from './formats/pdf';
import { readRar } from './formats/rar';
import { DEFAULT_LIMITS, type Limits, type Metadata, type ParsedBook, type Progress } from './types';

let book: ParsedBook | undefined;
type Command =
  | { id: number; action: 'open'; bytes: ArrayBuffer; name: string; limits?: Limits }
  | { id: number; action: 'export'; order: string[]; metadata: Metadata }
  | { id: number; action: 'preview'; unitId: string; large?: boolean };

// Serial jobs avoid concurrent image decodes and protect the retained source state.
let processing = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<Command>) => { processing = processing.then(() => handle(data)); };

async function handle(data: Command) {
  const progress: Progress = (percent, message) => self.postMessage({ id: data.id, progress: { percent, message } });
  try {
    if (data.action === 'open') {
      const bytes = new Uint8Array(data.bytes);
      const limits = data.limits ?? DEFAULT_LIMITS;
      if (!bytes.length || bytes.length > limits.fileBytes) throw new Error('Choose a non-empty file within the configured size limit.');
      const extension = data.name.split('.').at(-1)?.toLowerCase();
      const prefix = (length: number) => String.fromCharCode(...bytes.subarray(0, length));
      let format: 'pdf' | 'epub' | 'cbz' | 'cbr';
      if (prefix(5) === '%PDF-') format = 'pdf';
      else if (prefix(7) === 'Rar!\x1a\x07\x00' || prefix(8) === 'Rar!\x1a\x07\x01\x00') format = 'cbr';
      else if (prefix(4) === 'PK\x03\x04') format = 'cbz';
      else throw new Error('Unrecognized file contents. Choose a valid PDF, EPUB, CBZ, or CBR.');
      if (!['pdf', 'epub', 'cbz', 'cbr'].includes(extension ?? '')) throw new Error('Choose a PDF, EPUB, CBZ, or CBR file.');
      let next: ParsedBook;
      if (format === 'pdf') next = await parsePdf(bytes, data.name, limits, progress);
      else {
        const entries = format === 'cbr'
          ? await readRar(bytes, limits, await fetch('/vendor/unrar.wasm').then(response => {
              if (!response.ok) throw new Error('Local RAR decoder unavailable. Rebuild local assets.');
              return response.arrayBuffer();
            }), progress)
          : readZip(bytes, limits, progress);
        if (format === 'cbz' && (Object.hasOwn(entries, 'mimetype') || Object.hasOwn(entries, 'META-INF/container.xml'))) format = 'epub';
        next = format === 'epub' ? parseEpub(entries, data.name, bytes.length, limits, progress) : parseComic(entries, format, data.name, bytes.length, limits, progress);
      }
      if (extension !== format) throw new Error(`File contents are ${format.toUpperCase()}, but filename ends in .${extension}. Rename it and try again.`);
      book = next;
      self.postMessage({ id: data.id, value: book.info });
    } else {
      if (!book) throw new Error('Open a book first.');
      if (data.action === 'export') {
        const result = book.info.format === 'pdf'
          ? await exportPdf(book, data.order, data.metadata, progress)
          : book.info.format === 'epub'
            ? exportEpub(book, data.order, data.metadata, progress)
            : exportComic(book, data.order, data.metadata, progress);
        self.postMessage({ id: data.id, value: result }, [result.bytes.buffer]);
      } else {
        if (!book.info.units.some(unit => unit.id === data.unitId)) throw new Error('Unknown content unit.');
        if (book.info.format === 'epub') self.postMessage({ id: data.id, value: previewEpub(book, data.unitId) });
        else if (book.info.format === 'pdf') throw new Error('PDF preview uses the local PDF.js renderer.');
        else {
          const unit = book.info.units.find(unit => unit.id === data.unitId)!;
          const image = book.entries?.[unit.path!];
          if (!image) throw new Error('Missing comic image.');
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(image)], { type: unit.mime }));
          try {
            const scale = Math.min(1, (data.large ? 1400 : 270) / bitmap.width, 4096 / bitmap.height, Math.sqrt(4_000_000 / (bitmap.width * bitmap.height)));
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
            const copy = new Uint8Array(await blob.arrayBuffer());
            canvas.width = canvas.height = 0;
            self.postMessage({ id: data.id, value: { bytes: copy, mime: blob.type } }, [copy.buffer]);
          } finally { bitmap.close(); }
        }
      }
    }
  } catch (error) {
    if (data.action === 'open') book = undefined;
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Failed to process book.' });
  }
}
