import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import { DEFAULT_LIMITS, type BookInfo, type ExportResult, type Limits, type Metadata, type PreviewResult, type Progress } from './types';

type Pending = { resolve(value: never): void; reject(reason: Error): void; progress?: Progress; timer: ReturnType<typeof setTimeout> };

export class DocumentSession {
  private worker: Worker | undefined;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private disposed = false;
  private pdfBytes?: Uint8Array;
  private pdf?: Promise<PDFDocumentProxy>;
  private pdfTask?: PDFDocumentLoadingTask;
  private urls = new Map<string, string>();
  private rendering = 0;
  private renderQueue: (() => void)[] = [];

  private request<T>(message: object, progress?: Progress, transfer?: Transferable[]): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Session closed. Open your book again.'));
    if (!this.worker) {
      this.worker = new Worker('/workers/document-worker.js', { type: 'module', name: 'book-splicer' });
      this.worker.onmessage = ({ data }: MessageEvent<{ id: number; value?: T; error?: string; progress?: { percent: number; message: string } }>) => {
        const task = this.pending.get(data.id);
        if (!task) return;
        if (data.progress) { task.progress?.(data.progress.percent, data.progress.message); return; }
        this.pending.delete(data.id);
        clearTimeout(task.timer);
        if (data.error) task.reject(new Error(data.error));
        else task.resolve(data.value as never);
      };
      this.worker.onerror = () => {
        for (const task of this.pending.values()) task.reject(new Error('Local document worker failed. Reload the app and rebuild local assets if needed.'));
        this.dispose();
      };
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        reject(new Error('Processing exceeded two minutes. Try a smaller or simpler book.'));
        this.dispose();
      }, 120_000);
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, progress, timer });
      this.worker!.postMessage({ ...message, id }, transfer ?? []);
    });
  }

  async open(file: File, limits?: Limits, progress?: Progress): Promise<BookInfo> {
    if (!file.size || file.size > (limits ?? DEFAULT_LIMITS).fileBytes) throw new Error('File exceeds the configured size limit or is empty.');
    const bytes = await file.arrayBuffer();
    if (this.disposed) throw new Error('Opening canceled.');
    if (file.name.toLowerCase().endsWith('.pdf')) this.pdfBytes = new Uint8Array(bytes.slice(0));
    return this.request<BookInfo>({ action: 'open', name: file.name, bytes, limits }, progress, [bytes]);
  }

  export(order: string[], metadata: Metadata, progress?: Progress): Promise<ExportResult> {
    return this.request({ action: 'export', order, metadata }, progress);
  }

  preview(id: string, large = false): Promise<PreviewResult> { return this.request({ action: 'preview', unitId: id, large }); }

  async pdfDocument(): Promise<PDFDocumentProxy> {
    if (this.disposed || !this.pdfBytes) throw new Error('PDF is no longer open.');
    if (!this.pdf) {
      this.pdf = import('pdfjs-dist').then(async pdfjs => {
        if (this.disposed) throw new Error('Session closed.');
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
        this.pdfTask = pdfjs.getDocument({ data: this.pdfBytes!.slice(), cMapUrl: '/vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/standard_fonts/', wasmUrl: '/vendor/pdfjs-wasm/', maxImageSize: DEFAULT_LIMITS.imagePixels, enableXfa: false });
        return this.pdfTask.promise;
      });
    }
    return this.pdf;
  }

  async pdfThumbnail(id: string, large: boolean): Promise<string> {
    const key = `${id}:${large ? 'large' : 'small'}`;
    const cached = this.urls.get(key);
    if (cached) return cached;
    // Limit canvas work to two visible pages at a time, including enlarged previews.
    if (this.rendering >= 2) await new Promise<void>(resolve => this.renderQueue.push(resolve));
    if (this.disposed) throw new Error('Session closed.');
    this.rendering++;
    try {
      const pdf = await this.pdfDocument();
      const page = await pdf.getPage(Number(id.replace(/^page-/, '')));
      const native = page.getViewport({ scale: 1 });
      if (!Number.isFinite(native.width * native.height) || native.width <= 0 || native.height <= 0) throw new Error('Invalid PDF page dimensions.');
      const scale = Math.min((large ? 820 : 270) / native.width, Math.sqrt(4_000_000 / (native.width * native.height)), 4096 / native.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not render PDF page.')), 'image/webp', 0.78));
        if (this.disposed) throw new Error('Session closed.');
        // Concurrent mounts must share the completed URL, never revoke a displayed one.
        const completed = this.urls.get(key);
        if (completed) return completed;
        const url = URL.createObjectURL(blob);
        if (this.urls.size >= 36) {
          const first = this.urls.keys().next().value;
          if (first) { URL.revokeObjectURL(this.urls.get(first)!); this.urls.delete(first); }
        }
        this.urls.set(key, url);
        return url;
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    } finally {
      this.rendering--;
      this.renderQueue.shift()?.();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate(); this.worker = undefined;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('Operation canceled.')); }
    this.pending.clear();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    void this.pdfTask?.destroy().catch(() => {});
    for (const resume of this.renderQueue.splice(0)) resume();
    this.pdfBytes = undefined;
  }
}
