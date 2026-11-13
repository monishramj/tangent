import { useEffect, useRef, useState } from 'react';
import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, File02Icon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import Select from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/TextField';
import Icon from '@/components/Icon';
import ShinyText from '@/components/ShinyText';
import LoadingCircle from '@/components/LoadingCircle';
import Page from '@/player/PdfPage';
import type { RenderPage } from '@/follow/types';
import { DETAIL_LEVELS, isDetailLevel, type DetailLevel } from '../gen/script';
import type { LoadProgress } from '../library';
import { preparationLabel, type IngestItem } from './ingestQueue';
import type { VideoBundle } from '../storage/videos';
import { pdfInfo, pdfPage, topSelected, type SectionRef } from './api';
import { PreparationOverlay, LibraryShell, VideoList, type SourceSummary } from './LibraryView';

export type SourceViewProps = {
  source: SourceSummary; folderName?: string; sections: SectionRef[]; videos: VideoBundle[];
  onBack: () => void; onHome?: () => void; onSettings?: () => void; onOpenVideo: (video: VideoBundle) => void;
  onGenerate: (ids: string[], detail: DetailLevel) => void | Promise<void>;
  renderPage?: RenderPage;
  onDeleteVideo?: (id: string) => void | Promise<void>;
  initialDetail?: DetailLevel; onDetailChange?: (detail: DetailLevel) => void;
  preparation?: IngestItem<unknown>; loading?: string; progress?: LoadProgress; error?: string; cleanupPending?: boolean; onRetryCleanup?: () => void;
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
  const [tab, setTab] = useState<'sections' | 'pdf'>('sections');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DetailLevel>(props.initialDetail ?? 'standard');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ start: number; base: Set<string>; add: boolean } | null>(null);
  const suppressClick = useRef(false);
  const makeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTab('sections'); setSelecting(false); setSelected(new Set()); setError(''); drag.current = null; }, [source.id]);
  useEffect(() => {
    const stop = () => { drag.current = null; };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); window.addEventListener('blur', stop);
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); };
  }, []);
  const ids = topSelected(sections, selected);
  const selectRange = (end: number) => {
    const current = drag.current;
    if (!current) return;
    const next = new Set(current.base);
    for (let i = Math.min(current.start, end); i <= Math.max(current.start, end); i++) {
      const id = sections[i].id;
      if (current.add) next.add(id); else next.delete(id);
    }
    setSelected(next);
  };
  const cancel = () => { setSelecting(false); setSelected(new Set()); drag.current = null; requestAnimationFrame(() => makeButton.current?.focus()); };
  const generate = async () => {
    if (!ids.length || generating) return;
    setGenerating(true); setError('');
    try { await props.onGenerate(ids, detail); } catch (e) { setError(`Couldn't make the video: ${String(e)}`); }
    finally { setGenerating(false); }
  };
  return <LibraryShell onHome={props.onHome ?? props.onBack} onSettings={props.onSettings} wide>
    <button className="tl-back" onClick={props.onBack}><Icon icon={ArrowLeft01Icon} size={16} />{props.folderName ?? 'Home'}</button>
    <div className="tl-heading tl-source-heading"><span className="tl-file-icon">{source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" /> : <Icon icon={File02Icon} size={21} />}<PreparationOverlay item={props.preparation} /></span><div><p className="tl-eyebrow">READING MATERIAL</p><h1>{source.name}</h1><p>{source.pageCount ? `${source.pageCount} pages · ` : ''}{sections.length} sections{props.preparation && ` · ${preparationLabel(props.preparation)}`}</p></div></div>
    {(error || props.error) && <p className="tl-error" role="alert">{error || props.error}</p>}
    <div className="tl-source-grid"><section className="tl-source-main">
      <div className="tl-source-toolbar"><div className="tl-tabs" role="tablist" aria-label="Source view">
        {(['sections', 'pdf'] as const).map(value => <button id={`source-tab-${value}`} key={value} role="tab" aria-selected={tab === value} aria-controls={`source-panel-${value}`} tabIndex={tab === value ? 0 : -1}
          onClick={() => setTab(value)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'sections' : e.key === 'End' ? 'pdf' : value === 'pdf' ? 'sections' : 'pdf'; setTab(next); document.getElementById(`source-tab-${next}`)?.focus(); } }}>{value === 'sections' ? 'Sections' : 'Original PDF'}</button>)}
      </div>{!selecting && <button ref={makeButton} className="tl-primary" disabled={!!props.loading || !sections.length} onClick={() => { setSelecting(true); setTab('sections'); }}>Make a video <Icon icon={Add01Icon} size={16} /></button>}</div>
      {tab === 'sections' ? <div role="tabpanel" id="source-panel-sections" aria-labelledby="source-tab-sections">
        {props.loading ? <div className="tl-loading" role="status"><ShinyText text={props.loading} color="#999" shineColor="#fff" />{props.progress && <><progress aria-label="Reading PDF" value={props.progress.fraction} max={1} /><small>{props.progress.label}</small></>}</div> : <>
          {props.cleanupPending && <p className="tl-status" role="status">Tidying section titles…</p>}
          {props.onRetryCleanup && !props.cleanupPending && <button className="tl-text-button" onClick={props.onRetryCleanup}>{props.sections.length ? 'Retry section titles' : 'Retry PDF'}</button>}
          {selecting && <div className="tl-selection-head"><span>Choose sections<small>Click or drag to select</small></span><button className="tl-text-button" onClick={() => setSelected(selected.size === sections.length ? new Set() : new Set(sections.map(s => s.id)))}>{selected.size === sections.length ? 'Clear selection' : 'Select all'}</button></div>}
          {!sections.length && <p className="tl-empty">No sections found in this PDF. You can still view the original.</p>}
          <div className={`tl-sections ${selecting ? 'tl-selecting' : ''}`} aria-label="Sections">{sections.map((section, index) => <label className={`tl-section-row ${selecting && selected.has(section.id) ? 'tl-picked' : ''}`} key={section.id}
            onPointerDown={e => { suppressClick.current = false; if (!selecting || e.button !== 0 || e.pointerType === 'touch' || (e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); suppressClick.current = true; drag.current = { start: index, base: selected, add: !selected.has(section.id) }; selectRange(index); }}
            onPointerEnter={e => { if (selecting && e.buttons === 1) selectRange(index); else drag.current = null; }}
            onClick={e => { if (suppressClick.current) { e.preventDefault(); suppressClick.current = false; } }}>
            {selecting && <Checkbox aria-label={`Select ${section.title}`} checked={selected.has(section.id)} onChange={e => setSelected(previous => { const next = new Set(previous); if (e.target.checked) next.add(section.id); else next.delete(section.id); return next; })} />}
            <span style={{ paddingLeft: Math.min(4, Math.max(0, section.level - 1)) * 16 }}>{section.title}</span><small>{pages(section)}</small>
          </label>)}</div>
          {selecting && <div className="tl-generation"><div className="tl-generation-top"><label htmlFor="video-detail">Detail level</label><Select id="video-detail" value={detail} onChange={e => { const value = e.target.value; if (!isDetailLevel(value)) return; setDetail(value); props.onDetailChange?.(value); }}>{DETAIL_LEVELS.map(d => <option value={d} key={d}>{detailLabel[d]}</option>)}</Select></div>
            <p>{detailHint[detail]}</p><div className="tl-generation-bottom"><button className="tl-text-button" disabled={generating} onClick={cancel}>Cancel</button><button className="tl-primary" disabled={!ids.length || generating} onClick={() => void generate()}>{generating ? 'Starting…' : `Make video${ids.length ? ` · ${ids.length} selected` : ''}`}<Icon icon={ArrowRight01Icon} size={16} /></button></div>
          </div>}
        </>}
      </div> : <div role="tabpanel" id="source-panel-pdf" aria-labelledby="source-tab-pdf" className="tl-pdf-panel">
        <PdfPages key={source.pdfPath} source={source} renderPage={props.renderPage ?? pdfPage} />
      </div>}
    </section><aside className="tl-source-videos"><h2>Videos<span>{videos.length}</span></h2><VideoList videos={videos} onOpen={props.onOpenVideo} onDelete={props.onDeleteVideo} label="Videos from this source" /><p>Every video you make from this PDF lives here.</p></aside></div>
  </LibraryShell>;
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
