import { cp, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const rarWasm = require.resolve('node-unrar-js/esm/js/unrar.wasm');
const rarRoot = dirname(require.resolve('node-unrar-js/package.json'));
await mkdir('public/vendor/cmaps', { recursive: true });
await mkdir('public/vendor/standard_fonts', { recursive: true });
await mkdir('public/vendor/pdfjs-wasm', { recursive: true });
await mkdir('public/workers', { recursive: true });
await Promise.all([
  copyFile(join(pdfRoot, 'build/pdf.worker.min.mjs'), 'public/vendor/pdf.worker.min.mjs'),
  copyFile(rarWasm, 'public/vendor/unrar.wasm'),
  copyFile(join(rarRoot, 'LICENSE.md'), 'public/vendor/unrar-LICENSE.md'),
  copyFile(join(pdfRoot, 'LICENSE'), 'public/vendor/pdfjs-LICENSE.txt'),
  cp(join(pdfRoot, 'cmaps'), 'public/vendor/cmaps', { recursive: true }),
  cp(join(pdfRoot, 'standard_fonts'), 'public/vendor/standard_fonts', { recursive: true }),
  cp(join(pdfRoot, 'wasm'), 'public/vendor/pdfjs-wasm', { recursive: true }),
  build({ entryPoints: ['src/lib/worker.ts'], outfile: 'public/workers/document-worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true }),
]);
