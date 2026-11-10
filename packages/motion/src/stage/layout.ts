// Pure, deterministic layout: where each object sits (stage fractions) and how text is wrapped/sized. No Pixi, no DOM:
// text width comes from an injected `measure`, so the renderer passes real font metrics and tests pass a fake.
export const MIN_FONT = 18;
const LH = 1.15; // line height factor
const PAD = 0.05; // outer margin, fraction of h
export type Measure = (s: string, size: number, bold: boolean) => number;
export type LItem = { id: string; type: string; text?: string; x?: unknown; y?: unknown; size?: number; maxW?: number; maxH?: number; weight?: string; variant?: string };
/** x,y: centre as stage fractions. auto: renderer-owned position (no explicit x/y). Text items also get wrapped text + fontSize (px). */
export type Placed = { x: number; y: number; auto: boolean; text?: string; fontSize?: number; /** visual cell size (px) */ cw?: number; ch?: number };

const SMALL = new Set(["shape", "Math", "icon", "emoji", "counter", "person"]);
const isNum = (v: unknown): v is number => typeof v === "number";

function wrap(text: string, size: number, bold: boolean, maxW: number, m: Measure): string[] {
  const parts = text.split("\n"); // explicit line breaks stay
  if (parts.length > 1) return parts.flatMap(p => wrap(p, size, bold, maxW, m));
  const lines: string[] = [];
  let cur = "";
  const push = (s: string) => { if (s) lines.push(s); };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (m(next, size, bold) <= maxW) { cur = next; continue; }
    push(cur); cur = "";
    let rest = word; // a single word wider than the box: hard-break by characters
    while (m(rest, size, bold) > maxW && rest.length > 1) {
      let k = rest.length - 1;
      while (k > 1 && m(rest.slice(0, k), size, bold) > maxW) k--;
      push(rest.slice(0, k)); rest = rest.slice(k);
    }
    cur = rest;
  }
  push(cur);
  return lines.length ? lines : [""];
}

/** Wrap to maxW, shrinking the font (never below MIN_FONT) until the block is at most maxH tall and no line is too wide. */
function fit(text: string, base: number, bold: boolean, maxW: number, maxH: number, m: Measure) {
  let size = Math.max(MIN_FONT, Math.floor(base));
  for (;;) {
    const lines = wrap(text, size, bold, maxW, m);
    const h = lines.length * size * LH;
    const wide = Math.max(...lines.map((l) => m(l, size, bold))) > maxW;
    if ((h <= maxH && !wide) || size <= MIN_FONT) return { text: lines.join("\n"), size, h };
    size = Math.max(MIN_FONT, Math.floor(size * 0.92));
  }
}

export function layoutScene(items: LItem[], w: number, h: number, m: Measure): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const isText = (i: LItem) => i.type === "text" || i.type === "KineticText";
  const isTitle = (i: LItem) => i.type === "KineticText";
  const flowed = items.filter((i) => isText(i) && !isNum(i.y));
  const visuals = items.filter((i) => !isText(i) && ["shape", "Math", "Array", "Tree", "flow", "table", "code", "figure", "bits", "stack", "icon", "emoji", "counter", "person", "chart", "gif", "numberline", "matrix", "distribution", "Stack", "Queue", "LinkedList", "Graph"].includes(i.type) && !isNum(i.y));
  const bold = (i: LItem) => isTitle(i) || i.weight === "bold";
  const stack = (i: LItem) => i.variant === "stack"; // one word per line
  const base = (i: LItem, f: number) => (i.size ? i.size : isTitle(i) ? 0.12 : 0.045) * h * f;
  const fitOne = (i: LItem, f: number) => {
    const text = stack(i) ? (i.text ?? "").split(/\s+/).join("\n") : i.text ?? "";
    return fit(text, base(i, f), bold(i), (i.maxW ?? 0.8) * w, (i.maxH ?? (stack(i) ? 0.5 : i.size ? 0.6 : isTitle(i) ? 0.3 : 0.18)) * h, m);
  };

  // explicit-y texts: fitted but outside the flow
  for (const i of items) if (isText(i) && isNum(i.y)) {
    const r = fitOne(i, 1);
    out.set(i.id, { x: isNum(i.x) ? i.x : 0.5, y: i.y, auto: false, text: r.text, fontSize: r.size });
  }

  // flowed texts: more than 3 => start smaller and pack tighter; shrink everything together until the stack fits
  const n = flowed.length;
  const gap = (n > 3 ? 0.008 : 0.02) * h;
  const room = h * (1 - 2 * PAD) - (visuals.length ? 0.25 * h : 0);
  let f = n > 3 ? Math.max(0.5, 3 / n + 0.2) : 1;
  let fits = flowed.map((i) => fitOne(i, f));
  const total = () => fits.reduce((s, r) => s + r.h, 0) + gap * Math.max(0, n - 1);
  while (total() > room && fits.some((r) => r.size > MIN_FONT)) {
    f *= 0.92;
    fits = flowed.map((i) => fitOne(i, f));
  }

  const place = (idx: number[], y0: number) => { // stack top-down from y0 (px); returns the bottom edge
    let y = y0;
    for (const k of idx) {
      const i = flowed[k], r = fits[k];
      out.set(i.id, { x: isNum(i.x) ? i.x : 0.5, y: (y + r.h / 2) / h, auto: true, text: r.text, fontSize: r.size });
      y += r.h + gap;
    }
    return y - gap;
  };
  const tIdx = flowed.flatMap((i, k) => (isTitle(i) ? [k] : [])), bIdx = flowed.flatMap((i, k) => (isTitle(i) ? [] : [k]));
  const titlesBottom = tIdx.length ? place(tIdx, PAD * h) : PAD * h;
  const bodyH = bIdx.reduce((s, k) => s + fits[k].h, 0) + gap * Math.max(0, bIdx.length - 1);
  const bodiesTop = bIdx.length ? h * (1 - PAD) - bodyH : h * (1 - PAD);
  if (bIdx.length) place(bIdx, bodiesTop);

  // visuals share the remaining band
  const top = titlesBottom + (tIdx.length ? gap : 0), bot = Math.max(top + 0.2 * h, bodiesTop - (bIdx.length ? gap : 0)); // never a negative band
  // Small visuals pack up to 3 per row; big components size themselves to the stage width, so each gets its own row.
  const rows: LItem[][] = [];
  for (const v of visuals) {
    const last = rows[rows.length - 1];
    if (SMALL.has(v.type) && last && SMALL.has(last[0].type) && last.length < 3) last.push(v);
    else rows.push([v]);
  }
  rows.forEach((row, r) => row.forEach((v, c) => out.set(v.id, {
    x: isNum(v.x) ? v.x : (c + 0.5) / row.length * 0.9 + 0.05,
    y: (top + ((r + 0.5) * (bot - top)) / rows.length) / h, auto: true,
    cw: 0.9 * w / row.length, ch: (bot - top) / rows.length,
  })));
  return out;
}

/** Labels are bounded by their shape; unlike page text they may shrink below MIN_FONT. */
export function fitLabel(text: string, base: number, width: number, height: number, m: Measure) {
  let size = Math.max(.01, base);
  const words = text.split(/\s+/).filter(Boolean);
  for (;;) {
    const lines = text.split("\n").flatMap(line => wrap(line, size, false, width, m));
    const h = lines.length * size * LH;
    const whole = size < base * .5 || words.every(w => m(w, size, false) <= width); // shrink before breaking a word, down to half size
    if (whole && h <= height && lines.every(line => m(line, size, false) <= width)) return { text: lines.join("\n"), size, h };
    size *= .85;
  }
}
