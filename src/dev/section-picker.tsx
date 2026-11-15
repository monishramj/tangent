import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import SourceView from '../home/SourceView';
import type { SectionRef } from '../home/api';
import { paintSelection, treeModel } from '../home/sectionTree';
import '../index.css';
import './section-picker.css';
import refDeep from '../../docs/ui-review/section-picker/ref-a-deep.png';
import refShallow from '../../docs/ui-review/section-picker/ref-a-shallow.png';
import refPartial from '../../docs/ui-review/section-picker/ref-a-partial.png';
import refKeyboard from '../../docs/ui-review/section-picker/ref-a-keyboard.png';
import refWidth from '../../docs/ui-review/section-picker/ref-a-width600.png';

type Row = SectionRef & { p0: number; p1: number };
function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ADJ = ['Coastal', 'Layered', 'Quiet', 'Brittle', 'Dormant', 'Lateral', 'Porous', 'Tidal', 'Recursive', 'Marginal', 'Elastic', 'Granular', 'Seasonal', 'Hollow', 'Oblique', 'Steady', 'Fractional', 'Local', 'Resonant', 'Sparse'];
const NOUN = ['sediment', 'harmonics', 'lattices', 'thresholds', 'gradients', 'reservoirs', 'currents', 'ledgers', 'membranes', 'oscillators', 'catchments', 'filters', 'transects', 'bearings', 'isotherms', 'canopies', 'relays', 'aquifers', 'moorings', 'eddies', 'sensors', 'baselines', 'cascades', 'pulses'];
const ROOTS = ['Foundations of tidal reckoning', 'Measuring a moving shoreline', 'Sediment and the slow archive', 'Waves, wind and local forcing', 'Estuaries as living filters', 'Instruments in the field', 'Models that fit the harbour', 'Storm surge and its warnings', 'Planning with uncertain coasts', 'Case studies from three bays', 'Where the method fails'];
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
function title(r: () => number) {
  const a = pick(r, ADJ), n = pick(r, NOUN), m = pick(r, NOUN);
  return pick(r, [`${a} ${n}`, `${n[0].toUpperCase()}${n.slice(1)} and ${m}`, `Reading ${n} in the field`, `Why ${n} drift`, `${a} ${n} revisited`, `A first look at ${n}`, `Counting ${n}`, `The ${a.toLowerCase()} ${n} problem`]);
}
function row(id: string, label: string, level: number, p0: number, p1: number): Row {
  return { id, title: label, level, p0, p1, anchors: p0 === p1 ? [{ page: p0 }] : [{ page: p0 }, { page: p1 }] };
}
function deep(): Row[] {
  const r = rng(7), rows: Row[] = []; let page = 1, id = 0;
  const grow = (level: number, label: string) => {
    const at = rows.length, p0 = page++; rows.push(row(`d${id++}`, label, level, p0, p0));
    const prob = [1, 1, .85, .55, .32][level] ?? 0;
    if (level < 5 && r() < prob) { const n = level === 1 ? 4 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2); for (let i = 0; i < n; i++) grow(level + 1, title(r)); }
    else page += Math.floor(r() * 3);
    rows[at].p1 = Math.max(rows[at].p0, page - 1);
    rows[at].anchors = rows[at].p0 === rows[at].p1 ? [{ page: rows[at].p0 }] : [{ page: rows[at].p0 }, { page: rows[at].p1 }];
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
    const p0 = page; rows.push(row(`s${id++}`, `Chapter ${i + 1}. ${t}`, 1, p0, p0)); const at = rows.length - 1;
    page++;
    subs.forEach((s, j) => { const a = page; page += 1 + ((i * 5 + j * 3) % 4); rows.push(row(`s${id++}`, `${i + 1}.${j + 1} ${s}`, 2, a, page - 1)); });
    rows[at].p1 = page - 1;
    rows[at].anchors = [{ page: rows[at].p0 }, { page: rows[at].p1 }];
  });
  return rows;
}
function seeded(rows: SectionRef[]) {
  const m = treeModel(rows);
  const roots = rows.flatMap((_r, i) => m.parent[i] < 0 ? [i] : []);
  const at = (k: number) => Math.min(rows.length - 1, k);
  let s = new Set<string>();
  for (const [root, n] of [[1, 1], [3, 2], [3, 3], [6, 1]] as const) s = paintSelection(s, rows, m, at((roots[root] ?? 0) + n), at((roots[root] ?? 0) + n), true);
  return [...s];
}
const BOOKS = { deep: deep(), shallow: shallow() };
const SEEDS = { deep: seeded(BOOKS.deep), shallow: seeded(BOOKS.shallow) };
const REFS = { deep: refDeep, shallow: refShallow, partial: refPartial, keyboard: refKeyboard, width600: refWidth };
type Shot = keyof typeof REFS;

function Page() {
  const shot = (new URLSearchParams(location.search).get('shot') || 'deep') as Shot;
  const fx = shot === 'shallow' || shot === 'keyboard' ? 'shallow' : 'deep';
  const rows = BOOKS[fx];
  const seed = shot === 'deep' || shot === 'shallow' ? [] : SEEDS[fx];
  const pages = Math.max(...rows.flatMap(r => r.anchors.map(a => a.page)));
  useEffect(() => {
    if (shot === 'deep' || shot === 'shallow') return;
    document.querySelector('.pk-row[data-state="some"], .pk-row[data-state="full"]')?.scrollIntoView({ block: 'start' });
  }, [shot]);
  return <div className="pk-cmp">
    <div className="pk-live"><SourceView key={shot} source={{ id: fx, name: fx === 'deep' ? 'Tidal reckoning.pdf' : 'Open statistics.pdf', pdfPath: `/${fx}.pdf`, pageCount: pages }}
      sections={rows} videos={[]} seedSelection={seed} onBack={() => {}} onOpenVideo={() => {}} onGenerate={() => {}} /></div>
    <figure className="pk-ref"><figcaption>Round 1 A · {shot}</figcaption><img src={REFS[shot] ?? refDeep} alt="Round 1 variant A reference" /></figure>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Page />);
