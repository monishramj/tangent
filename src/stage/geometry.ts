// Pure geometry for shapes, connectors and text pieces. No Pixi, so it is unit-testable.
import { pathPoint, tracePoints, type Point } from "./motion";

export type Outline = { pts: Point[]; fill: Point[] }; // pts: stroke path (traced on draw); fill: closed region
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 16): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const closed = (p: Point[]): Outline => ({ pts: [...p, p[0]], fill: p });

export function shapeOutline(kind: string, w: number, h: number): Outline {
  const a = w / 2, b = h / 2;
  switch (kind) {
    case "circle": return closed(arc(0, 0, a, b, 0, Math.PI * 2, 64).slice(0, -1));
    case "rect": return closed([[-a, -b], [a, -b], [a, b], [-a, b]]);
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
    default: return closed([[0, -b], [a, b], [-a, b]]); // polygon = triangle
  }
}

/** Label box as fractions of the shape [width, height, dx, dy] (dx,dy: centre offset, fractions of size). */
export const LABEL_BOX: Record<string, [number, number, number, number]> = {
  rect: [.84, .84, 0, 0], circle: [.65, .65, 0, 0], polygon: [.4, .4, 0, .12], diamond: [.5, .5, 0, 0], pill: [.8, .8, 0, 0],
  cylinder: [.84, .6, 0, .1], trapezoid: [.7, .8, 0, 0], hexagon: [.7, .84, 0, 0], parallelogram: [.66, .84, 0, 0], alu: [.5, .6, .12, 0],
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

/** Word centres (px, block centred on 0,0) for per-word animation; `text` is already wrapped with \n. */
export function wordPlacements(text: string, size: number, measure: (s: string) => number, lineH = 1.15) {
  const lines = text.split("\n").map(l => l.split(/\s+/).filter(Boolean)), space = size * .3;
  return lines.flatMap((words, li) => {
    const ws = words.map(measure), total = ws.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
    let x = -total / 2;
    return words.map((word, i) => { const cx = x + ws[i] / 2; x += ws[i] + space; return { word, x: cx, y: (li - (lines.length - 1) / 2) * size * lineH }; });
  });
}
