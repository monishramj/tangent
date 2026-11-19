import { useState } from 'react';
import { plainError } from '../plainError';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import Icon from '@/components/Icon';
import { estimateMinutesFor, type DetailLevel } from '../gen/script';
import { topSelected, type SectionRef } from './api';
import SectionPicker from './SectionPicker';
import GenerationPanel from './GenerationPanel';
import { pages } from './SourceView';

export type ComposeSource = { id: string; name: string; sections?: SectionRef[]; status?: string };
export type FolderPick = { sourceId: string; sectionIds: string[] };
export type FolderComposeProps = {
  sources: ComposeSource[];
  detail: DetailLevel; onDetailChange: (d: DetailLevel) => void;
  /** Markdown of one section plus descendants (length estimate). */
  sectionMarkdown: (sourceId: string, id: string) => string;
  onGenerate: (picks: FolderPick[], detail: DetailLevel) => void | Promise<void>;
};

/** "Make a video" across a folder: each PDF is one collapsed row; expand only the ones you pick from. */
export default function FolderCompose({ sources, detail, onDetailChange, sectionMarkdown, onGenerate, onCancel }: FolderComposeProps & { onCancel: () => void }) {
  const ready = sources.filter(s => s.sections?.length);
  const [open, setOpen] = useState<Set<string>>(() => new Set(ready.length === 1 ? [ready[0].id] : []));
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const picks: FolderPick[] = ready.map(s => ({ sourceId: s.id, sectionIds: picked[s.id] ? topSelected(s.sections!, picked[s.id]) : [] })).filter(p => p.sectionIds.length);
  const count = picks.reduce((n, p) => n + p.sectionIds.length, 0);
  const minutesFor = (level: DetailLevel) => estimateMinutesFor(picks.flatMap(p => p.sectionIds.map(id => ({
    title: ready.find(s => s.id === p.sourceId)?.sections?.find(r => r.id === id)?.title ?? id, markdown: sectionMarkdown(p.sourceId, id),
  }))), level);
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const make = async () => {
    if (!count || generating) return;
    setGenerating(true); setError('');
    try { await onGenerate(picks, detail); } catch (e) { setError(`Couldn't make the video. ${plainError(e)}`); }
    finally { setGenerating(false); }
  };
  return <section className="tl-compose" aria-label="Make a video from this folder">
    <p className="tl-status">Pick sections from one or more PDFs. They play in this order.</p>
    {error && <p className="tl-error" role="alert">{error}</p>}
    <ul className="tl-compose-list">{sources.map(s => {
      const n = picks.find(p => p.sourceId === s.id)?.sectionIds.length ?? 0;
      const expandable = !!s.sections?.length;
      return <li key={s.id}>
        <button type="button" className="tl-compose-row" aria-expanded={expandable ? open.has(s.id) : undefined} disabled={!expandable} onClick={() => toggle(s.id)}>
          <Icon icon={ArrowRight01Icon} size={16} className={open.has(s.id) ? 'tl-chevron-open' : undefined} />
          <span><strong>{s.name}</strong><small>{expandable ? `${s.sections!.length} ${s.sections!.length === 1 ? 'section' : 'sections'}` : s.status ?? 'No sections found'}</small></span>
          {n > 0 && <span className="tl-compose-count">{n} picked</span>}
        </button>
        {expandable && open.has(s.id) && <SectionPicker label={s.name} rows={s.sections!.map(r => ({ id: r.id, title: r.title, level: r.level, pages: pages(r) }))}
          selected={picked[s.id] ?? new Set()} onChange={next => setPicked(m => ({ ...m, [s.id]: next }))} />}
      </li>;
    })}</ul>
    <GenerationPanel count={count} summary={count ? `${count} ${count === 1 ? 'section' : 'sections'} from ${picks.length} ${picks.length === 1 ? 'PDF' : 'PDFs'}` : undefined}
      detail={detail} onDetail={onDetailChange} minutesFor={minutesFor} generating={generating} onCancel={onCancel} onMake={() => void make()} />
  </section>;
}
