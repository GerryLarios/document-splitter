import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export function xml(text: string): Document {
  // No DTDs, entities, or resolver access for untrusted package documents.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML document types and entities are not supported.');
  let invalid = false;
  const parser = new DOMParser({ errorHandler: { warning: () => { invalid = true; }, error: () => { invalid = true; }, fatalError: () => { invalid = true; } } });
  const doc = parser.parseFromString(text, 'application/xml');
  if (invalid || !doc.documentElement) throw new Error('Malformed XML document.');
  return doc as unknown as Document;
}
export function serialize(doc: Document | Element): string {
  return new XMLSerializer().serializeToString(doc as never);
}
export function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(el => el.localName === localName);
}
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
