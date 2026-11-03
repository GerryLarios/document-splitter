import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { png, rarStored } from '../fixtures/original';

const xhtml = 'http://www.w3.org/1999/xhtml';
const browserErrors = new WeakMap<Page, string[]>();

function epub(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OPS/book.opf': strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:browser-fixture</dc:identifier><dc:title>Fixture</dc:title><dc:creator>Writer</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>'),
    'OPS/nav.xhtml': strToU8(`<html xmlns="${xhtml}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li><li><a href="three.xhtml">Three</a></li></ol></nav></body></html>`),
    'OPS/one.xhtml': strToU8(`<html xmlns="${xhtml}"><head><title>One</title></head><body><h1>First chapter</h1><a href="https://example.com/unwanted">External link</a></body></html>`),
    'OPS/two.xhtml': strToU8(`<html xmlns="${xhtml}"><head><title>Two</title></head><body><h1>Second chapter</h1></body></html>`),
    'OPS/three.xhtml': strToU8(`<html xmlns="${xhtml}"><head><title>Three</title></head><body><h1>Third chapter</h1></body></html>`),
  };
  return zipSync(files, { level: 0 });
}

async function open(page: Page, name: string, bytes: Uint8Array) {
  await page.goto('/');
  await page.getByLabel('Choose a book').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await expect(page.getByRole('region', { name: 'Book editing workspace' })).toBeVisible();
  await expect(page.locator('.book-description h2')).toHaveText(name);
}

async function showTray(page: Page) {
  const tab = page.getByRole('tab', { name: /Your edit/ });
  if (await tab.isVisible()) await tab.click();
  await expect(page.getByRole('region', { name: 'Your edit' })).toBeVisible();
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportBook(page: Page, count: number) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: new RegExp(`Export ${count} (page|chapter)s?`) }).click();
  return download;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  browserErrors.set(page, errors);
});

test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(page) ?? [];
  if (errors.length) await testInfo.attach('browser-errors', { body: errors.join('\n'), contentType: 'text/plain' });
  // Chromium reports sandbox enforcement for srcdoc frames in the Next dev server.
  const unexpected = errors.filter(message => message !== "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.");
  expect(unexpected, 'unexpected browser console and page errors').toEqual([]);
});

test('legal pages open from the footer without leaving the workspace', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await open(page, 'source.pdf', await pdf.save());
  for (const [name, heading] of [['Privacy policy', 'Privacy policy'], ['Terms of service', 'Terms of service']]) {
    const popup = page.waitForEvent('popup');
    await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
    const policy = await popup;
    await expect(policy.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(policy.getByRole('link', { name: 'gerardo.larios69@gmail.com' })).toHaveAttribute('href', 'mailto:gerardo.larios69@gmail.com');
    await policy.close();
    await expect(page.getByRole('region', { name: 'Book editing workspace' })).toBeVisible();
  }
});

test('footer links to the creator profile', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: /Made by Gerardo Larios on LinkedIn/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/gerardo-larios/');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('PDF selects and reorders three differently sized pages, previews lazily, exports metadata', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 200]); pdf.addPage([300, 400]); pdf.addPage([500, 600]);
  pdf.setTitle('Source'); pdf.setAuthor('First author'); pdf.setSubject('Old subject');
  pdf.setKeywords(['old']); pdf.setCreator('Old creator'); pdf.setProducer('Old producer');
  await open(page, 'source.pdf', await pdf.save());
  await expect(page.getByRole('button', { name: /Export your edit/, includeHidden: true })).toBeDisabled();
  const thumbnail = page.locator('#source-panel .source-card .unit-image').first();
  await expect(thumbnail).toHaveJSProperty('complete', true);
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^Preview page 1:/ }).click();
  const large = page.locator('.large-preview .unit-image');
  await expect.poll(() => large.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: /^Select page 1:/ }).click();
  await page.getByRole('button', { name: /^Select page 3:/ }).click();
  await showTray(page);
  await expect(page.locator('.tray-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Move Page 3 up' }).click();
  await expect(page.locator('.tray-row .tray-title')).toHaveText(['Page 3Source 3', 'Page 1Source 1']);
  await page.getByLabel('Title', { exact: true }).fill('Trimmed PDF');
  await page.getByLabel('Author', { exact: true }).fill('Browser author');
  await page.getByLabel('Subject', { exact: true }).fill('Browser subject');
  await page.getByLabel('Keywords', { exact: true }).fill('alpha, beta');
  await page.getByLabel('Creator', { exact: true }).fill('Browser creator');
  await page.getByLabel('Producer', { exact: true }).fill('Browser producer');
  await page.getByLabel('Export filename').fill('ordered-pages');
  const result = await exportBook(page, 2);
  expect(result.suggestedFilename()).toBe('ordered-pages.pdf');
  const output = await PDFDocument.load(await downloadBytes(result), { updateMetadata: false });
  expect(output.getPages().map(p => p.getSize())).toEqual([{ width: 500, height: 600 }, { width: 100, height: 200 }]);
  expect(output.getTitle()).toBe('Trimmed PDF');
  expect(output.getAuthor()).toBe('Browser author');
  expect(output.getSubject()).toBe('Browser subject');
  expect(output.getKeywords()).toContain('alpha');
  expect(output.getCreator()).toBe('Browser creator');
  expect(output.getProducer()).toBe('Browser producer');
});

test('CBZ preserves image bytes and remaps ComicInfo for reordered selection', async ({ page }) => {
  const first = png(10), second = png(20), third = png(30);
  const bytes = zipSync({
    'page10.png': third, 'page2.png': second, 'page1.png': first,
    'ComicInfo.xml': strToU8('<ComicInfo><Title>Old</Title><Writer>Writer</Writer><Pages><Page Image="0" Type="FrontCover"/><Page Image="1" Bookmark="middle"/><Page Image="2" Type="BackCover"/></Pages></ComicInfo>'),
  }, { level: 0 });
  await open(page, 'comic.cbz', bytes);
  await page.getByRole('button', { name: /^Select page 1:/ }).click();
  await page.getByRole('button', { name: /^Select page 3:/ }).click();
  await showTray(page);
  await expect(page.locator('.tray-row')).toHaveCount(2);
  await page.getByLabel('Position of page10.png').fill('1');
  await page.getByLabel('Position of page10.png').press('Enter');
  await page.getByLabel('Title', { exact: true }).fill('New comic');
  await page.getByLabel('Writer / author').fill('New writer');
  const result = await exportBook(page, 2);
  expect(result.suggestedFilename()).toBe('comic-edit.cbz');
  const files = unzipSync(await downloadBytes(result));
  expect(Array.from(files['0001.png'])).toEqual(Array.from(third));
  expect(Array.from(files['0002.png'])).toEqual(Array.from(first));
  expect(files['0003.png']).toBeUndefined();
  const comicInfo = strFromU8(files['ComicInfo.xml']);
  expect(comicInfo).toContain('<Title>New comic</Title>');
  expect(comicInfo).toContain('<Writer>New writer</Writer>');
  expect(comicInfo).toContain('<PageCount>2</PageCount>');
  expect(comicInfo).toMatch(/Image="1" Type="FrontCover"/);
  expect(comicInfo).not.toContain('middle');
});

test('CBR opens through real RAR WASM and downloads CBZ', async ({ page }) => {
  const image = png(44);
  await open(page, 'stored.cbr', rarStored({ 'page1.png': image }));
  await page.getByRole('button', { name: /^Select page 1:/ }).click();
  await showTray(page);
  await expect(page.getByText('CBR in, CBZ out. Same pages, an open format.')).toBeVisible();
  const result = await exportBook(page, 1);
  expect(result.suggestedFilename()).toBe('stored-edit.cbz');
  expect(Array.from(unzipSync(await downloadBytes(result))['0001.png'])).toEqual(Array.from(image));
});

test('EPUB chapter preview is sandboxed, no network, reordered export remains valid', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://localhost:3100') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url()); });
  await open(page, 'chapters.epub', epub());
  await page.getByRole('button', { name: /^Preview chapter 1:/ }).click();
  const frame = page.locator('.large-preview iframe');
  await expect(frame).toHaveAttribute('sandbox', '');
  await expect(frame.contentFrame().getByText('First chapter')).toBeVisible();
  await expect(frame.contentFrame().getByText('External link')).toBeVisible();
  await expect(frame.contentFrame().locator('a[href]')).toHaveCount(0);
  await expect(frame.contentFrame().locator('script, form, iframe, [onclick]')).toHaveCount(0);
  await expect(frame.contentFrame().locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /default-src 'none'/);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: /^Select chapter 1:/ }).click();
  await page.getByRole('button', { name: /^Select chapter 3:/ }).click();
  await showTray(page);
  await expect(page.locator('.tray-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Move Three up' }).click();
  await page.getByLabel('Title', { exact: true }).fill('New chapters');
  const result = await exportBook(page, 2);
  expect(result.suggestedFilename()).toBe('chapters-edit.epub');
  const bytes = await downloadBytes(result);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(8, true)).toBe(0); // EPUB mimetype must be stored, not compressed.
  expect(bytes.subarray(30, 38).toString()).toBe('mimetype');
  const files = unzipSync(bytes);
  expect(strFromU8(files.mimetype)).toBe('application/epub+zip');
  expect(files['OPS/two.xhtml']).toBeUndefined();
  const opf = strFromU8(files['OPS/book.opf']);
  expect(opf.match(/<itemref\b[^>]*idref="[^"]+"/g)?.map(ref => ref.match(/idref="([^"]+)"/)?.[1])).toEqual(['three', 'one']);
  expect(opf).toContain('New chapters');
  expect(strFromU8(files['OPS/nav.xhtml'])).toMatch(/three\.xhtml[\s\S]*one\.xhtml/);
  expect(external).toEqual([]);
});

test('invalid archive reports error, then valid replacement opens', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose a book').setInputFiles({ name: 'broken.cbz', mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04broken archive', 'binary') });
  await expect(page.locator('.error-banner[role="alert"]')).toContainText(/unrecognized|invalid|archive|zip/i);
  await expect(page.getByRole('region', { name: 'Book editing workspace' })).toHaveCount(0);
  await page.getByLabel('Choose a book').setInputFiles({ name: 'replacement.cbz', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ '1.png': png() })) });
  await expect(page.getByRole('region', { name: 'Book editing workspace' })).toBeVisible();
  await expect(page.locator('.error-banner[role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Choose a book').setInputFiles({ name: 'second.cbz', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ '2.png': png(2) })) });
  await expect(page.locator('.book-description h2')).toHaveText('second.cbz');
  await expect(page.getByRole('button', { name: /Export your edit/, includeHidden: true })).toBeDisabled();
});

test('viewport has no horizontal overflow; mobile source and tray tabs remain usable', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('empty.png'), fullPage: true });
  await open(page, 'viewport.cbz', zipSync({ '1.png': png(1), '2.png': png(2) }));
  await page.getByRole('button', { name: /^Select page 1:/ }).click();
  if (testInfo.project.name === 'chromium-mobile') {
    await expect(page.getByRole('tab', { name: /Original book/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Your edit' })).toBeHidden();
    await showTray(page);
    await expect(page.getByRole('tab', { name: /Your edit/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('workspace-tray.png'), fullPage: true });
    await page.getByRole('tab', { name: /Original book/ }).click();
    await expect(page.getByRole('region', { name: 'Original book' })).toBeVisible();
    await page.getByRole('tab', { name: /Original book/ }).press('End');
    await expect(page.getByRole('tab', { name: /Your edit/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /Your edit/ }).press('Home');
    await expect(page.getByRole('tab', { name: /Original book/ })).toHaveAttribute('aria-selected', 'true');
  } else {
    await expect(page.getByRole('region', { name: 'Your edit' })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
});

test('Space and Shift-click select source pages; range and All preserve existing order', async ({ page }) => {
  await open(page, 'selection.cbz', zipSync({ '1.png': png(1), '2.png': png(2), '3.png': png(3) }));
  async function checkOrder(numbers: number[]) {
    await showTray(page);
    await expect(page.locator('.tray-row .tray-title')).toHaveText(numbers.map(n => `${n}.pngSource ${n}`));
    const source = page.getByRole('tab', { name: /Original book/ });
    if (await source.isVisible()) await source.click();
  }
  await page.getByRole('button', { name: /^Select page 3:/ }).press('Space');
  await expect(page.getByRole('button', { name: /^Deselect page 3:/ })).toHaveAttribute('aria-pressed', 'true');
  await checkOrder([3]);
  await page.getByRole('button', { name: /^Select page 1:/ }).click({ modifiers: ['Shift'] });
  await checkOrder([3, 1, 2]);
  await page.getByRole('button', { name: /^Deselect page 2:/ }).press('Space');
  await checkOrder([3, 1]);
  await page.getByLabel('Select a range').fill('1-3, 1');
  await page.getByRole('button', { name: 'Add range to your edit' }).click();
  await checkOrder([3, 1, 2]);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await checkOrder([3, 1, 2]);
  await page.getByRole('button', { name: 'None', exact: true }).click();
  await checkOrder([]);
  await expect(page.getByRole('button', { name: /Export your edit/, includeHidden: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Select page 2:/ }).press('Space');
  await page.getByRole('button', { name: 'Invert', exact: true }).click();
  await checkOrder([1, 3]);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await checkOrder([1, 3, 2]);
  await page.getByLabel('Select a range').fill('4');
  await page.getByRole('button', { name: 'Add range to your edit' }).click();
  await expect(page.locator('#range-error')).toContainText('between 1 and 3');
  await checkOrder([1, 3, 2]);
});

test('keyboard handle drag reorders three items; explicit move and remove update tray', async ({ page }) => {
  await open(page, 'keyboard.cbz', zipSync({ '1.png': png(1), '2.png': png(2), '3.png': png(3) }));
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await showTray(page);
  await expect(page.locator('.tray-row')).toHaveCount(3);
  const handle = page.getByRole('button', { name: /^Reorder 1\.png\./ });
  await handle.press('Space');
  await expect(page.locator('.drag-overlay')).toBeVisible();
  await handle.press('ArrowDown');
  await expect(page.getByText(/moved over droppable area image-2/)).toBeAttached();
  await handle.press('Space');
  await expect(page.locator('.tray-row .tray-title')).toHaveText(['2.pngSource 2', '1.pngSource 1', '3.pngSource 3']);
  await page.getByRole('button', { name: 'Move 3.png up', exact: true }).click();
  await expect(page.locator('.tray-row .tray-title')).toHaveText(['2.pngSource 2', '3.pngSource 3', '1.pngSource 1']);
  await page.getByRole('button', { name: 'Remove 2.png from edit' }).click();
  await expect(page.locator('.tray-row .tray-title')).toHaveText(['3.pngSource 3', '1.pngSource 1']);
  await expect(page.getByRole('button', { name: 'Export 2 pages' })).toBeEnabled();
});

test('pointer handle drag moves first page to last without changing selection', async ({ page }) => {
  await open(page, 'pointer.cbz', zipSync({ '1.png': png(1), '2.png': png(2), '3.png': png(3) }));
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await showTray(page);
  await expect(page.locator('.tray-row')).toHaveCount(3);
  await page.locator('.tray-list').scrollIntoViewIfNeeded();
  const start = await page.getByRole('button', { name: /^Reorder 1\.png\./ }).boundingBox();
  const end = await page.getByRole('button', { name: /^Reorder 3\.png\./ }).boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  const x = start!.x + start!.width / 2, y = start!.y + start!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await expect(page.locator('.drag-overlay')).toBeVisible();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator('.tray-row .tray-title')).toHaveText(['2.pngSource 2', '3.pngSource 3', '1.pngSource 1']);
  await expect(page.getByRole('button', { name: 'Export 3 pages' })).toBeEnabled();
});

test('cancel during gated worker import then reopen never loads canceled book', async ({ page }) => {
  const gate = Promise.withResolvers<void>();
  const intercepted = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  await page.route('**/workers/document-worker.js', async route => {
    intercepted.resolve();
    await gate.promise;
    await route.continue();
    released.resolve();
  }, { times: 1 });
  try {
    await page.goto('/');
    await page.getByLabel('Choose a book').setInputFiles({ name: 'canceled.cbz', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'old.png': png(1) })) });
    await intercepted.promise;
    await expect(page.getByRole('progressbar', { name: 'Book processing progress' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Book editing workspace' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Good books. Your cut.' })).toBeVisible();
    await page.getByLabel('Choose a book').setInputFiles({ name: 'fresh.cbz', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'fresh.png': png(2) })) });
    await expect(page.locator('.book-description h2')).toHaveText('fresh.cbz');
    gate.resolve();
    await released.promise;
    await expect(page.locator('.book-description h2')).toHaveText('fresh.cbz');
    await expect(page.getByRole('button', { name: /^Select page 1: fresh\.png$/ })).toBeVisible();
    await expect(page.locator('.error-banner')).toHaveCount(0);
  } finally {
    gate.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('misnamed PDF contents reports format and rename action', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 200]);
  await page.goto('/');
  await page.getByLabel('Choose a book').setInputFiles({ name: 'misnamed.cbz', mimeType: 'application/zip', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.error-banner[role="alert"]')).toContainText('File contents are PDF, but filename ends in .cbz. Rename it and try again.');
  await expect(page.getByRole('region', { name: 'Book editing workspace' })).toHaveCount(0);
});

for (const [name, markup, error] of [
  ['remote image', '<img src="https://hostile.example/image.png" alt="Remote"/>', /remote|unsupported/i],
  ['script', '<script src="https://hostile.example/run.js">alert(1)</script>', /scripted|unsupported/i],
] as const) test(`hostile EPUB ${name} rejects without network access`, async ({ page, context }) => {
  const external: string[] = [];
  context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== 'http://localhost:3100') external.push(request.url()); });
  await context.route('https://hostile.example/**', route => route.abort());
  const files = unzipSync(epub());
  files['OPS/one.xhtml'] = strToU8(strFromU8(files['OPS/one.xhtml']).replace('</body>', `${markup}</body>`));
  await page.goto('/');
  await page.getByLabel('Choose a book').setInputFiles({ name: 'hostile.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(zipSync(files, { level: 0 })) });
  await expect(page.locator('.error-banner[role="alert"]')).toContainText(error);
  await expect(page.getByRole('region', { name: 'Book editing workspace' })).toHaveCount(0);
  expect(external).toEqual([]);
});

test('comic preview decodes a fresh downscaled WebP thumbnail, not original image data', async ({ page }) => {
  await page.goto('/');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 720;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#df4b2e';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const original = Buffer.from(base64, 'base64');
  // Observe real preview blobs without fetching blob: URLs, which CSP forbids.
  await page.addInitScript(() => {
    const blobs = new Map<string, Blob>();
    Object.assign(window, { previewBlobs: blobs });
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = object => {
      const url = createObjectURL(object);
      if (object instanceof Blob) blobs.set(url, object);
      return url;
    };
  });
  await open(page, 'thumbnail.cbz', zipSync({ 'large.png': original }));
  const image = page.locator('#source-panel .unit-image');
  await expect(image).toHaveJSProperty('complete', true);
  await expect(image).toHaveJSProperty('naturalWidth', 270);
  await expect(image).toHaveJSProperty('naturalHeight', 180);
  const thumbnail = await image.evaluate(async (element: HTMLImageElement) => {
    const blob = (window as unknown as { previewBlobs: Map<string, Blob> }).previewBlobs.get(element.src)!;
    return { mime: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  });
  expect(thumbnail.mime).toBe('image/webp');
  expect(Buffer.from(thumbnail.bytes).subarray(0, 4).toString()).toBe('RIFF');
  expect(Buffer.from(thumbnail.bytes).subarray(8, 12).toString()).toBe('WEBP');
  expect(thumbnail.bytes).not.toEqual(Array.from(original));
  await page.getByRole('button', { name: /^Preview page 1:/ }).click();
  await expect(page.locator('.large-preview .unit-image')).toHaveJSProperty('naturalWidth', 1080);
  await page.getByRole('button', { name: 'Close dialog' }).click();
});
