import { strToU8 } from 'fflate';
import type { Entries } from '../../src/lib/types';
import { png } from './original';

// Original CC0 fixture content; no third-party book assets.
export function fixture(version: '2.0' | '3.0'): Entries {
  const epub3 = version === '3.0';
  const files: Record<string, string | Uint8Array> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:8a7ac559-f68a-4deb-b55d-eb75121e19ae</dc:identifier><dc:title>Original Book</dc:title><dc:creator>Original Author</dc:creator><dc:language>en</dc:language>${epub3 ? '<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>' : ''}</metadata><manifest><item id="first" href="text/first.xhtml" media-type="application/xhtml+xml"/><item id="last" href="text/last.xhtml" media-type="application/xhtml+xml"/><item id="css" href="styles/book.css" media-type="text/css"/><item id="pic" href="images/p.png" media-type="image/png"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${epub3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}</manifest><spine toc="ncx"><itemref idref="first"/><itemref idref="last"/></spine></package>`,
    'OPS/text/first.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>First Chapter</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/></head><body><h1>First Chapter</h1><p>First chapter text.</p><p><img src="../images/p.png" alt="A red pixel"/></p></body></html>',
    'OPS/text/last.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Last Chapter</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/></head><body><h1>Last Chapter</h1><p>Last chapter text.</p></body></html>',
    'OPS/styles/book.css': 'body { color: #222; } img { max-width: 100%; }',
    'OPS/images/p.png': png(),
    'OPS/toc.ncx': '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:8a7ac559-f68a-4deb-b55d-eb75121e19ae"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>Original Book</text></docTitle><docAuthor><text>Original Author</text></docAuthor><navMap><navPoint id="point-first" playOrder="1"><navLabel><text>First Chapter</text></navLabel><content src="text/first.xhtml"/></navPoint><navPoint id="point-last" playOrder="2"><navLabel><text>Last Chapter</text></navLabel><content src="text/last.xhtml"/></navPoint></navMap></ncx>',
  };
  if (epub3) files['OPS/nav.xhtml'] = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="text/first.xhtml">First Chapter</a></li><li><a href="text/last.xhtml">Last Chapter</a></li></ol></nav></body></html>';
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
}
