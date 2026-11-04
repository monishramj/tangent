// Retained Pixi nodes: fitting happens on resize, animation changes only drawing and transforms.
import { Assets, CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { SceneObject } from "../dsl/schema";
import type { ObjState } from "./scene";
import { fitLabel } from "./layout";
import { ease, staggerProgress, type Point } from "./motion";

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
export function fitText(t: Text, text: string, width: number, height: number, size: number) {
  const style = new TextStyle({ fontFamily: t.style.fontFamily, fontWeight: t.style.fontWeight, fontSize: size });
  const fit = fitLabel(text, size, Math.max(.01, width), Math.max(.01, height), (s, n) => {
    style.fontSize = n;
    return CanvasTextMetrics.measureText(s, style).width;
  });
  t.text = fit.text; t.style.fontSize = fit.size; t.style.lineHeight = fit.size * 1.15;
}
/** Partial polyline without allocating intermediate points each frame. */
export function strokePath(g: Graphics, pts: Point[], p: number, color: string | number, width = 3, alpha = 1, round = false) {
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
  let left = length * Math.max(0, Math.min(1, p));
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const a = pts[i-1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = len ? Math.min(1, left / len) : 1;
    g.lineTo(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); left -= len;
  }
  g.stroke(round ? { color, width, alpha, cap: "round", join: "round" } : { color, width, alpha });
}
/** Explicit width/height (stage fractions) apply only to objects with numeric x and y; otherwise the auto layout's default px size holds. */
export function box(o: Record<string, unknown>, w: number, h: number, dw: number, dh: number): [number, number] {
  const on = typeof o.x === "number" && typeof o.y === "number";
  return [on && typeof o.width === "number" ? o.width * w : dw, on && typeof o.height === "number" ? o.height * h : dh];
}
export const fmtNum = (v: number) => String(Math.round(v * 100) / 100);
export type Visual = Extract<SceneObject, { type: "flow" | "table" | "code" | "figure" | "bits" | "stack" | "chart" }>;
type Cell = { cw?: number; ch?: number } | undefined;
export function buildVisual(o: Visual, fg: string, refresh: () => void, bg = "#000", cellOf: () => Cell = () => undefined) {
  const node = new Container();
  const ink = new Graphics(); node.addChild(ink);
  let lastW = 0, lastH = 0;
  const label = (text: string, mono = false) => {
    const t = new Text({ text, style: { fill: fg, fontFamily: mono ? MONO : FONT, fontSize: 28 } });
    t.anchor.set(.5); node.addChild(t); return t;
  };
  const childProgress = (s: ObjState, i: number, count: number) =>
    s.style === "stagger" || s.style === "draw" ? staggerProgress(s.reveal ?? 1, i, count, s.gap) : s.reveal ?? 1;
  if (o.type === "figure") {
    const image = new Sprite(Texture.EMPTY), mask = new Graphics(), frame = new Graphics();
    image.anchor.set(.5); node.addChild(image, mask, frame); image.mask = mask;
    let ready = false;
    // Asset failures leave a visible frame and source label, rather than an unhandled rejection.
    const fallback = label("Loading figure…");
    Assets.load<Texture>(o.src).then(texture => {
      if (node.destroyed) return;
      image.texture = texture; ready = true; fallback.visible = false; refresh();
    }).catch(() => { if (!node.destroyed) { fallback.text = "Figure unavailable"; refresh(); } });
    return { node, draw(s: ObjState, w: number, h: number) {
      const [bw, bh] = box(o, w, h, w * .72, h * .48);
      mask.clear().rect(-bw/2, -bh/2, bw, bh).fill(0xffffff);
      frame.clear().rect(-bw/2, -bh/2, bw, bh).stroke({ color: fg, width: 1, alpha: .4 });
      if (!ready) return;
      const [x, y, right, bottom] = s.focus ?? [0, 0, 1, 1];
      const scale = Math.min(bw / ((right - x) * image.texture.width), bh / ((bottom - y) * image.texture.height));
      image.scale.set(scale);
      image.position.set((.5 - (x + right)/2) * image.texture.width * scale, (.5 - (y + bottom)/2) * image.texture.height * scale);
    } };
  }
  if (o.type === "flow") {
    const cells = o.nodes.map(n => ({ def: n, g: new Graphics(), t: label(n.label), x: 0, y: 0 }));
    cells.forEach(c => node.addChildAt(c.g, 1));
    const byId = new Map(cells.map(c => [c.def.id, c]));
    const edgeLabels = o.edges.map(e => label(e.label ?? ""));
    return { node, draw(s: ObjState, w: number, h: number) {
      const [fw, fh] = box(o, w, h, w * .8, h * .5);
      const bw = Math.min(fw / cells.length * .75, h * .2), bh = h * .13;
      const resize = w !== lastW || h !== lastH;
      cells.forEach((c, i) => {
        c.x = c.def.x === undefined ? (i - (cells.length-1)/2) * fw / cells.length : (c.def.x - .5) * fw;
        c.y = c.def.y === undefined ? 0 : (c.def.y - .5) * fh;
        const p = childProgress(s, Math.min(cells.length + o.edges.length - 1, i * 2), cells.length + o.edges.length);
        c.g.clear().roundRect(-bw/2, -bh/2, bw, bh, 8).fill({ color: bg }).roundRect(-bw/2, -bh/2, bw, bh, 8).fill({ color: fg, alpha: .035 + s.hl * .12 }).stroke({ color: fg, width: 2 });
        c.g.position.set(c.x, c.y + (1 - ease(p)) * 18); c.g.alpha = p;
        c.t.position.copyFrom(c.g.position); c.t.alpha = p;
        if (resize) fitText(c.t, c.def.label, bw * .84, bh * .75, h * .035);
      });
      ink.clear();
      o.edges.forEach((e, i) => {
        const a = byId.get(e.from)!, b = byId.get(e.to)!;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const trim = Math.min(bw / 2 / Math.max(.001, Math.abs(dx / len)), bh / 2 / Math.max(.001, Math.abs(dy / len)), len / 2);
        const x1 = a.x + dx/len * trim, y1 = a.y + dy/len * trim, x2 = b.x - dx/len * trim, y2 = b.y - dy/len * trim;
        const p = childProgress(s, Math.min(cells.length + o.edges.length - 1, i * 2 + 1), cells.length + o.edges.length);
        const x = x1 + (x2-x1)*p, y = y1 + (y2-y1)*p, angle = Math.atan2(dy, dx);
        ink.moveTo(x1, y1).lineTo(x, y).stroke({ color: fg, width: 2, alpha: .75 });
        if (p > 0) ink.moveTo(x - 10*Math.cos(angle-.5), y - 10*Math.sin(angle-.5)).lineTo(x,y).lineTo(x - 10*Math.cos(angle+.5), y - 10*Math.sin(angle+.5)).stroke({ color: fg, width: 2, alpha: p });
        edgeLabels[i].position.set((x1+x2)/2, (y1+y2)/2 - 20); edgeLabels[i].alpha = p;
        if (resize) fitText(edgeLabels[i], e.label ?? "", Math.max(20, len - 2*trim), 30, h*.025);
      });
      lastW = w; lastH = h;
    } };
  }
  if (o.type === "chart") {
    const n = o.values.length, line = o.kind === "line";
    const top = Math.max(...o.values, 0), max = o.max ?? (top || 1);
    const vals = o.values.map(() => label("", true)), cats = o.labels.map(l => label(l));
    return { node, draw(s: ObjState, w: number, h: number) {
      const cell = cellOf();
      let bw = (o.width ?? .7) * w, bh = (o.height ?? .45) * h; // charts always honor their size
      if (cell?.cw && cell.ch) { bw = Math.min(bw, cell.cw * .95); bh = Math.min(bh, cell.ch - h * .12); }
      bh = Math.max(h * .1, bh);
      const slot = bw / n, base = bh / 2, resize = w !== lastW || h !== lastH;
      const hc = s.col, pts: Point[] = o.values.map((v, i) => [-bw / 2 + (i + .5) * slot, base - Math.max(0, v) / max * bh]);
      ink.clear();
      ink.moveTo(-bw / 2, base).lineTo(bw / 2, base);
      if (line) ink.moveTo(-bw / 2, base).lineTo(-bw / 2, base - bh);
      ink.stroke({ color: fg, width: 2, alpha: .5 });
      if (line) {
        strokePath(ink, pts, s.reveal ?? 1, fg, 4, .9, true);
        pts.forEach(([x, y], i) => { if ((s.reveal ?? 1) >= i / Math.max(1, n - 1)) ink.circle(x, y, h * .008 + (hc === i ? h * .008 * s.hl : 0)).fill({ color: fg }); });
      }
      o.values.forEach((v, i) => {
        const p = line ? (s.reveal ?? 1) >= i / Math.max(1, n - 1) ? 1 : 0 : staggerProgress(s.reveal ?? 1, i, n, s.gap), [x, y] = pts[i];
        const bar = (base - y) * ease(p), on = hc === i ? s.hl : 0, dim = hc === undefined ? 1 : 1 - .6 * s.hl;
        if (!line) ink.roundRect(x - slot * .3, base - bar, slot * .6, bar, 4).fill({ color: fg, alpha: (.18 + .77 * on) * dim }).stroke({ color: fg, width: 2, alpha: .85 * dim });
        vals[i].position.set(x, (line ? y : base - bar) - h * .03); vals[i].alpha = p * dim;
        if (vals[i].text !== fmtNum(v)) vals[i].text = fmtNum(v);
        cats[i].position.set(x, base + h * .035); cats[i].alpha = (line ? 1 : p) * dim;
        if (resize) { fitText(cats[i], o.labels[i], slot * .9, h * .06, h * .028); fitText(vals[i], fmtNum(v), slot * .9, h * .04, h * .03); }
      });
      lastW = w; lastH = h;
      return [bw / 2, bh / 2 + h * .05] as [number, number];
    } };
  }
  // Tables, code, bits and stack share bounded cells, with one retained label per cell.
  const rows = o.type === "table" ? [o.headers, ...o.rows]
    : o.type === "code" ? o.lines.map(line => [line])
    : o.type === "bits" ? [[...o.bits]]
    : o.frames.map(f => [`${f.label}${f.items.length ? "\n" + f.items.join("\n") : ""}`]);
  const cells = rows.flatMap((row, r) => row.map((text, col) => ({ text, r, col, t: label(text, o.type === "code" || o.type === "bits"), fitted: text })));
  const bitLabel = o.type === "bits" && o.label ? label(o.label) : null;
  return { node, draw(s: ObjState, w: number, h: number) {
    const [bw, bh] = box(o, w, h, o.type === "stack" ? w * .4 : w * .78, Math.min(h * .48, rows.length * h * (o.type === "stack" ? .15 : .075)));
    const rh = bh / rows.length, cw = bw / rows[0].length;
    const resize = w !== lastW || h !== lastH;
    ink.clear();
    const range = s.range;
    const hr = s.row ?? (o.type === "table" ? o.highlightRow : undefined), hc = s.col ?? (o.type === "table" ? o.highlightCol : undefined);
    let offset = 0;
    const totalChars = o.type === "code" ? o.lines.join("").length : 1;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i], x = -bw/2 + (cell.col+.5)*cw, y = -bh/2 + (cell.r+.5)*rh;
      const p = childProgress(s, i, cells.length);
      const active = o.type === "table" ? cell.r === 0 || (hr !== undefined && cell.r === hr+1) || hc === cell.col
        : o.type === "code" && range ? cell.r >= range[0] && cell.r <= range[1] : false;
      if (o.type === "code") { // one editor-like panel: left-aligned lines, indentation kept, highlight bars only
        if (i === 0) ink.roundRect(-bw/2, -bh/2, bw, bh, 10).fill({ color: fg, alpha: .04 }).stroke({ color: fg, width: 1, alpha: .25 });
        if (active) ink.rect(-bw/2, y-rh/2, bw, rh).fill({ color: fg, alpha: .16 });
        cell.t.anchor.set(0, .5);
        cell.t.position.set(-bw/2 + Math.min(24, bw * .04), y);
        if (resize) {
          let size = Math.min(h * .032, rh * .7);
          const style = new TextStyle({ fontFamily: MONO, fontSize: size });
          while (size > 8 && CanvasTextMetrics.measureText(cell.text, style).width > bw * .92) style.fontSize = size *= .92;
          cell.t.style.fontSize = size; cell.t.style.whiteSpace = "pre"; cell.fitted = cell.text;
        }
      } else {
        ink.rect(x-cw/2, y-rh/2, cw, rh).fill({ color: fg, alpha: p * (active ? .22 : .035) }).stroke({ color: fg, width: 1, alpha: .3 * p });
        cell.t.position.set(x, y + (1-ease(p))*10); cell.t.alpha = p;
        if (resize) {
          fitText(cell.t, cell.text, cw * .88, rh * .8, h * (o.type === "bits" ? .04 : .03));
          cell.fitted = cell.t.text;
        }
      }
      if (o.type === "code") {
        const visible = Math.max(0, Math.floor((s.reveal ?? 1) * totalChars) - offset);
        // Preserve fitted wrapping while counting source characters (line breaks are not typed characters).
        const full = cell.fitted;
        const chars = Math.min(full.length, Math.floor(visible / Math.max(1, cell.text.length) * full.length));
        const text = full.slice(0, chars);
        if (cell.t.text !== text) cell.t.text = text;
        cell.t.alpha = 1; offset += cell.text.length;
      }
    }
    if (o.type === "bits" && o.groups) {
      let col = 0;
      for (const group of o.groups.slice(0,-1)) {
        col += group;
        const x = -bw/2 + col*cw;
        ink.moveTo(x, -bh/2-7).lineTo(x, bh/2+7).stroke({ color: fg, width: 3, alpha: s.reveal ?? 1 });
      }
    }
    if (bitLabel) { bitLabel.position.set(0, -bh/2 - h*.045); if (resize) fitText(bitLabel, o.type === "bits" ? o.label! : "", bw, h*.05, h*.03); }
    lastW = w; lastH = h;
  } };
}
