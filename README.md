# Book Splicer

A privacy-first browser workspace for extracting and rearranging PDF pages, EPUB chapters, and comic images. One source, one new edit. **Files stay on your device.**

No uploads, backend document processing, accounts, analytics, remote fonts, conversion services, or saved projects. The Next.js server serves the app and local assets only. Document bytes stay in browser memory, not on the server or in browser storage. Closing/replacing a book terminates its document worker and releases previews and PDF.js resources.

## Local Setup

Use Node.js **24 LTS** and pnpm **11.5.0**, pinned through Corepack.

```sh
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Dependency installation requires network access; document processing does not. The browser still requests app assets from its hosting origin. No offline-install/service-worker feature is included.

```sh
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @book-splicer/web start
```

`build` and `dev` copy dependency worker/WASM/font/CMap assets into `apps/web/public/vendor/` and bundle the document worker into `public/workers/`. Generated directories are ignored by Git and included in Turborepo build outputs. Keep them with any deployment. No CDN configuration is needed. Next.js/Turborepo CLI telemetry is disabled by the scripts.

Asset bundling happens at startup. Restart `pnpm dev` after editing worker/adapters; UI edits use normal Next.js hot reload.

## Workflow

1. Drop or browse for one `.pdf`, `.epub`, `.cbz`, or `.cbr`.
2. Contents are detected by signatures and validated. Mismatched extensions get an actionable rename error, not silent reinterpretation.
3. Select cards with mouse, touch, Enter, or Space. Shift-click extends a range. Add ranges such as `1-5, 8`; select all, none, or invert.
4. New selections append without disturbing existing output order. Drag handles, keyboard-drag with Space/arrows/Space, use up/down controls, or enter an exact position. Escape cancels a drag. Position controls reach beyond the visible virtualized window.
5. Edit metadata and filename. Download selected units in output order. Removing a unit from the tray never changes the source.

Cancel terminates processing and closes the session; reopen the original to continue. Downloads are separate files. Keep your original.

## Supported Formats

| Input | Units | Output | Metadata |
| --- | --- | --- | --- |
| Unencrypted PDF | Pages | PDF | Title, author, subject, keywords, creator, producer |
| DRM-free, reflowable EPUB 2/3 | XHTML spine documents | EPUB, original version | Title, author, language, description |
| CBZ | JPEG, PNG, GIF, WebP, BMP images | CBZ | ComicInfo title and writer |
| Supported single-volume CBR/RAR | Same comic images | **CBZ only** | ComicInfo title and writer |

### PDF

PDF.js renders on-demand thumbnails and enlarged page previews with locally hosted workers. `pdf-lib` copies selected pages in chosen order inside the document worker. Password-protected/encrypted PDFs are rejected; no password entry or protection bypass is provided.

Rebuilt PDFs may not retain bookmarks/outlines, forms, signatures, attachments, tagging, or other document-level features. Some annotations can render differently or lose functionality. Complex/damaged PDFs can fail to parse or preview. Previews do not create text/annotation layers or enable document scripting. XFA rendering is disabled; oversized embedded images can be omitted by PDF.js.

### EPUB

Reading order comes from the package **spine**, never filenames. EPUB 2 NCX and EPUB 3 navigation labels take precedence over chapter headings. Source cards show safe excerpts. Enlarged previews use sandboxed iframes without scripts, same-origin access, forms, or external network access.

Exports preserve package version and identifiers, rebuild spine/table of contents, update metadata and EPUB 3 modification timestamps, and prune removed chapter manifest entries and stale navigation/package references. `mimetype` is first and uncompressed; `META-INF/container.xml` stays valid. Links to removed chapters become non-clickable text with an export warning. NCX page lists are removed rather than retained with stale references. Selecting only non-linear chapters promotes the first selected chapter to linear reading order with a warning.

Publisher CSS, images, fonts, cover assets, and retained local resources are preserved. Non-spine resources and unused assets are retained conservatively, so output size need not fall proportionally to chapter count. **This is not a secure-redaction tool.** Identifiers are intentionally preserved; assign a new publication identifier outside this app when distributing a substantially revised edition.

Preview typography is simplified. Publisher CSS/fonts are retained for export but not used in previews. SVG is omitted from previews; MathML appears as text. Large/repeated preview images fall back to alt text when the preview budget is exhausted.

Scripts, interactive controls, media overlays/audio/video, required remote resources, fixed layouts, multi-package books, unsupported complex CSS resource syntax, and DRM/encryption are rejected. Obfuscated fonts are explicitly unsupported, even when their obfuscation is not DRM. Safe HTML5/XHTML/NCX doctypes are stripped without fetching DTDs; arbitrary DTDs/entities are rejected.

Missing EPUB 3 TOC/modification timestamps are repaired with warnings. Validation covers the supported profile, not every EPUB conformance rule. Representative EPUB 2/3 sources, reordered exports, and subset exports passed **EPUBCheck 5.4.0** with zero warnings/errors. Publisher extensions still need review in the target reader.

### Comics And RAR

Image signatures/dimensions are checked. Directories/unrelated entries are ignored. Filenames use deterministic natural ordering with a lexical tie-break. Output entries become `0001.png`, `0002.jpg`, etc. Image bytes are preserved and stored without DEFLATE recompression. ComicInfo page indexes are filtered/remapped and page count updated; a removed front-cover designation is reassigned to the first output image. Other ComicInfo fields are retained.

CBR is visibly labeled as a **CBR to CBZ** conversion. No CBR export is offered. `node-unrar-js` 2.0.2 uses its local Emscripten WASM binary inside a fresh document worker. A pinned decoder write hook checks actual output **before** the library buffers it; regression tests exercise this hook. Successful iterators are fully traversed; errors/cancellation dispose the worker to release WASM memory.

RAR4 stored/compressed decoding is verified, including Unicode paths/directories and encrypted-header rejection. The decoder recognizes RAR5, but RAR5 variants are not fixture-verified in this release. Multipart archives, encrypted headers/files, unsupported variants/reference records, and damaged archives are rejected. Header checks do not guarantee every browser decoder can display an image; preview failures are reported. Animated images preview as still frames; export retains original animation bytes.

## Limits And Safety

Limits live in `apps/web/src/lib/types.ts` (`DEFAULT_LIMITS`), configurable centrally or through `DocumentSession.open`.

| Limit | Default |
| --- | --- |
| Input bytes | 100 MiB |
| Archive entries | 5,000 |
| Single decompressed entry | 32 MiB |
| Total decompressed bytes | 256 MiB |
| Per-entry and total compression ratio | 200:1 |
| PDF pages / EPUB chapters / comic images | 10,000 |
| Raster dimensions | 40 million pixels; maximum 16,000 per dimension |
| EPUB preview image data | 8 MiB aggregate |
| Preview canvas | 4 million pixels; maximum height 4,096 |
| PDF render concurrency / URL cache | 2 jobs / 36 previews |
| Document-worker job time | 2 minutes |

ZIP validation checks central/local header consistency, CRCs, normalized paths, duplicates, and **actual streamed output**. Small compressed chunks bound individual inflate steps. RAR checks declared sizes early and actual writes before storage. Absolute/traversal/control-character paths, escaped references, encrypted archives, multipart ZIPs, ZIP64, unsupported compression methods, malformed XML, and unsafe EPUB references are rejected. Threshold breaches abort jobs; cancellation terminates the worker immediately.

Limits bound retained input/output, not every temporary allocation inside browser engines or WASM. Archives stay in memory for export; low-memory devices can fail below configured limits. Raster checks inspect headers, not full image validity or aggregate animation-frame memory. Treat all documents as untrusted and keep dependencies current. The app sets defensive HTTP headers; iframe previews additionally impose their own stricter CSP.

## Verification

`pnpm test` uses Node's test runner through `tsx`: selection order/ranges, PDF page order/all metadata, EPUB package/navigation/resources, CBZ image bytes/order and ComicInfo, malformed archives, forged sizes, limits, raster budgets, and real RAR WASM extraction.

```sh
pnpm --filter @book-splicer/web exec playwright install chromium
pnpm --filter @book-splicer/web test:browser --workers=2
```

Browser checks start a local dev server on port 3100 and cover Chromium desktop/touch-mobile, all four formats/downloads, selection, keyboard/pointer reordering, cancellation/replacement, sandboxed previews, network rejection, decoded thumbnails, and responsive layout. Firefox/WebKit and broad reader testing are not yet included. Browser downloads are test setup only, never runtime dependencies.

Fixtures contain no copyrighted books: `tests/fixtures/original.ts` generates original one-pixel images and stored RAR4 archives; `valid-epub.ts` contains original CC0 chapters. `upstream-rar.ts` embeds generated-text RAR4 fixtures from `node-unrar-js`, pinned by Git blob IDs with the MIT license reproduced. PDF.js/UnRAR notices accompany generated vendor assets.

## Structure

```text
apps/web/src/app/           Static Next.js page shell and styles
apps/web/src/components/    Shared selection, tray, metadata and previews
apps/web/src/lib/client.ts  Browser session and PDF thumbnail lifecycle
apps/web/src/lib/worker.ts  Local parsing/export and comic thumbnails
apps/web/src/lib/formats/   PDF, EPUB, comic and RAR adapters
apps/web/src/lib/archive.ts Bounded ZIP extraction and safe paths
apps/web/tests/             Automated checks and browser integration
```

No plugin framework, database, server actions, OCR, text editing, multi-source merging, cloud storage, project persistence, or cross-format conversion. The sole conversion is the explicitly supported CBR-to-CBZ archive repack.
