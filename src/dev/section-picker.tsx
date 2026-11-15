import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../home/views.css';
import './section-picker.css';

// Static mockups for plan step 8. Nothing here touches the sidecar, the app state or any PDF.
type Row = { id: string; title: string; level: number; p0: number; p1: number };
type Variant = 'curl' | 'pinch' | 'elbow';
type State = 'none' | 'some' | 'full';

// ---- fixtures ----
function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const ADJ = ['Coastal', 'Layered', 'Quiet', 'Brittle', 'Dormant', 'Lateral', 'Porous', 'Tidal', 'Recursive', 'Marginal', 'Elastic', 'Granular', 'Seasonal', 'Hollow', 'Oblique', 'Steady', 'Fractional', 'Local', 'Resonant', 'Sparse'];
const NOUN = ['sediment', 'harmonics', 'lattices', 'thresholds', 'gradients', 'reservoirs', 'currents', 'ledgers', 'membranes', 'oscillators', 'catchments', 'filters', 'transects', 'bearings', 'isotherms', 'canopies', 'relays', 'aquifers', 'moorings', 'eddies', 'sensors', 'baselines', 'cascades', 'pulses'];
const ROOTS = ['Foundations of tidal reckoning', 'Measuring a moving shoreline', 'Sediment and the slow archive', 'Waves, wind and local forcing', 'Estuaries as living filters', 'Instruments in the field', 'Models that fit the harbour', 'Storm surge and its warnings', 'Planning with uncertain coasts', 'Case studies from three bays', 'Where the method fails'];
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
function title(r: () => number) {
  const a = pick(r, ADJ), n = pick(r, NOUN), m = pick(r, NOUN);
  return pick(r, [`${a} ${n}`, `${n[0].toUpperCase()}${n.slice(1)} and ${m}`, `Reading ${n} in the field`, `Why ${n} drift`, `${a} ${n} revisited`, `A first look at ${n}`, `Counting ${n}`, `The ${a.toLowerCase()} ${n} problem`]);
}
function deep(): Row[] {
  const r = rng(7), rows: Row[] = []; let page = 1, id = 0;
  const grow = (level: number, label: string) => {
    const at = rows.length, p0 = page++; rows.push({ id: `d${id++}`, title: label, level, p0, p1: p0 });
    const prob = [1, 1, .85, .55, .32][level] ?? 0;
    if (level < 5 && r() < prob) { const n = level === 1 ? 4 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2); for (let i = 0; i < n; i++) grow(level + 1, title(r)); }
    else page += Math.floor(r() * 3);
    rows[at].p1 = Math.max(rows[at].p0, page - 1);
  };
  ROOTS.forEach((t, i) => grow(1, `${i + 1}. ${t}`));
  return rows;
}
function shallow(): Row[] {
  const book: [string, string[]][] = [
    ['Describing data', ['Types of variables', 'Histograms and boxplots', 'Mean, median and spread', 'Standardizing scores']],
    ['Probability', ['Sample spaces and events', 'Conditional probability', 'Bayes’ rule', 'Independence', 'Counting rules']],
    ['Random variables', ['Discrete distributions', 'Expectation and variance', 'The binomial family', 'The Poisson family', 'Continuous distributions', 'The normal curve']],
    ['Joint distributions', ['Joint and marginal mass functions', 'Covariance and correlation', 'Conditional distributions', 'Sums of random variables']],
    ['Sampling distributions', ['The sample mean', 'The central limit theorem', 'Chi-square and t']],
    ['Confidence intervals', ['Estimating a mean', 'Estimating a proportion', 'Choosing a sample size', 'What a 95% interval means']],
    ['Hypothesis tests', ['The logic of a test', 'One-sample t tests', 'Two-sample comparisons', 'Power and error rates', 'P-values in practice']],
    ['Regression', ['Fitting a line', 'Residuals and diagnostics', 'Inference for the slope', 'Multiple predictors']],
  ];
  const rows: Row[] = []; let page = 3, id = 0;
  book.forEach(([t, subs], i) => {
    const p0 = page; rows.push({ id: `s${id++}`, title: `Chapter ${i + 1}. ${t}`, level: 1, p0, p1: p0 }); const at = rows.length - 1;
    page++;
    subs.forEach((s, j) => { const a = page; page += 1 + ((i * 5 + j * 3) % 4); rows.push({ id: `s${id++}`, title: `${i + 1}.${j + 1} ${s}`, level: 2, p0: a, p1: page - 1 }); });
    rows[at].p1 = page - 1;
  });
  return rows;
}
const FIXTURES = { deep: deep(), shallow: shallow() };
const pages = (r: Row) => r.p0 === r.p1 ? `p. ${r.p0}` : `pp. ${r.p0}-${r.p1}`;

// ---- tree model: rows are a flat pre-order list; a subtree is the contiguous slice [i, end[i]] ----
function model(rows: Row[]) {
  const end = rows.map((_, i) => { let j = i; while (j + 1 < rows.length && rows[j + 1].level > rows[i].level) j++; return j; });
  const parent = rows.map((_, i) => { for (let j = i - 1; j >= 0; j--) if (rows[j].level < rows[i].level) return j; return -1; });
  const kids = rows.map((_, i) => rows.flatMap((_c, j) => j > i && j <= end[i] && parent[j] === i ? [j] : []));
  return { end, parent, kids };
}
type Model = ReturnType<typeof model>;
// Parent selected iff every child is; keeps "some" derivable from the set alone.
function normalize(sel: Set<string>, rows: Row[], m: Model) {
  for (let i = rows.length - 1; i >= 0; i--) if (m.kids[i].length) { if (m.kids[i].every(k => sel.has(rows[k].id))) sel.add(rows[i].id); else sel.delete(rows[i].id); }
  return sel;
}
function paint(base: Set<string>, rows: Row[], m: Model, a: number, b: number, add: boolean) {
  const lo = Math.min(a, b), hi = Math.max(a, b); let top = hi;
  for (let i = lo; i <= hi; i++) top = Math.max(top, m.end[i]);
  const next = new Set(base);
  for (let i = lo; i <= top; i++) add ? next.add(rows[i].id) : next.delete(rows[i].id);
  return normalize(next, rows, m);
}
function stateOf(i: number, sel: Set<string>, rows: Row[], m: Model): State {
  if (sel.has(rows[i].id)) return 'full';
  for (let j = i + 1; j <= m.end[i]; j++) if (sel.has(rows[j].id)) return 'some';
  return 'none';
}
const partial = (rows: Row[], m: Model) => {
  const roots = rows.flatMap((r, i) => r.level === 1 ? [i] : []), at = (k: number) => Math.min(rows.length - 1, k);
  let s = new Set<string>();
  for (const [root, n] of [[1, 1], [3, 2], [3, 3], [6, 1]] as const) { const i = at((roots[root] ?? 0) + n); s = paint(s, rows, m, i, i, true); }
  return s;
};

// ---- picker ----
// Curly-brace flair, all drawn with the hairline stroke of the tree lines (var(--sw), colour var(--lc)).
const Tip = ({ onClick, label }: { onClick: () => void; label: string }) =>
  <button type="button" tabIndex={-1} aria-hidden className="pk-tip" title={label} onClick={onClick}><svg viewBox="0 0 16 12"><path d="M7.5 12V8C7.5 3.6 10 1.3 14.5 1" /></svg></button>;
const Pinch = ({ onClick, label }: { onClick: () => void; label: string }) =>
  <button type="button" tabIndex={-1} aria-hidden className="pk-pinch" title={label} onClick={onClick}><svg viewBox="0 0 14 22"><path d="M7.5 0C7.5 7 6 10 1.5 11 6 12 7.5 15 7.5 22" /></svg></button>;
// Elbow: the connector is a short brace curl, with a tiny flick at its end. Last child bends down-to-right, others branch off the trunk.
const Elbow = ({ last }: { last: boolean }) =>
  <svg className="pk-curl" viewBox="0 0 18 16">{last ? <path d="M8.5 0C8.5 5.5 10 8 14 8H15.6C16.6 8 17.2 7.3 17.4 6.2" /> : <path d="M8.5 16C8.5 10.5 10 8 14 8H15.6C16.6 8 17.2 7.3 17.4 6.2" />}</svg>;

function Picker({ rows, variant, initial, label }: { rows: Row[]; variant: Variant; initial: boolean; label: string }) {
  const m = useMemo(() => model(rows), [rows]);
  const [sel, setSel] = useState<Set<string>>(() => initial ? partial(rows, m) : new Set());
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const drag = useRef<{ start: number; base: Set<string>; add: boolean; moved: boolean } | null>(null);
  const kbd = useRef<{ anchor: number; base: Set<string> } | null>(null);
  const wantFocus = useRef(false);
  const [kb, setKb] = useState(false); // ring only after keyboard use; synthetic key events don't always trip :focus-visible
  useEffect(() => { if (wantFocus.current) { wantFocus.current = false; refs.current[focus]?.focus(); refs.current[focus]?.scrollIntoView({ block: 'nearest' }); } }, [focus]);
  useEffect(() => { const stop = () => { drag.current = null; }; window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); }; }, []);
  const toggle = (i: number) => setSel(s => paint(s, rows, m, i, i, stateOf(i, s, rows, m) !== 'full'));
  const top = rows.reduce((n, r, i) => n + (sel.has(r.id) && !(m.parent[i] >= 0 && sel.has(rows[m.parent[i]].id)) ? 1 : 0), 0);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Number((e.target as HTMLElement).dataset.i); if (Number.isNaN(i)) return;
    setKb(true);
    const go = (to: number) => {
      to = Math.max(0, Math.min(rows.length - 1, to));
      if (e.shiftKey) { const k = kbd.current ??= { anchor: i, base: sel }; setSel(paint(k.base, rows, m, k.anchor, to, true)); } else kbd.current = null;
      wantFocus.current = true; setFocus(to); e.preventDefault();
    };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'ArrowRight' && m.kids[i].length) go(i + 1);
    else if (e.key === 'ArrowLeft' && m.parent[i] >= 0) go(m.parent[i]);
    else if (e.key === ' ' || e.key === 'Enter') { kbd.current = null; toggle(i); e.preventDefault(); }
  };
  const renderNode = (i: number, last: boolean): ReactElement => {
    const r = rows[i], st = stateOf(i, sel, rows, m), d = Math.min(r.level, 6), hasKids = m.kids[i].length > 0;
    return <div role="none" key={r.id} className={`pk-node${last ? ' pk-last' : ''}`} data-d={d}>
      {m.parent[i] >= 0 && <button type="button" tabIndex={-1} aria-hidden className="pk-trunk" title="Select the whole section" onClick={() => toggle(m.parent[i])}>{variant === 'elbow' && <Elbow last={last} />}</button>}
      <div role="treeitem" ref={el => { refs.current[i] = el; }} data-i={i} data-state={st} data-ring={(kb && i === focus) || undefined} className="pk-row" aria-level={r.level} aria-selected={st === 'full'} aria-description={st === 'some' ? 'Partly selected' : undefined}
        tabIndex={i === focus ? 0 : -1} onFocus={() => setFocus(i)}
        onPointerDown={e => { if (e.button !== 0 || e.pointerType === 'touch') return; drag.current = { start: i, base: sel, add: st !== 'full', moved: false }; }}
        onPointerEnter={e => { const dr = drag.current; if (!dr) return; if (e.buttons !== 1) { drag.current = null; return; } dr.moved = true; setSel(paint(dr.base, rows, m, dr.start, i, dr.add)); }}
        onClick={() => { const dr = drag.current; if (dr?.moved) { drag.current = null; return; } toggle(i); }}>
        <span className="pk-title">{r.title}</span><span className="pk-pages">{pages(r)}</span>
      </div>
      {hasKids && <div role="none" className="pk-kids" data-state={st}>
        {variant === 'curl' && <Tip label="Select the whole section" onClick={() => toggle(i)} />}
        {variant === 'pinch' && m.end[i] - i >= 5 && <Pinch label="Select the whole section" onClick={() => toggle(i)} />}
        {m.kids[i].map((k, n, all) => renderNode(k, n === all.length - 1))}
      </div>}
    </div>;
  };
  const roots = rows.flatMap((r, i) => r.level === 1 ? [i] : []);
  const all = sel.size >= rows.length;
  return <div className="pk-frame">
    <div className="pk-head"><span>Choose sections<small>{top ? `${top} selected` : 'Click or drag to select'}</small></span>
      <span className="pk-head-r"><button className="tl-text-button" onClick={() => setSel(all ? new Set() : new Set(rows.map(r => r.id)))}>{all ? 'Clear' : 'Select all'}</button><button className="tl-primary" disabled={!top}>Make video</button></span></div>
    <div className="pk-scroll"><div role="tree" aria-label={label} aria-multiselectable onPointerDownCapture={() => setKb(false)} className={`pk-tree pk-v-${variant}`} onKeyDown={onKey}>
      {roots.map((i, n) => renderNode(i, n === roots.length - 1))}
    </div></div>
  </div>;
}

function Page() {
  const q = new URLSearchParams(location.search);
  const [fx, setFx] = useState<keyof typeof FIXTURES>(q.get('fx') === 'shallow' ? 'shallow' : 'deep');
  const [seed, setSeed] = useState(q.get('sel') === 'partial');
  const [run, setRun] = useState(0);
  const only = q.get('v'), w = Number(q.get('w')) || 0;
  const rows = FIXTURES[fx];
  const cols: [Variant, string, string, string][] = [['curl', '1', 'Curl tip', 'The trunk ends in a small curl under its parent'], ['pinch', '2', 'Pinch', 'A brace point at the trunk’s midpoint'], ['elbow', '3', 'Curl elbows', 'Every connector is a tiny brace curl']];
  return <div className="tl-library pk-page"><div className="tl-wrap tl-wide">
    <div className="pk-bar"><h1>Section picker<small>Three static variants of thin tree lines with brace flair. {rows.length} rows. Try click, drag, arrows, Space, Shift+arrows.</small></h1>
      <div className="pk-bar-tools"><div className="tl-tabs" role="tablist" aria-label="Fixture">{(['deep', 'shallow'] as const).map(k => <button key={k} role="tab" aria-selected={fx === k} onClick={() => { setFx(k); setRun(n => n + 1); }}>{k === 'deep' ? 'Deep outline' : 'Shallow book'}</button>)}</div>
        <button className="tl-quiet" onClick={() => { setSeed(s => !s); setRun(n => n + 1); }}>{seed ? 'Start empty' : 'Start with a selection'}</button></div></div>
    <div className="pk-cols" style={w || only ? { maxWidth: w || 720, margin: '0 auto', gridTemplateColumns: 'minmax(0,1fr)' } : undefined}>
      {cols.filter(([, k]) => !only || only === k).map(([v, k, name, note]) => <div className="pk-col" key={`${v}${fx}${run}`}>
        <div className="pk-cap"><b>{k} · {name}</b><span>{note}</span></div>
        <Picker rows={rows} variant={v} initial={seed} label={`${name} section picker`} />
      </div>)}
    </div></div></div>;
}
createRoot(document.getElementById('root')!).render(<Page />);
