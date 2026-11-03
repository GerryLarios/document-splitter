'use client';

import { useEffect, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import type { DocumentSession } from '../lib/client';
import type { Format } from '../lib/types';
import { PdfPreview } from './pdf-preview';

export function UnitPreview({ session, id, format, large = false, title, excerpt }: { session: DocumentSession; id: string; format: Format; large?: boolean; title?: string; excerpt?: string }) {
  if (format === 'pdf') return <PdfPreview session={session} id={id} large={large} />;
  if (format === 'epub' && !large) return <div className="chapter-card"><FileText size={18} /><h3>{title}</h3><p>{excerpt || 'Open the preview to read this chapter.'}</p></div>;
  return <ContentPreview key={id} session={session} id={id} large={large} />;
}

function ContentPreview({ session, id, large }: { session: DocumentSession; id: string; large: boolean }) {
  const [content, setContent] = useState<{ url?: string; html?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    session.preview(id, large).then(result => {
      if (!active) return;
      if (result.bytes) url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime }));
      setContent({ url, html: result.html });
    }).catch(error => { if (active) setContent({ error: error instanceof Error ? error.message : 'Preview unavailable' }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [session, id, large]);
  if (!content) return <div className="preview-placeholder" role="status" aria-label="Loading preview"><LoaderCircle className="spin" size={22} /></div>;
  if (content.error) return <div className="preview-placeholder"><FileText size={25} /><span>Preview unavailable</span>{large ? <small>{content.error}</small> : null}</div>;
  // Native image sizing preserves comic page proportions; URLs are local and released on unmount.
  // eslint-disable-next-line @next/next/no-img-element
  if (content.url) return <img className="unit-image" src={content.url} alt="" />;
  if (content.html !== undefined) return <iframe className={`chapter-preview ${large ? 'chapter-large' : ''}`} sandbox="" srcDoc={content.html} title="Chapter preview" tabIndex={large ? 0 : -1} />;
  return <div className="preview-placeholder"><FileText size={28} /><span>No preview available</span></div>;
}
