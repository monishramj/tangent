import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { paintSelection, selectionState, treeModel, type SelectState } from './sectionTree';
import './sectionPicker.css';

export type PickerRow = { id: string; title: string; level: number; pages: string };

const Brace = ({ state, onClick, label }: { state: SelectState; onClick: () => void; label: string }) =>
  <button type="button" tabIndex={-1} aria-hidden className="pk-brace" data-state={state} title={label} onClick={e => { e.stopPropagation(); onClick(); }}><span className="pk-brace-in">
    <svg viewBox="0 0 12 9" height="9" aria-hidden><path d="M11 1.1C8.4 .9 6.5 2.3 6.2 5.2L6.3 9" /></svg>
    <span className="pk-stem" />
    <svg viewBox="0 0 12 13" height="13" aria-hidden><path d="M6.3 0C6.5 4.3 5.2 6.2 1 6.6 5.1 7 6.4 9 6.1 13" /></svg>
    <span className="pk-stem" />
    <svg viewBox="0 0 12 9" height="9" aria-hidden><path d="M6.1 0 6.3 3.8C6.6 6.8 8.5 8.2 11 8" /></svg>
  </span></button>;

export default function SectionPicker({ rows, selected, onChange, label = 'Sections' }: {
  rows: PickerRow[]; selected: Set<string>; onChange: (next: Set<string>) => void; label?: string;
}) {
  const m = treeModel(rows);
  const base = rows.reduce((n, r) => Math.min(n, r.level), 1);
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const drag = useRef<{ start: number; base: Set<string>; add: boolean; moved: boolean } | null>(null);
  const kbd = useRef<{ anchor: number; base: Set<string> } | null>(null);
  const wantFocus = useRef(false);
  const [kb, setKb] = useState(false);
  useEffect(() => { if (wantFocus.current) { wantFocus.current = false; const el = refs.current[focus]; el?.focus(); el?.scrollIntoView?.({ block: 'nearest' }); } }, [focus]);
  useEffect(() => {
    const stop = () => { drag.current = null; };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, []);
  const toggle = (i: number) => onChange(paintSelection(selected, rows, m, i, i, selectionState(i, selected, rows, m) !== 'full'));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Number((e.target as HTMLElement).dataset.i);
    if (Number.isNaN(i)) return;
    setKb(true);
    const go = (to: number) => {
      to = Math.max(0, Math.min(rows.length - 1, to));
      if (e.shiftKey) { const k = kbd.current ??= { anchor: i, base: selected }; onChange(paintSelection(k.base, rows, m, k.anchor, to, true)); }
      else kbd.current = null;
      wantFocus.current = true; setFocus(to); e.preventDefault();
    };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'ArrowRight' && m.kids[i].length) go(i + 1);
    else if (e.key === 'ArrowLeft' && m.parent[i] >= 0) go(m.parent[i]);
    else if (e.key === ' ' || e.key === 'Enter') { kbd.current = null; toggle(i); e.preventDefault(); }
  };
  const renderNode = (i: number): ReactElement => {
    const r = rows[i], st = selectionState(i, selected, rows, m), hasKids = m.kids[i].length > 0;
    const d = Math.min(6, Math.max(1, r.level - base + 1));
    return <div role="none" key={r.id} className="pk-node" data-d={d}>
      <div role="treeitem" ref={el => { refs.current[i] = el; }} data-i={i} data-state={st} data-ring={(kb && i === focus) || undefined}
        className="pk-row" aria-level={Math.max(1, r.level)} aria-selected={st === 'full'} aria-description={st === 'some' ? 'Partly selected' : undefined}
        tabIndex={i === focus ? 0 : -1} onFocus={() => setFocus(i)}
        onPointerDown={e => { if (e.button !== 0 || e.pointerType === 'touch') return; drag.current = { start: i, base: selected, add: st !== 'full', moved: false }; }}
        onPointerEnter={e => { const dr = drag.current; if (!dr) return; if (e.buttons !== 1) { drag.current = null; return; } dr.moved = true; onChange(paintSelection(dr.base, rows, m, dr.start, i, dr.add)); }}
        onClick={() => { const dr = drag.current; if (dr?.moved) { drag.current = null; return; } toggle(i); }}>
        <span className="pk-title">{r.title}</span><span className="pk-pages">{r.pages}</span>
      </div>
      {hasKids && <div role="none" className="pk-kids">
        <Brace state={st} label={`Select all of “${r.title}”`} onClick={() => toggle(i)} />
        {m.kids[i].map(k => renderNode(k))}
      </div>}
    </div>;
  };
  const roots = rows.flatMap((_r, i) => m.parent[i] < 0 ? [i] : []);
  return <div className="tl-picker" onPointerDownCapture={() => setKb(false)}>
    <div role="tree" aria-label={label} aria-multiselectable className="pk-tree" onKeyDown={onKey}>
      {roots.map(i => renderNode(i))}
    </div>
  </div>;
}
