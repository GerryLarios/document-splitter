'use client';
import { useEffect, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import type { DocumentSession } from '../lib/client';

export function PdfPreview({ session, id, large = false }: { session: DocumentSession; id: string; large?: boolean }) {
  const [result, setResult] = useState<{ url?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    session.pdfThumbnail(id, large).then(url => { if (active) setResult({ url }); }).catch(error => { if (active) setResult({ error: error instanceof Error ? error.message : 'Preview unavailable.' }); });
    return () => { active = false; };
  }, [session, id, large]);
  // Local canvas output must never enter Next's server-side image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  if (result?.url) return <img className="unit-image" src={result.url} alt="" />;
  if (result?.error) return <div className="preview-placeholder" role="status"><FileText size={22} />{large ? result.error : 'Preview unavailable'}</div>;
  return <div className="preview-placeholder" role="status" aria-label="Loading PDF page"><LoaderCircle className="spin" size={22} /></div>;
}
