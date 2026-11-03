import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DocumentSession } from '../src/lib/client';

test('concurrent PDF preview mounts share a URL without revoking a displayed thumbnail', async () => {
  const session = new DocumentSession();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({}), toBlob: (callback: (blob: Blob) => void) => queueMicrotask(() => callback(new Blob(['thumbnail']))) }),
  } });
  session.pdfDocument = async () => ({
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve() }), cleanup: () => {},
    }),
  }) as unknown as PDFDocumentProxy;
  try {
    const urls = await Promise.all([session.pdfThumbnail('page-1', true), session.pdfThumbnail('page-1', true)]);
    assert.equal(urls[0], urls[1]);
    assert.equal(await (await fetch(urls[0])).text(), 'thumbnail');
  } finally {
    session.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
