'use client';

import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { BookOpen, Scissors, ShieldCheck, ArrowUpRight, Upload, FileText, X, Check, Plus, Eye, GripVertical, ArrowUp, ArrowDown, Download, CircleHelp, RotateCcw, LoaderCircle, CheckCircle2 } from 'lucide-react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { toast } from 'sonner';
import { DocumentSession } from '../lib/client';
import { DEFAULT_LIMITS, type BookInfo, type Metadata, type Unit } from '../lib/types';
import { addSelection, moveSelection, parseRange, toggleSelection } from '../lib/selection';
import { Button, Dialog } from './ui';
import { UnitPreview } from './unit-preview';

type Loaded = { session: DocumentSession; info: BookInfo; token: number };
type Work = { percent: number; message: string };
const formats = ['PDF', 'EPUB', 'CBZ', 'CBR'];
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function BookSplicer() {
  const input = useRef<HTMLInputElement>(null);
  const current = useRef<DocumentSession | null>(null);
  const generation = useRef(0);
  const [loaded, setLoaded] = useState<Loaded>();
  const [work, setWork] = useState<Work>();
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => () => { generation.current++; current.current?.dispose(); }, []);

  async function openFiles(files: FileList | File[]) {
    setDragging(false);
    if (files.length !== 1) { setError('Choose one book at a time. Your current book has not been changed.'); return; }
    const file = files[0];
    if (!/\.(pdf|epub|cbz|cbr)$/i.test(file.name)) { setError('This file type is not supported. Choose a PDF, EPUB, CBZ, or CBR file.'); return; }
    if (file.size > DEFAULT_LIMITS.fileBytes || file.size === 0) { setError(`Choose a non-empty file smaller than ${sizeLabel(DEFAULT_LIMITS.fileBytes)}.`); return; }
    const token = ++generation.current;
    current.current?.dispose();
    const session = new DocumentSession();
    current.current = session;
    setLoaded(undefined); setError(''); setWork({ percent: 0, message: 'Opening your book...' });
    try {
      const info = await session.open(file, undefined, (percent, message) => {
        if (generation.current === token) setWork({ percent, message });
      });
      if (generation.current !== token) return;
      setLoaded({ session, info, token }); setWork(undefined);
    } catch (error) {
      if (generation.current !== token) return;
      session.dispose(); current.current = null; setWork(undefined); setError(messageOf(error));
    }
  }
  function cancel() {
    generation.current++; current.current?.dispose(); current.current = null;
    setLoaded(undefined); setWork(undefined); setError('');
    toast('Operation canceled. Choose a book to start again.');
  }

  return <div className="app-shell" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length) void openFiles(event.dataTransfer.files); }}>
    <header className="site-header"><Link className="brand" href="/" aria-label="Book Splicer home"><span className="brand-mark"><BookOpen size={24} /><Scissors size={16} /></span>book<span className="brand-light">splicer</span><span className="brand-dot">.</span></Link><div className="header-right"><span className="privacy-badge"><ShieldCheck size={15} /> Your files stay yours</span><Button variant="ghost" onClick={() => setHelp(true)} aria-label="How it works"><CircleHelp size={17} /><span>How it works</span></Button></div></header>
    <main>
      <div className="intro"><div><p className="eyebrow"><span /> A LITTLE LESS BOOK. A LOT MORE YOU.</p><h1>Keep the good parts<span>.</span></h1><p className="intro-copy">A chapter, a few pages, a whole new order. Make a book your own.</p></div><div className="local-note"><ShieldCheck size={22} /><div><strong>On your device. By design.</strong><span>No uploads. No accounts. No compromises.</span></div></div></div>
      <p className="device-privacy"><ShieldCheck size={14} /> Files stay on your device</p>
      <ol className="steps" aria-label="Workflow"><li className="step-active"><span>01</span> Open a book</li><li className={loaded ? 'step-active' : ''}><span>02</span> Pick & arrange</li><li><span>03</span> Export your edit</li></ol>
      <input ref={input} className="sr-only" type="file" accept=".pdf,.epub,.cbz,.cbr" aria-label="Choose a book" onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files?.length) void openFiles(event.target.files); event.target.value = ''; }} />
      {error ? <div className="error-banner" role="alert"><FileText size={19} /><span>{error}</span><Button variant="ghost" className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={18} /></Button></div> : null}
      {work ? <section className="loading-card" aria-live="polite"><span className="loading-icon"><LoaderCircle className="spin" size={32} /></span><h2>{work.message}</h2><p>Working locally. Your book never leaves this browser.</p><progress max={100} value={Math.max(0, Math.min(100, work.percent))} aria-label="Book processing progress" /><Button onClick={cancel}><X size={16} /> Cancel</Button></section> : loaded ? <Workspace key={loaded.token} loaded={loaded} browse={() => input.current?.click()} onError={setError} isCurrent={() => generation.current === loaded.token} onCancel={cancel} /> : <section className={`drop-zone ${dragging ? 'drop-active' : ''}`}><div className="drop-art" aria-hidden="true"><span className="paper paper-back" /><span className="paper paper-front"><BookOpen size={45} strokeWidth={1.3} /><i /><i /><i /></span><span className="scissor-stamp"><Scissors size={26} /></span></div><p className="eyebrow">YOUR NEXT EDIT STARTS HERE</p><h2>Good books. Your cut.</h2><p>Drop a book here, or choose one from your device.</p><Button variant="primary" className="browse-button" onClick={() => input.current?.click()}><Plus size={20} /> Choose a book <ArrowUpRight size={18} /></Button><div className="format-tags">{formats.map(format => <span key={format}>{format}</span>)}<small>Up to {sizeLabel(DEFAULT_LIMITS.fileBytes)}</small></div><p className="drop-privacy"><ShieldCheck size={14} /> Opened in your browser. Never uploaded.</p></section>}
      {!loaded && !work ? <div className="format-guide"><article><span className="guide-number">01 / PAGES</span><h3>Trim a PDF.</h3><p>Keep the pages that matter.<br />Leave the rest behind.</p></article><article><span className="guide-number">02 / CHAPTERS</span><h3>Remix an EPUB.</h3><p>Pick chapters. Change the order.<br />Make your own reading list.</p></article><article><span className="guide-number">03 / COMICS</span><h3>Recut a comic.</h3><p>Choose your comic pages.<br />CBZ or CBR in. CBZ out.</p></article></div> : null}
    </main>
    <footer className="site-footer"><a href="https://www.linkedin.com/in/gerardo-larios/" target="_blank" rel="noopener noreferrer" aria-label="Made by Gerardo Larios on LinkedIn (opens in a new tab)">Made by Gerardo Larios</a><nav aria-label="Legal"><Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy policy (opens in a new tab)</Link><Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of service (opens in a new tab)</Link></nav><span><Scissors size={13} /> A clean cut, every time.</span></footer>
    {dragging ? <div className="file-drop-overlay" aria-hidden="true"><Upload size={40} /><strong>Drop your next book</strong><span>PDF, EPUB, CBZ, or CBR</span></div> : null}
    <Dialog open={help} onOpenChange={setHelp} title="A book, with your own edit." description="Three steps. Everything happens on your device."><div className="help-content"><h3>01. Open</h3><p>Choose one PDF, EPUB, CBZ, or CBR, up to {sizeLabel(DEFAULT_LIMITS.fileBytes)}. Protected or malformed books may not be supported.</p><h3>02. Pick & arrange</h3><p>Click cards or press Space to select. Shift-click selects a range. Use the range field for pages or chapters such as 1-5, 8. Your edit starts empty; source content is never changed.</p><h3>03. Export</h3><p>Drag the tray&apos;s handles, use arrow buttons, or enter a position. A focused handle supports Space, arrow keys, and Space to drop; Escape cancels. Edit book details and download. CBR is exported as CBZ.</p><p className="help-note">Keep your original file. Exports may not retain signatures, interactive PDF features, or every reader-specific EPUB feature. Review any warnings before sharing.</p></div></Dialog>
  </div>;
}

function Workspace({ loaded: { session, info }, browse, onError, isCurrent, onCancel }: {
  loaded: Loaded; browse: () => void; onError: (error: string) => void; isCurrent: () => boolean; onCancel: () => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [metadata, setMetadata] = useState<Metadata>({ ...info.metadata, title: info.metadata.title ?? '', author: info.metadata.author ?? '', ...(info.format === 'epub' ? { language: info.metadata.language || 'en' } : {}) });
  const [filename, setFilename] = useState(`${info.name.replace(/\.[^.]+$/, '')}-edit`);
  const [preview, setPreview] = useState<Unit>();
  const [tab, setTab] = useState<'source' | 'tray'>('source');
  const [active, setActive] = useState<string>();
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportWork, setExportWork] = useState<Work>();
  const anchor = useRef<number | undefined>(undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const selected = new Set(order);
  const units = new Map(info.units.map(unit => [unit.id, unit]));
  const extension = info.format === 'cbr' ? 'cbz' : info.format;
  const noun = info.format === 'epub' ? 'chapter' : 'page';
  const visibleNoun = info.format === 'cbz' || info.format === 'cbr' ? 'comic page' : noun;
  const metadataFields = [
    ['title', 'Title'], ['author', info.format === 'cbz' || info.format === 'cbr' ? 'Writer / author' : 'Author'],
    ...(info.format === 'pdf' ? [['subject', 'Subject'], ['keywords', 'Keywords'], ['creator', 'Creator'], ['producer', 'Producer']] : []),
    ...(info.format === 'epub' ? [['language', 'Language'], ['description', 'Description']] : []),
  ];
  function updateOrder(next: string[]) { setOrder(next); setExported(false); }
  function select(unit: Unit, index: number, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey && anchor.current !== undefined) {
      updateOrder(addSelection(order, info.units.slice(Math.min(anchor.current, index), Math.max(anchor.current, index) + 1).map(unit => unit.id)));
    } else { updateOrder(toggleSelection(order, unit.id)); anchor.current = index; }
  }
  function applyRange(event: React.FormEvent) {
    event.preventDefault();
    try { updateOrder(addSelection(order, parseRange(range, info.units.length).map(index => info.units[index].id))); setRangeError(''); }
    catch (error) { setRangeError(messageOf(error)); }
  }
  function dragEnd(event: DragEndEvent) {
    setActive(undefined);
    if (event.over) updateOrder(moveSelection(order, order.indexOf(String(event.active.id)), order.indexOf(String(event.over.id))));
  }
  async function exportBook() {
    if (!order.length || exporting) return;
    const basename = filename.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\.(pdf|epub|cbz|cbr)$/i, '');
    if (!basename || /^\.+$/.test(basename)) { onError('Enter a valid export filename.'); return; }
    if (info.format === 'epub' && !metadata.title.trim()) { onError('EPUB exports need a title.'); return; }
    if (info.format === 'epub' && !metadata.language?.trim()) { onError('EPUB exports need a language, such as en or fr.'); return; }
    setExporting(true); setExportWork({ percent: 0, message: 'Preparing your edit...' }); onError('');
    try {
      const result = await session.export(order, metadata, (percent, message) => { if (isCurrent()) setExportWork({ percent, message }); });
      if (!isCurrent()) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime }));
      const link = document.createElement('a'); link.href = url; link.download = `${basename}.${result.extension}`; document.body.append(link); link.click(); link.remove();
      // Give the browser time to consume the download before releasing its local URL.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExported(true); toast.success('Your edit is ready. Download started.');
      if (result.warnings?.length) toast.warning(result.warnings.join(' '), { duration: 12000 });
    } catch (error) { if (isCurrent()) onError(messageOf(error)); }
    finally { if (isCurrent()) { setExporting(false); setExportWork(undefined); } }
  }

  return <section className="workspace" aria-label="Book editing workspace">
    <div className="book-bar"><div className="book-file-icon"><FileText size={23} /></div><div className="book-description"><h2 title={info.name}>{info.name}</h2><p><span className="format-pill">{info.format.toUpperCase()}</span>{info.units.length} {visibleNoun}s <span className="separator">/</span> {sizeLabel(info.size)}</p></div><Button onClick={browse} disabled={exporting}><RotateCcw size={15} /><span>Change book</span></Button></div>
    {info.warnings.length ? <details className="book-warnings"><summary>{info.warnings.length} note{info.warnings.length === 1 ? '' : 's'} about this book</summary><ul>{info.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
    <div className="mobile-tabs" role="tablist" aria-label="Workspace panels" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'source' : event.key === 'End' ? 'tray' : tab === 'source' ? 'tray' : 'source';
      setTab(next); document.getElementById(`${next}-tab`)?.focus();
    }}><button type="button" role="tab" id="source-tab" aria-controls="source-panel" aria-selected={tab === 'source'} tabIndex={tab === 'source' ? 0 : -1} onClick={() => setTab('source')}>Original book <span>{info.units.length}</span></button><button type="button" role="tab" id="tray-tab" aria-controls="tray-panel" aria-selected={tab === 'tray'} tabIndex={tab === 'tray' ? 0 : -1} onClick={() => setTab('tray')}>Your edit <span>{order.length}</span></button></div>
    <div className="workspace-panels">
      <section id="source-panel" className={`source-panel ${tab === 'source' ? 'mobile-visible' : ''}`} aria-label="Original book">
        <div className="panel-heading"><div><p className="eyebrow">THE ORIGINAL</p><h2>Pick your {visibleNoun}s<span>.</span></h2></div><span className="count-badge">{info.units.length}</span></div>
        <div className="selection-toolbar"><span role="status" aria-live="polite">{order.length} selected</span><div><Button variant="ghost" disabled={exporting || !info.units.length} onClick={() => updateOrder(addSelection(order, info.units.map(unit => unit.id)))}>All</Button><Button variant="ghost" disabled={exporting || !order.length} onClick={() => updateOrder([])}>None</Button><Button variant="ghost" disabled={exporting || !info.units.length} onClick={() => updateOrder(info.units.filter(unit => !selected.has(unit.id)).map(unit => unit.id))}>Invert</Button></div></div>
        <form className="range-form" onSubmit={applyRange}><label htmlFor="range">Select a range</label><div><input id="range" value={range} onChange={event => setRange(event.target.value)} placeholder="e.g. 1-5, 8, 12" aria-describedby={rangeError ? 'range-error' : 'selection-hint'} aria-invalid={!!rangeError} disabled={exporting} /><Button type="submit" disabled={exporting || !info.units.length} aria-label="Add range to your edit"><Plus size={17} /> Add</Button></div></form>
        {rangeError ? <p className="field-error" id="range-error" role="alert">{rangeError}</p> : <p className="selection-hint" id="selection-hint">Click to select. Shift-click for a range. Preview for a closer look.</p>}
        <VirtuosoGrid className="source-grid" style={{ height: 'var(--source-height)' }} data={info.units} computeItemKey={(_, unit) => unit.id} listClassName="source-grid-list" itemClassName="source-grid-item" itemContent={(index, unit) => <article className={`source-card ${selected.has(unit.id) ? 'is-selected' : ''}`}><button type="button" className="source-select" aria-label={`${selected.has(unit.id) ? 'Deselect' : 'Select'} ${noun} ${index + 1}: ${unit.title}`} aria-pressed={selected.has(unit.id)} disabled={exporting} onClick={event => select(unit, index, event)}><div className="source-preview"><UnitPreview session={session} id={unit.id} format={info.format} title={unit.title} excerpt={unit.excerpt} /><span className="selection-check">{selected.has(unit.id) ? <Check size={14} /> : null}</span></div><div className="source-caption"><span className="page-number">{String(index + 1).padStart(2, '0')}</span><span title={unit.title}>{unit.title}</span></div></button><button className="preview-button" type="button" aria-label={`Preview ${noun} ${index + 1}: ${unit.title}`} onClick={() => setPreview(unit)}><Eye size={14} /><span>Preview</span></button></article>} />
      </section>
      <section id="tray-panel" className={`tray-panel ${tab === 'tray' ? 'mobile-visible' : ''}`} aria-label="Your edit">
        <div className="panel-heading"><div><p className="eyebrow">THE NEW EDIT</p><h2>Your book, recut<span>.</span></h2></div><span className="count-badge accent-count">{order.length}</span></div><p className="tray-hint">Drag to reorder. The original stays untouched.</p>
        {order.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={event => setActive(String(event.active.id))} onDragEnd={dragEnd} onDragCancel={() => setActive(undefined)}><SortableContext items={order} strategy={verticalListSortingStrategy}><Virtuoso className="tray-list" style={{ height: 249, flex: '0 0 249px' }} data={order} computeItemKey={(_, id) => id} itemContent={(index, id) => <TrayRow unit={units.get(id)!} index={index} count={order.length} disabled={exporting} onMove={position => updateOrder(moveSelection(order, index, position))} onRemove={() => updateOrder(order.filter(value => value !== id))} onPreview={() => setPreview(units.get(id))} />} /></SortableContext><DragOverlay>{active ? <div className="drag-overlay"><GripVertical size={18} />{units.get(active)?.title}</div> : null}</DragOverlay></DndContext> : <div className="empty-tray"><span><Scissors size={28} strokeWidth={1.4} /></span><h3>A fresh start.</h3><p>Select {visibleNoun}s from the original.<br />Your new book takes shape here.</p><Button className="mobile-only" onClick={() => setTab('source')}>Pick {visibleNoun}s <ArrowUpRight size={16} /></Button></div>}
        <details className="metadata-section" open>
          <summary>Book details <span>{info.format === 'epub' ? 'Title & language required' : 'Optional'}</span></summary>
          <div className="metadata-fields">
            {metadataFields.map(([key, label]) => <label key={key} htmlFor={`book-${key}`} className={key === 'description' ? 'metadata-wide' : undefined}>
              {label}
              {key === 'description' ? <textarea id={`book-${key}`} value={metadata[key] ?? ''} disabled={exporting} rows={3} onChange={event => { setMetadata({ ...metadata, [key]: event.target.value }); setExported(false); }} /> : <input id={`book-${key}`} value={metadata[key] ?? ''} required={info.format === 'epub' && (key === 'title' || key === 'language')} disabled={exporting} placeholder={key === 'language' ? 'en, fr, en-US...' : key === 'keywords' ? 'Separate with commas' : undefined} onChange={event => { setMetadata({ ...metadata, [key]: event.target.value }); setExported(false); }} />}
            </label>)}
          </div>
        </details>
        <div className="export-section"><label htmlFor="export-name">Export filename</label><div className="filename-input"><input id="export-name" value={filename} maxLength={180} disabled={exporting} onChange={event => { setFilename(event.target.value); setExported(false); }} /><span>.{extension}</span></div>{info.format === 'cbr' ? <p className="conversion-note">CBR in, CBZ out. Same pages, an open format.</p> : <p className="conversion-note">Exports as {extension.toUpperCase()}. Only your selected {noun}s.</p>}<Button variant="primary" className="export-button" disabled={exporting || !order.length || !filename.trim()} onClick={() => void exportBook()}>{exporting ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}{exporting ? 'Making your edit...' : `Export ${order.length ? `${order.length} ${noun}${order.length === 1 ? '' : 's'}` : 'your edit'}`}<ArrowUpRight size={17} /></Button>{exported ? <p className="export-success" role="status"><CheckCircle2 size={16} /> Ready. Your download has started.</p> : <p className="export-footnote"><ShieldCheck size={12} /> Saved to your device. Nothing sent anywhere.</p>}</div>
      </section>
    </div>
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(undefined); }} title={preview?.title ?? 'Preview'} description={preview ? `${noun === 'page' ? 'Page' : 'Chapter'} ${info.units.findIndex(unit => unit.id === preview.id) + 1} of ${info.units.length}. Original content preview.` : ''} className="preview-dialog">{preview ? <div className="large-preview"><UnitPreview key={preview.id} session={session} id={preview.id} format={info.format} large /></div> : null}</Dialog>
    <Dialog open={exporting} onOpenChange={() => {}} closable={false} title="Putting your edit together." description="Your source stays untouched. Your export stays local."><div className="export-progress" aria-live="polite"><LoaderCircle className="spin" size={28} /><p>{exportWork?.message}</p><progress max={100} value={Math.max(0, Math.min(100, exportWork?.percent ?? 0))} aria-label="Export progress" /><Button onClick={onCancel}><X size={16} /> Cancel & close book</Button><small>Canceling closes this session. You can reopen the original.</small></div></Dialog>
  </section>;
}

function TrayRow({ unit, index, count, disabled, onMove, onRemove, onPreview }: { unit: Unit; index: number; count: number; disabled: boolean; onMove: (position: number) => void; onRemove: () => void; onPreview: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: unit.id, disabled });
  return <div ref={setNodeRef} className={`tray-row ${isDragging ? 'is-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}><button type="button" className="drag-handle" {...attributes} {...listeners} disabled={disabled} aria-label={`Reorder ${unit.title}. Press Space to pick up, arrows to move, Space to drop.`}><GripVertical size={18} /></button><span className="tray-number">{String(index + 1).padStart(2, '0')}</span><button className="tray-title" type="button" title={unit.title} onClick={onPreview}>{unit.title}<span>Source {unit.index + 1}</span></button><div className="tray-controls"><Button className="icon-button" variant="ghost" disabled={disabled || index === 0} aria-label={`Move ${unit.title} up`} onClick={() => onMove(index - 1)}><ArrowUp size={14} /></Button><Button className="icon-button" variant="ghost" disabled={disabled || index === count - 1} aria-label={`Move ${unit.title} down`} onClick={() => onMove(index + 1)}><ArrowDown size={14} /></Button><input key={index} className="position-input" type="number" min={1} max={count} defaultValue={index + 1} disabled={disabled} aria-label={`Position of ${unit.title}`} onBlur={event => { const position = Number(event.target.value); if (Number.isInteger(position) && position >= 1 && position <= count) onMove(position - 1); else event.target.value = String(index + 1); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><Button className="icon-button remove-button" variant="ghost" disabled={disabled} aria-label={`Remove ${unit.title} from edit`} onClick={onRemove}><X size={15} /></Button></div></div>;
}
