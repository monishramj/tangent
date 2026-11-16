import { isPhotoSource, TRANSCRIPTION_LABEL } from "../gen/transcribe";
import { useEffect, useRef, useState } from 'react';
import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, File02Icon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import Icon from '@/components/Icon';
import ShinyText from '@/components/ShinyText';
import LoadingCircle from '@/components/LoadingCircle';
import Page from '@/player/PdfPage';
import type { Passage, RenderPage } from '@/follow/types';
import { DETAIL_LEVELS, estimateMinutesFor, type DetailLevel } from '../gen/script';
import type { LoadProgress } from '../library';
import { preparationLabel, type IngestItem } from './ingestQueue';
import type { VideoBundle } from '../storage/videos';
import { isOfficeSource } from '../storage/library';
import { pdfInfo, pdfPage, topSelected, type SectionRef } from './api';
import { PreparationOverlay, LibraryShell, VideoList, type SourceSummary } from './LibraryView';
import SectionPicker from './SectionPicker';

export type SourceViewProps = {
  source: SourceSummary; folderName?: string; sections: SectionRef[]; videos: VideoBundle[];
  onBack: () => void; onHome?: () => void; onSettings?: () => void; onOpenVideo: (video: VideoBundle) => void;
  onGenerate: (ids: string[], detail: DetailLevel, also?: { sourceId: string; sectionIds: string[] }[]) => void | Promise<void>;
  /** Other library sources the user can add sections from. Only those with sections are offered. */
  otherSources?: { id: string; name: string; sections?: SectionRef[] }[];
  /** Open already choosing sections (dev proof page). */
  seedSelection?: string[];
  renderPage?: RenderPage;
  onDeleteVideo?: (id: string) => void | Promise<void>;
  passages?: Passage[];
  initialDetail?: DetailLevel; onDetailChange?: (detail: DetailLevel) => void;
  /** Markdown of one section plus descendants. sourceId is set for a section from another source. */
  sectionMarkdown?: (id: string, sourceId?: string) => string;
  preparation?: IngestItem<unknown>; loading?: string; progress?: LoadProgress; error?: string; cleanupPending?: boolean; warning?: string; onRetryCleanup?: () => void;
};
const detailLabel: Record<DetailLevel, string> = { overview: 'Overview', standard: 'Standard', detailed: 'Detailed', complete: 'Complete' };
const detailHint: Record<DetailLevel, string> = {
  overview: 'Key ideas only. Shortest video.', standard: 'Key ideas, main definitions and examples.',
  detailed: 'Every idea, example and important caveat.', complete: 'Covers everything in the section. Longest video.',
};
function pages(section: SectionRef) {
  if (!section.anchors.length) return '';
  const nums = section.anchors.map(a => a.page), lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `p. ${lo}` : `pp. ${lo}-${hi}`;
}

export default function SourceView(props: SourceViewProps) {
  const { source, sections, videos } = props;
  const textSource = isOfficeSource(source.pdfPath) || isPhotoSource(source.pdfPath);
  const [tab, setTab] = useState<'sections' | 'pdf'>('sections');
  const [selecting, setSelecting] = useState(props.seedSelection != null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(props.seedSelection ?? []));
  const [detail, setDetail] = useState<DetailLevel>(props.initialDetail ?? 'standard');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [extras, setExtras] = useState<{ sourceId: string; name: string; sectionId: string; title: string }[]>([]);
  const [add, setAdd] = useState<null | { pick?: string; selected: Set<string> }>(null);
  const makeButton = useRef<HTMLButtonElement>(null);
  const others = (props.otherSources ?? []).filter(s => s.sections?.length);
  useEffect(() => { setTab('sections'); setSelecting(props.seedSelection != null); setSelected(new Set(props.seedSelection ?? [])); setExtras([]); setAdd(null); setError(''); }, [source.id, props.seedSelection]);
  const ids = topSelected(sections, selected);
  const minutesFor = (level: DetailLevel) => estimateMinutesFor([
    ...ids.map(id => ({ title: sections.find(s => s.id === id)?.title ?? id, markdown: props.sectionMarkdown?.(id) ?? "" })),
    ...extras.map(e => ({ title: e.title, markdown: props.sectionMarkdown?.(e.sectionId, e.sourceId) ?? "" })),
  ], level);
  const count = ids.length + extras.length;
  const cancel = () => { setSelecting(false); setSelected(new Set()); setExtras([]); setAdd(null); requestAnimationFrame(() => makeButton.current?.focus()); };
  const generate = async () => {
    if (!count || generating) return;
    setGenerating(true); setError('');
    const also = [...extras.reduce((m, e) => m.set(e.sourceId, [...(m.get(e.sourceId) ?? []), e.sectionId]), new Map<string, string[]>())].map(([sourceId, sectionIds]) => ({ sourceId, sectionIds }));
    try { if (also.length) await props.onGenerate(ids, detail, also); else await props.onGenerate(ids, detail); } catch (e) { setError(`Couldn't make the video: ${String(e)}`); }
    finally { setGenerating(false); }
  };
  return <LibraryShell onHome={props.onHome ?? props.onBack} onSettings={props.onSettings} wide>
    <button className="tl-back" onClick={props.onBack}><Icon icon={ArrowLeft01Icon} size={16} />{props.folderName ?? 'Home'}</button>
    <div className="tl-heading tl-source-heading"><span className="tl-file-icon">{source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" /> : <Icon icon={File02Icon} size={21} />}<PreparationOverlay item={props.preparation} /></span><div><p className="tl-eyebrow">READING MATERIAL</p><h1>{source.name}</h1><p>{source.pageCount ? `${source.pageCount} pages · ` : ''}{sections.length} sections{props.preparation && ` · ${preparationLabel(props.preparation)}`}</p></div></div>
    {(error || props.error) && <p className="tl-error" role="alert">{error || props.error}</p>}
    {isPhotoSource(source.pdfPath) && <p className="tl-empty">{TRANSCRIPTION_LABEL}</p>}
    <div className="tl-source-grid"><section className="tl-source-main">
      <div className="tl-source-toolbar"><div className="tl-tabs" role="tablist" aria-label="Source view">
        {(['sections', 'pdf'] as const).map(value => <button id={`source-tab-${value}`} key={value} role="tab" aria-selected={tab === value} aria-controls={`source-panel-${value}`} tabIndex={tab === value ? 0 : -1}
          onClick={() => setTab(value)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'sections' : e.key === 'End' ? 'pdf' : value === 'pdf' ? 'sections' : 'pdf'; setTab(next); document.getElementById(`source-tab-${next}`)?.focus(); } }}>{value === 'sections' ? 'Sections' : textSource ? 'Source' : 'Original PDF'}</button>)}
      </div>{!selecting && <button ref={makeButton} className="tl-primary" disabled={!!props.loading || !sections.length} onClick={() => { setSelecting(true); setTab('sections'); }}>Make a video <Icon icon={Add01Icon} size={16} /></button>}</div>
      {tab === 'sections' ? <div role="tabpanel" id="source-panel-sections" aria-labelledby="source-tab-sections">
        {props.loading ? <div className="tl-loading" role="status"><ShinyText text={props.loading} color="#999" shineColor="#fff" />{props.progress && <><progress aria-label="Reading PDF" value={props.progress.fraction} max={1} /><small>{props.progress.label}</small></>}</div> : <>
          {props.cleanupPending && <p className="tl-status" role="status">Tidying section titles…</p>}
          {!props.cleanupPending && props.warning && <p className="tl-status" role="status">{props.warning}</p>}
          {props.onRetryCleanup && !props.cleanupPending && <button className="tl-text-button" onClick={props.onRetryCleanup}>{props.sections.length ? 'Retry section titles' : 'Retry PDF'}</button>}
          {selecting && !add && <div className="tl-selection-head"><span>Choose sections<small>{count ? `${count} selected` : 'Click a title or its brace'}</small></span><button className="tl-text-button" onClick={() => setSelected(selected.size === sections.length ? new Set() : new Set(sections.map(s => s.id)))}>{selected.size === sections.length ? 'Clear selection' : 'Select all'}</button>{others.length > 0 && <button className="tl-text-button" type="button" onClick={() => setAdd({ selected: new Set() })}>Add another source</button>}</div>}
          {extras.length > 0 && !add && <ul aria-label="Selected sections" className="tl-sections">{[
            ...ids.map(id => ({ key: id, name: source.name, title: sections.find(s => s.id === id)?.title ?? id })),
            ...extras.map(e => ({ key: `${e.sourceId}/${e.sectionId}`, name: e.name, title: e.title })),
          ].map(row => <li className="tl-section-row" key={row.key}><span>{row.name}</span><small>{row.title}</small></li>)}</ul>}
          {!sections.length && <p className="tl-empty">No sections found in this PDF. You can still view the original.</p>}
          {selecting && add && !add.pick && <div aria-label="Add another source"><p className="tl-status">Add another source</p>{others.map(s => <button key={s.id} type="button" className="tl-section-row" onClick={() => setAdd({ pick: s.id, selected: new Set(extras.filter(e => e.sourceId === s.id).map(e => e.sectionId)) })}>{s.name}</button>)}<button type="button" className="tl-text-button" onClick={() => setAdd(null)}>Back</button></div>}
          {selecting && add?.pick && (() => {
            const other = others.find(s => s.id === add.pick);
            if (!other?.sections) return null;
            const rows = other.sections;
            return <><SectionPicker label={other.name} rows={rows.map(section => ({ id: section.id, title: section.title, level: section.level, pages: pages(section) }))} selected={add.selected} onChange={selected => setAdd({ pick: other.id, selected })} />
              <div className="tl-generation-bottom"><button type="button" className="tl-text-button" onClick={() => setAdd({ selected: new Set() })}>Back</button><button type="button" className="tl-primary" disabled={!add.selected.size} onClick={() => {
                const chosen = topSelected(rows, add.selected);
                setExtras(prev => [...prev.filter(e => e.sourceId !== other.id), ...chosen.map(id => ({ sourceId: other.id, name: other.name, sectionId: id, title: rows.find(r => r.id === id)?.title ?? id }))]);
                setAdd(null);
              }}>Add sections</button></div></>;
          })()}
          {!add && <SectionPicker browse={!selecting} rows={sections.map(section => ({ id: section.id, title: section.title, level: section.level, pages: pages(section) }))} selected={selected} onChange={setSelected} />}
          {selecting && !add && <div className="tl-generation"><div className="tl-generation-top"><span id="video-detail-label">Detail level</span></div>
            <div className="tl-detail" role="radiogroup" aria-labelledby="video-detail-label">{DETAIL_LEVELS.map(d => {
              const minutes = minutesFor(d);
              const length = minutes ? `about ${minutes} min` : "";
              return <label key={d} className={detail === d ? "tl-picked" : ""}><input type="radio" name="video-detail" value={d} checked={detail === d} aria-label={length ? `${detailLabel[d]}, ${length}` : detailLabel[d]} onChange={() => { setDetail(d); props.onDetailChange?.(d); }} /><span>{detailLabel[d]}</span>{length && <small>{length}</small>}</label>;
            })}</div>
            <p>{detailHint[detail]} Sections and detail set the length.</p><div className="tl-generation-bottom"><button className="tl-text-button" disabled={generating} onClick={cancel}>Cancel</button><button className="tl-primary" disabled={!count || generating} onClick={() => void generate()}>{generating ? 'Starting…' : `Make video${count ? ` · ${count} selected` : ''}`}<Icon icon={ArrowRight01Icon} size={16} /></button></div>
          </div>}
        </>}
      </div> : <div role="tabpanel" id="source-panel-pdf" aria-labelledby="source-tab-pdf" className="tl-pdf-panel">
        {textSource ? <>{isPhotoSource(source.pdfPath) && <p>{TRANSCRIPTION_LABEL}</p>}<SourceText passages={props.passages ?? []} /></> : <PdfPages key={source.pdfPath} source={source} renderPage={props.renderPage ?? pdfPage} />}
      </div>}
    </section><aside className="tl-source-videos"><h2>Videos<span>{videos.length}</span></h2><VideoList videos={videos} onOpen={props.onOpenVideo} onDelete={props.onDeleteVideo} label="Videos from this source" /><p>Every video you make from this PDF lives here.</p></aside></div>
  </LibraryShell>;
}

function SourceText({ passages }: { passages: Passage[] }) {
  if (!passages.length) return <p className="tl-empty">No text in this file yet.</p>;
  return <div aria-label="Source text" className="space-y-3 overflow-auto p-4 text-sm leading-6 whitespace-pre-wrap">
    {passages.map(p => <p key={p.id} data-passage={p.id}>{p.markdown}</p>)}
  </div>;
}

function PdfPages({ source, renderPage }: { source: SourceSummary; renderPage: RenderPage }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(source.pageCount);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [aspect, setAspect] = useState(0.75);
  const [width, setWidth] = useState(360);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('tangent.pdfDark') !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    if (source.pageCount) { setCount(source.pageCount); setError(false); return; }
    let live = true;
    setError(false);
    void pdfInfo(source.pdfPath).then(info => {
      if (!Number.isInteger(info.pages) || info.pages < 1) throw new Error('No PDF pages');
      if (live) setCount(info.pages);
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [source.pdfPath, source.pageCount, attempt]);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => {
      if (!root.clientWidth) return;
      const next = Math.min(900, Math.max(1, root.clientWidth - 24));
      root.style.setProperty('--page-w', `${next}px`);
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(next), 250);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [count]);
  return <>
    <div className="tl-pdf-tools"><button type="button" className="tl-icon-button" aria-label="Dark pages" title={dark ? 'Original colors' : 'Dark pages'} aria-pressed={dark}
      onClick={() => { const next = !dark; setDark(next); try { localStorage.setItem('tangent.pdfDark', String(next)); } catch { /* Storage can be unavailable. */ } }}>
      <Icon icon={dark ? Sun03Icon : Moon02Icon} size={18} />
    </button></div>
    {error ? <div className="tl-pdf-empty"><Icon icon={File02Icon} size={34} /><strong>PDF preview unavailable</strong><p>The original file may have moved or be unavailable in this browser.</p><button className="tl-quiet" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      : count ? <div ref={scroller} aria-label="Original PDF pages" tabIndex={0} className={`tl-pdf-pages${dark ? ' tl-pdf-dark' : ''}`} style={{ '--page-w': '360px' } as React.CSSProperties}>
        {Array.from({ length: count }, (_, i) => <Page key={`${source.pdfPath}:${i + 1}`} path={source.pdfPath} page={i + 1} first={i === 0} aspect={aspect} width={width} onAspect={setAspect} root={scroller} renderPage={renderPage} />)}
      </div> : <div className="tl-pdf-empty"><LoadingCircle label="Loading PDF pages" /></div>}
  </>;
}
