// Pure geometry for shapes, connectors and text pieces. No Pixi, so it is unit-testable.
import { pathPoint, tracePoints, type Point } from "./motion";

export type Outline = { pts: Point[]; fill: Point[]; extra?: Point[][]; open?: boolean }; // pts: stroke path (traced on draw); fill: closed region; extra: detail strokes drawn after
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const closed = (p: Point[], extra?: Point[][]): Outline => ({ pts: [...p, p[0]], fill: p, extra });
const quad = (p0: Point, c: Point, p1: Point, n = 10): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; });
const polar = (n: number, r: (i: number) => number, a: number, b: number, rot = -Math.PI / 2): Point[] =>
  Array.from({ length: n }, (_, i) => { const t = rot + i * 2 * Math.PI / n; return [Math.cos(t) * r(i) * a, Math.sin(t) * r(i) * b]; });
/** Scalloped closed outline (cloud, thought bubble): n circular bumps on a unit circle, ends of neighbours meeting. */
function scallop(n: number): Point[] {
  const R = .78, d = 2 * R * Math.sin(Math.PI / n), rho = d * .62, off = Math.acos(d / 2 / rho);
  return Array.from({ length: n }, (_, i) => {
    const t = -Math.PI / 2 + i * 2 * Math.PI / n, cx = Math.cos(t) * R, cy = Math.sin(t) * R;
    return arc(cx, cy, rho, rho, t - Math.PI / n - Math.PI / 2 + off, t + Math.PI / n + Math.PI / 2 - off, 8).slice(0, -1);
  }).flat();
}
/** Scale point sets so together they exactly fill [-a, a] x [-b, b]. */
function fitBox(sets: Point[][], a: number, b: number): Point[][] {
  const all = sets.flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return sets.map(s => s.map(([x, y]) => [((x - x0) / (x1 - x0 || 1) * 2 - 1) * a, ((y - y0) / (y1 - y0 || 1) * 2 - 1) * b] as Point));
}
const ring = (cx: number, cy: number, r: number, n = 24): Point[] => arc(cx, cy, r, r, -Math.PI / 2, Math.PI * 1.5, n);

export function shapeOutline(kind: string, w: number, h: number): Outline {
  const a = w / 2, b = h / 2, m = Math.min(a, b);
  switch (kind) {
    case "circle": return closed(arc(0, 0, a, b, 0, Math.PI * 2, 64).slice(0, -1));
    case "rect": case "bubble": return closed([[-a, -b], [a, -b], [a, b], [-a, b]]);
    case "diamond": return closed([[0, -b], [a, 0], [0, b], [-a, 0]]);
    case "pill": { const r = Math.min(a, b); return closed([...arc(a - r, 0, r, r, -Math.PI / 2, Math.PI / 2), ...arc(r - a, 0, r, r, Math.PI / 2, Math.PI * 1.5)]); }
    case "cylinder": { // top ellipse (back half), right side, bottom front arc, left side, then the front half of the top ellipse
      const ry = Math.min(b * .5, h * .12), top = -b + ry, bot = b - ry;
      const body = [...arc(0, top, a, ry, Math.PI, Math.PI * 2), ...arc(0, bot, a, ry, 0, Math.PI), [-a, top] as Point];
      return { pts: [...body, ...arc(0, top, a, ry, Math.PI, 0)], fill: body };
    }
    case "trapezoid": return closed([[-a, -b], [a, -b], [a * .6, b], [-a * .6, b]]);
    case "hexagon": return closed([[-a, 0], [-a / 2, -b], [a / 2, -b], [a, 0], [a / 2, b], [-a / 2, b]]);
    case "parallelogram": return closed([[-a + w * .2, -b], [a, -b], [a - w * .2, b], [-a, b]]);
    case "alu": return closed([[-a, -b], [a, -b * .5], [a, b * .5], [-a, b], [-a / 2, 0]]); // V notch on the wide side
    case "star": return closed(fitBox([polar(10, i => i % 2 ? .45 : 1, 1, 1)], a, b)[0]);
    case "octagon": return closed(polar(8, () => 1 / Math.cos(Math.PI / 8), a, b, -Math.PI / 2 + Math.PI / 8).map(([x, y]) => [Math.max(-a, Math.min(a, x)), Math.max(-b, Math.min(b, y))] as Point));
    case "gear": { const g = polar(48, i => [.74, 1, 1, .74][i % 4], a, b, -Math.PI / 2 - Math.PI / 48); return closed(g, [ring(0, 0, m * .26)]); }
    case "ring": return closed(arc(0, 0, a, b, -Math.PI / 2, Math.PI * 1.5, 64).slice(0, -1), [arc(0, 0, a * .55, b * .55, -Math.PI / 2, Math.PI * 1.5, 48)]);
    case "cloud": { const s = scallop(7).map(([x, y]) => [x, Math.min(y, .62)] as Point); return closed(fitBox([s], a, b)[0]); }
    case "thought": { // scalloped body in the top 78% plus two trailing dots bottom-left
      const [body, d1, d2] = fitBox([scallop(9).map(([x, y]) => [x * 1.25, y] as Point), ring(-.85, 1.05, .1, 12), ring(-1.15, 1.32, .06, 10)], a, b);
      return closed(body, [d1, d2]);
    }
    case "document": { const f = m * .55; return closed([[-a, -b], [a - f, -b], [a, -b + f], [a, b], [-a, b]], [[[a - f, -b], [a - f, -b + f], [a, -b + f]]]); }
    case "chip": { // die with pins on every side
      const da = a * .72, db = b * .72, pins: Point[][] = [];
      for (let i = 0; i < 4; i++) { const t = (i + .5) / 4 * 2 - 1; pins.push([[t * da * .8, -db], [t * da * .8, -b]], [[t * da * .8, db], [t * da * .8, b]], [[-da, t * db * .8], [-a, t * db * .8]], [[da, t * db * .8], [a, t * db * .8]]); }
      return closed([[-da, -db], [da, -db], [da, db], [-da, db]], [...pins, ring(-da * .62, -db * .62, m * .07, 12)]);
    }
    case "tag": return closed([[-a, 0], [-a + w * .22, -b], [a, -b], [a, b], [-a + w * .22, b]], [ring(-a + w * .2, 0, m * .12, 14)]);
    case "brace": { // horizontal curly brace opening upward, its tip pointing down
      const k = Math.min(h * .9, w * .12), y = -b + h * .45, P = (x: number, yy: number): Point => [x, yy];
      const pts = [...quad(P(-a, -b), P(-a, y), P(-a + k, y)), ...quad(P(-k, y), P(0, y), P(0, b)), ...quad(P(0, b), P(0, y), P(k, y)), ...quad(P(a - k, y), P(a, y), P(a, -b))];
      return { pts, fill: [], open: true };
    }
    case "check": return { pts: [[-a * .85, 0], [-a * .25, b * .75], [a * .85, -b * .8]], fill: [], open: true };
    case "cross": return { pts: [[-a * .75, -b * .75], [a * .75, b * .75]], fill: [], open: true, extra: [[[a * .75, -b * .75], [-a * .75, b * .75]]] };
    default: return closed([[0, -b], [a, b], [-a, b]]); // polygon / triangle
  }
}

/** Label box as fractions of the shape [width, height, dx, dy] (dx,dy: centre offset, fractions of size). */
export const LABEL_BOX: Record<string, [number, number, number, number]> = {
  rect: [.84, .84, 0, 0], circle: [.65, .65, 0, 0], polygon: [.4, .4, 0, .12], diamond: [.5, .5, 0, 0], pill: [.8, .8, 0, 0],
  cylinder: [.84, .6, 0, .1], trapezoid: [.7, .8, 0, 0], hexagon: [.7, .84, 0, 0], parallelogram: [.66, .84, 0, 0], alu: [.5, .6, .12, 0],
  triangle: [.4, .4, 0, .12], star: [.36, .3, 0, .06], octagon: [.7, .7, 0, 0], gear: [.36, .36, 0, 0], ring: [.4, .4, 0, 0], cloud: [.62, .5, 0, .08],
  thought: [.6, .46, .04, -.1], document: [.74, .72, -.04, .08], chip: [.58, .58, 0, 0], tag: [.66, .8, .1, 0], bubble: [.84, .8, 0, 0],
  brace: [.9, .3, 0, .78], check: [.9, .3, 0, .8], cross: [.9, .3, 0, .8],
};

export type Route = "straight" | "elbow" | "curve";
export const pathLength = (p: Point[]) => p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0);

/** Centre-to-centre connector path. elbow: orthogonal through the mid line; curve: quadratic bezier bowing 20% of the length. */
export function routePoints(a: Point, b: Point, route: Route = "straight"): Point[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  if (route === "elbow") {
    if (Math.abs(dx) > Math.abs(dy)) { const mx = (a[0] + b[0]) / 2; return [a, [mx, a[1]], [mx, b[1]], b]; }
    const my = (a[1] + b[1]) / 2; return [a, [a[0], my], [b[0], my], b];
  }
  if (route === "curve") {
    const c: Point = [(a[0] + b[0]) / 2 - dy / len * len * .4, (a[1] + b[1]) / 2 + dx / len * len * .4];
    return Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [(1 - t) ** 2 * a[0] + 2 * t * (1 - t) * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * c[1] + t * t * b[1]] as Point; });
  }
  return [a, b];
}

/** Direction (unit) of the path at its start (end=false) or end (end=true). */
export function pathDir(p: Point[], end: boolean): Point {
  const [a, b] = end ? [p[p.length - 2], p[p.length - 1]] : [p[0], p[1]];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

/** Cut `ta` off the start and `tb` off the end (by arc length). */
export function trimPath(p: Point[], ta: number, tb: number): Point[] {
  const total = pathLength(p), end = total - tb;
  if (end <= ta) return [];
  const at = (d: number) => pathPoint(p, d / total);
  const out: Point[] = [at(ta)];
  let d = 0;
  for (let i = 1; i < p.length - 1; i++) { d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); if (d > ta + 1e-6 && d < end - 1e-6) out.push(p[i]); }
  out.push(at(end));
  return out;
}

/** The first fraction p of the path, without zero-length duplicates. */
export function partialPath(p: Point[], k: number): Point[] {
  return tracePoints(p, k).filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-6);
}

/** Split a polyline into dash polylines. */
export function dashPolylines(p: Point[], on: number, off: number): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [p[0]], drawing = true, left = on;
  for (let i = 1; i < p.length; i++) {
    let [x, y] = p[i - 1];
    const [bx, by] = p[i], len = Math.hypot(bx - x, by - y);
    let rest = len;
    while (rest > left) {
      const k = left / rest; x += (bx - x) * k; y += (by - y) * k; rest -= left;
      if (drawing) { cur.push([x, y]); out.push(cur); cur = []; } else cur = [[x, y]];
      drawing = !drawing; left = drawing ? on : off;
    }
    left -= rest;
    if (drawing) cur.push([bx, by]);
  }
  if (drawing && cur.length > 1) out.push(cur);
  return out;
}

/** Counter text: thousands separators, fixed decimals. */
export function formatCount(v: number, decimals = 0, prefix = "", suffix = ""): string {
  return prefix + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
}
export const counterValue = (from: number, to: number, reveal: number) => from + (to - from) * Math.min(1, Math.max(0, reveal));

/** Word centres (px) for per-word animation; `text` is already wrapped with \n. Lines are centred on 0,0, or with
 * align left/right start/end at x = 0 when `edge` (explicitly placed text), else align inside a centred block. */
export function wordPlacements(text: string, size: number, measure: (s: string) => number, lineH = 1.15, align: "left" | "center" | "right" = "center", edge = false, space = size * .3) {
  const lines = text.split("\n").map(l => l.split(/\s+/).filter(Boolean));
  const widths = lines.map(words => words.map(measure));
  const lw = widths.map(ws => ws.reduce((a, b) => a + b, 0) + space * Math.max(0, ws.length - 1)), W = Math.max(0, ...lw);
  return lines.flatMap((words, li) => {
    const ws = widths[li];
    let x = align === "left" ? (edge ? 0 : -W / 2) : align === "right" ? (edge ? -lw[li] : W / 2 - lw[li]) : -lw[li] / 2;
    return words.map((word, i) => { const cx = x + ws[i] / 2; x += ws[i] + space; return { word, x: cx, y: (li - (lines.length - 1) / 2) * size * lineH }; });
  });
}

/** Round every corner of a closed polygon with a quadratic fillet (radius r, at most 45% of either adjacent edge). */
export function roundPoly(p: Point[], r: number, n = 6): Point[] {
  return p.flatMap((b, i) => {
    const a = p[(i + p.length - 1) % p.length], c = p[(i + 1) % p.length];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, lc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1, k = Math.min(r, la * .45, lc * .45);
    const p0: Point = [b[0] + (a[0] - b[0]) / la * k, b[1] + (a[1] - b[1]) / la * k], p2: Point = [b[0] + (c[0] - b[0]) / lc * k, b[1] + (c[1] - b[1]) / lc * k];
    return Array.from({ length: n + 1 }, (_, j) => { const t = j / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]] as Point; });
  });
}

/** Rotate a closed polygon (no repeated end point) to start where it crosses x = 0 at the top; returns it closed. */
export function startAtTop(p: Point[]): Point[] {
  let best = -1, at: Point = p[0], y0 = Infinity;
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length];
    if ((a[0] <= 0) === (b[0] <= 0) && a[0] !== 0) return;
    const k = a[0] === b[0] ? 0 : -a[0] / (b[0] - a[0]), y = a[1] + (b[1] - a[1]) * k;
    if (y < y0) { y0 = y; best = i; at = [0, y]; }
  });
  if (best < 0) return [...p, p[0]];
  const rest = [...p.slice(best + 1), ...p.slice(0, best + 1)];
  return [at, ...rest, at];
}

/** Display outline: rounded corners, starting top-centre so it can be traced symmetrically; optional speech-bubble tail. */
export function smoothOutline(kind: string, w: number, h: number, tail?: "left" | "right", maxR = Infinity, round = false): Outline & { sym: boolean } {
  const base = shapeOutline(kind, w, h);
  if (kind === "cylinder" || base.open) return { ...base, sym: false };
  if (kind === "bubble") tail ??= "left";
  let poly = base.fill;
  if (tail) { // insert a pointer into the longest bottom edge (rect, pill)
    const b = h / 2, tw = Math.min(w * .07, h * .22), x0 = (tail === "left" ? -1 : 1) * w * .22;
    let i = -1, best = 0;
    poly.forEach((a, j) => { const c = poly[(j + 1) % poly.length]; const l = Math.abs(a[0] - c[0]); if (Math.abs(a[1] - b) < 1e-6 && Math.abs(c[1] - b) < 1e-6 && l > best) { best = l; i = j; } });
    if (i >= 0) {
      const dir = Math.sign(poly[(i + 1) % poly.length][0] - poly[i][0]) || -1; // edge direction along x
      const tip: Point = [x0 + (tail === "left" ? -1 : 1) * tw * 1.6, b + h * .32];
      poly = [...poly.slice(0, i + 1), [x0 - dir * tw, b], tip, [x0 + dir * tw, b], ...poly.slice(i + 1)];
    }
  }
  const k = { rect: .16, bubble: .3, star: .03, gear: .015, tag: .1, chip: .1, document: .06 }[kind] ?? .1;
  const r = ["circle", "ring", "cloud", "thought"].includes(kind) ? 0 : Math.min(maxR, Math.min(w, h) * (round ? .5 : k)); // round: maxR is an explicit radius
  const fill = r ? roundPoly(poly, r) : poly;
  return { pts: startAtTop(fill), fill, extra: base.extra, sym: true };
}

/** The visible part of a closed outline traced from its start in both directions at once (one polyline, meets at p = 1). */
export function symmetricTrace(closed: Point[], p: number): Point[] {
  if (p >= 1) return closed;
  const fwd = partialPath(closed, p / 2), back = partialPath([...closed].reverse(), p / 2);
  return [...fwd.reverse(), ...back.slice(1)];
}

/** Clip a polygon below a horizontal surface (used by bottom-up liquid reveals). */
export function clipBelow(points: Point[], top: number): Point[] {
  return points.flatMap((a, i) => {
    const b = points[(i + 1) % points.length], inside = a[1] >= top, next = b[1] >= top;
    const out: Point[] = inside ? [a] : [];
    if (inside !== next) out.push([a[0] + (b[0] - a[0]) * (top - a[1]) / (b[1] - a[1]), top]);
    return out;
  });
}
