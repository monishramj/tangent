// Builders for the second-wave vocabulary: Stack/Queue/LinkedList (keyed snapshots), Graph (BFS/DFS state), numberline,
// matrix, distribution and background textures. Same contract as extras.ts: {node, draw}; draw returns half-extents (px).
import { Container, Graphics, Text } from "pixi.js";
import type { SceneObject } from "../dsl/schema";
import type { GraphSnap, Item, SeqSnap } from "../dsl/components";
import { NL_SPAN, density, domain, peak, type Dist } from "../dsl/stats";
import type { ObjState } from "./scene";
import { FONT, MONO, box, fitText, fmtNum, strokePath } from "./visuals";
import { clamp01, ease, staggerProgress, strokeW, window01, type Point } from "./motion";

type Cell = { cw?: number; ch?: number } | undefined;
type O<T extends string> = Extract<SceneObject, { type: T }>;
type Ext = [number, number];
type SetPoint = (id: string, x: number, y: number, r: number) => void;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function txt(node: Container, fill: string, bold = false, mono = false) {
  const t = new Text({ text: "", style: { fill, fontFamily: mono ? MONO : FONT, fontWeight: bold ? "bold" : "normal", fontSize: 24 } });
  t.anchor.set(.5); node.addChild(t); return t;
}
const set = (t: Text, s: string, size: number) => { if (t.text !== s) t.text = s; if (t.style.fontSize !== size) t.style.fontSize = size; };
/** Fit only when the string or box changes (fitting measures text). */
function fitOnce(t: Text, s: string, w: number, h: number, size: number) {
  const key = `${s}|${w | 0}|${h | 0}|${size | 0}`;
  if (t.label !== key) { fitText(t, s, w, h, size); t.label = key; }
}
function arrowHead(g: Graphics, tip: Point, dir: Point, k: number, color: string, alpha: number) {
  const [ux, uy] = dir, [x, y] = tip;
  g.poly([x, y, x - ux * k * 1.5 - uy * k * .75, y - uy * k * 1.5 + ux * k * .75, x - ux * k * 1.5 + uy * k * .75, y - uy * k * 1.5 - ux * k * .75]).fill({ color, alpha });
}

/** Stack (vertical, top up), Queue (front left), LinkedList (head -> nodes -> null). Items animate between snapshots by key. */
export function buildSeq(o: O<"Stack" | "Queue" | "LinkedList">, fg: string, bg: string, cell: () => Cell, point: SetPoint) {
  const node = new Container(), frame = new Graphics(), ink = new Graphics(), caption = txt(node, fg, true), ends = [txt(node, fg), txt(node, fg)];
  node.addChildAt(frame, 0); node.addChildAt(ink, 1);
  const pool = new Map<string, { g: Graphics; t: Text }>();
  const get = (k: string) => {
    let p = pool.get(k);
    if (!p) { p = { g: new Graphics(), t: txt(node, fg, true, true) }; node.addChildAt(p.g, 2); pool.set(k, p); }
    return p;
  };
  const kind = o.type, cap = Math.max(4, Number((o as { cap?: number }).cap) || 0, o.init.length);
  return { node, draw(s: ObjState, w: number, h: number): Ext {
    const c = cell(), [bw0, bh0] = box(o, w, h, w * .7, h * .6), bw = Math.min(bw0, c?.cw ?? Infinity), bh = Math.min(bh0, c?.ch ?? Infinity);
    const vertical = kind === "Stack", list = kind === "LinkedList";
    const S = vertical ? Math.min(bh / (cap + 1.2), bw / 3.2, h * .11) : Math.min(bw / (cap * (list ? 2.3 : 1.18) + (list ? 1.6 : .4)), bh * .45, h * .15);
    const iw = vertical ? S * 2.6 : list ? S * 1.4 : S, ih = vertical ? S * .86 : S, step = vertical ? S : list ? S * 2.3 : S * 1.18;
    const snap = s.snap as SeqSnap, from = (s.snapFrom as SeqSnap | undefined)?.items, k = from ? s.snapP ?? 1 : 1;
    const n = snap.items.length;
    // Slot centres (px, local): the stack grows up from a fixed floor; rows are centred on the capacity.
    const at = (i: number): Point => vertical ? [0, (cap * step) / 2 - (i + .5) * step] : [(i - (cap - 1) / 2) * step - (list ? S * .45 : 0), 0];
    const enter: Point = vertical ? [0, -step * 1.4] : list ? [0, S * 1.4] : [step * 1.2, 0];
    const leave: Point = vertical ? [0, -step * 1.4] : list ? [0, S * 1.4] : [-step * 1.2, 0];
    const keys = new Set([...(from ?? []).map(x => x.k), ...snap.items.map(x => x.k)]);
    const pos = new Map<string, { p: Point; a: number; v: Item["v"] }>();
    for (const key of keys) {
      const i0 = from ? from.findIndex(x => x.k === key) : -1, i1 = snap.items.findIndex(x => x.k === key);
      const p1 = i1 >= 0 ? at(i1) : null, p0 = from ? (i0 >= 0 ? at(i0) : null) : p1;
      const a0 = from ? (i0 >= 0 ? 1 : 0) : 1, a1 = i1 >= 0 ? 1 : 0;
      const A = p0 ?? [p1![0] + enter[0], p1![1] + enter[1]], B = p1 ?? [p0![0] + leave[0], p0![1] + leave[1]];
      pos.set(key, { p: [lerp(A[0], B[0], k), lerp(A[1], B[1], k)], a: lerp(a0, a1, k), v: (snap.items[i1] ?? from![i0]).v });
    }
    const reveal = s.reveal ?? 1, sw = strokeW(h);
    frame.clear();
    const fr = s.style === "stagger" ? window01(reveal, 0, .4) : 1;
    if (vertical) { // open-top container
      const x = iw / 2 + S * .22, y0 = -(cap * step) / 2 - S * .2, y1 = (cap * step) / 2 + S * .22;
      strokePath(frame, [[-x, y0], [-x, y1], [x, y1], [x, y0]], fr, fg, sw, .55, true);
    } else if (!list) for (let i = 0; i < cap; i++) { const [x, y] = at(i); frame.roundRect(x - iw / 2, y - ih / 2, iw, ih, S * .16).stroke({ width: sw * .7, color: fg, alpha: .16 * fr }); } // empty queue slots
    ink.clear();
    for (const p of pool.values()) { p.g.visible = false; p.t.visible = false; }
    let idx = 0;
    for (const [key, { p, a, v }] of pos) {
      const e = s.style === "stagger" ? staggerProgress(reveal, Math.min(idx++, 9), Math.max(n, 1), s.gap) : reveal;
      const alpha = a * e, hl = s.keyHl?.[key] ?? 0, { g, t } = get(key);
      if (alpha <= 0) continue;
      const lift = (1 - ease(e, "outExpo")) * S * .25, x = p[0], y = p[1] + lift, r = S * .16;
      g.visible = t.visible = true; g.alpha = t.alpha = alpha;
      g.clear().roundRect(x - iw / 2, y - ih / 2, iw, ih, r).fill({ color: bg }).roundRect(x - iw / 2, y - ih / 2, iw, ih, r)
        .fill({ color: fg, alpha: .07 + .85 * hl }).stroke({ width: sw, color: fg, alpha: .8, join: "round" });
      if (list) g.moveTo(x + iw / 2 - S * .42, y - ih / 2).lineTo(x + iw / 2 - S * .42, y + ih / 2).stroke({ width: sw, color: hl > .5 ? bg : fg, alpha: .5 })
        .circle(x + iw / 2 - S * .21, y, S * .07).fill({ color: hl > .5 ? bg : fg });
      fitOnce(t, String(v), (list ? iw - S * .5 : iw) * .82, ih * .7, S * .42);
      t.style.fill = hl > .5 ? bg : fg; t.position.set(list ? x - S * .2 : x, y);
      const i = snap.items.findIndex(q => q.k === key);
      if (i >= 0) point(`${o.id}.slot[${i}]`, s.x * w + x * s.scale, s.y * h + y * s.scale, Math.max(iw, ih) / 2 * s.scale);
    }
    if (list) { // pointers between consecutive nodes in the new order, plus head and null
      const items = snap.items.map(it => pos.get(it.k)!), la = .85 * window01(reveal, .3, 1);
      const pointer = (x0: number, x1: number, y: number, alpha: number) => {
        if (x1 - x0 < S * .25) return;
        ink.moveTo(x0, y).lineTo(x1 - sw * 2, y).stroke({ width: sw, color: fg, alpha: alpha * la, cap: "round" });
        arrowHead(ink, [x1, y], [1, 0], sw * 3, fg, alpha * la);
      };
      items.forEach((it, i) => { const nx = items[i + 1]; if (nx) pointer(it.p[0] + iw / 2 - S * .21, nx.p[0] - iw / 2 - S * .08, (it.p[1] + nx.p[1]) / 2, Math.min(it.a, nx.a)); });
      const first = items[0], last = items[items.length - 1], hx = (first?.p[0] ?? at(0)[0]) - iw / 2 - S * 1.1;
      set(ends[0], "head", S * .3); ends[0].position.set(hx - S * .1, 0); ends[0].alpha = la;
      if (first) pointer(hx + S * .45, first.p[0] - iw / 2 - S * .08, 0, first.a);
      set(ends[1], "null", S * .3); ends[1].alpha = la;
      const nx = (last ? last.p[0] + iw / 2 : hx + S * .45) + S * .95;
      ends[1].position.set(nx + S * .3, 0);
      if (last) pointer(last.p[0] + iw / 2 - S * .21, nx, 0, last.a);
    } else if (kind === "Queue") {
      const f = snap.items[0] && pos.get(snap.items[0].k), b = snap.items[n - 1] && pos.get(snap.items[n - 1].k);
      set(ends[0], "front", S * .26); set(ends[1], "back", S * .26);
      ends[0].visible = !!f; ends[1].visible = !!b && n > 1;
      if (f) ends[0].position.set(f.p[0], S * .85);
      if (b) ends[1].position.set(b.p[0], S * .85);
      ends.forEach(t => (t.alpha = .6 * window01(reveal, .5, 1)));
    } else {
      const top = snap.items[n - 1] && pos.get(snap.items[n - 1].k);
      set(ends[0], "top", S * .3); ends[0].visible = !!top; ends[1].visible = false;
      if (top) ends[0].position.set(iw / 2 + S * .9, top.p[1]);
      ends[0].alpha = .6 * window01(reveal, .5, 1);
    }
    const W = vertical ? iw / 2 + S * 1.4 : (cap * step) / 2 + (list ? S * 1.6 : S * .2), H = vertical ? (cap * step) / 2 + S * .3 : S * 1.1;
    set(caption, o.label ?? "", Math.max(12, h * .034)); caption.visible = !!o.label; caption.alpha = .7 * window01(reveal, 0, .3);
    caption.position.set(0, vertical ? -H - h * .045 : -H - h * .02);
    return [W, H];
  } };
}

/** Graph: nodes (given x/y in its box, else a circle), edges (arrowheads if directed, weight labels), BFS/DFS state from the snapshot. */
export function buildGraph(o: O<"Graph">, fg: string, bg: string, cell: () => Cell, point: SetPoint) {
  const node = new Container(), ink = new Graphics(), dots = new Graphics();
  node.addChild(ink, dots);
  const labels = o.nodes.map(() => txt(node, fg, true)), badges = o.nodes.map(() => txt(node, fg, true, true)), weights = o.edges.map(() => txt(node, fg));
  const frontier = txt(node, fg, false, true);
  const index = new Map(o.nodes.map((n, i) => [n.id, i]));
  const unit = o.nodes.map((n, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / o.nodes.length;
    return [n.x ?? .5 + .45 * Math.cos(a), n.y ?? .5 + .45 * Math.sin(a)] as Point;
  });
  const flag = (sn: GraphSnap | undefined, f: (g: GraphSnap) => boolean) => sn ? Number(f(sn)) : 0;
  return { node, draw(s: ObjState, w: number, h: number): Ext {
    const c = cell(), [bw0, bh0] = box(o, w, h, w * .6, h * .55);
    const bw = Math.min(bw0, c?.cw ? c.cw * .95 : Infinity), bh = Math.min(bh0, c?.ch ? c.ch * .8 : Infinity);
    const r = Math.min(h * .048, bw / 12, bh / 7), sw = strokeW(h), reveal = s.reveal ?? 1;
    const P = unit.map(([x, y]) => [(x - .5) * (bw - 2 * r), (y - .5) * (bh - 2 * r)] as Point);
    const to = s.snap as GraphSnap, from = s.snapFrom as GraphSnap | undefined, k = from ? s.snapP ?? 1 : 1;
    const mix = (f: (g: GraphSnap) => boolean) => lerp(flag(from ?? to, f), flag(to, f), k);
    const active = !!to.mode;
    const nodeP = (i: number) => s.style === "stagger" ? staggerProgress(reveal, i, o.nodes.length + 2, s.gap) : reveal;
    ink.clear(); dots.clear();
    o.edges.forEach((e, j) => {
      const i = index.get(e.from)!, m = index.get(e.to)!, [x1, y1] = P[i], [x2, y2] = P[m];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const tree = mix(g => g.tree.some(([a, b]) => (a === e.from && b === e.to) || (!o.directed && a === e.to && b === e.from)));
      const p = Math.min(nodeP(i), nodeP(m)), d = clamp01((p - .5) * 2);
      const a = (active ? .3 + .7 * tree : .75) * d, wd = sw * (1 + 1.2 * tree);
      const sx = x1 + ux * r, sy = y1 + uy * r, ex = x2 - ux * (r + (o.directed ? wd * 2.5 : 0)), ey = y2 - uy * (r + (o.directed ? wd * 2.5 : 0));
      if (d > 0) {
        ink.moveTo(sx, sy).lineTo(lerp(sx, ex, d), lerp(sy, ey, d)).stroke({ width: wd, color: fg, alpha: a, cap: "round" });
        if (o.directed && d >= 1) arrowHead(ink, [x2 - ux * r, y2 - uy * r], [ux, uy], wd * 2.2, fg, a);
      }
      const wl = weights[j];
      wl.visible = e.w !== undefined && d >= 1;
      if (wl.visible) {
        set(wl, fmtNum(e.w!), Math.max(11, r * .55));
        const mx = (x1 + x2) / 2 - uy * r * .55, my = (y1 + y2) / 2 + ux * r * .55;
        dots.roundRect(mx - wl.width / 2 - 4, my - wl.height / 2, wl.width + 8, wl.height, 4).fill({ color: bg });
        wl.position.set(mx, my); wl.alpha = .85;
      }
    });
    o.nodes.forEach((nd, i) => {
      const [x, y] = P[i], p = nodeP(i), e = ease(p, "outBack");
      const visited = mix(g => g.visited.includes(nd.id)), cur = mix(g => g.current === nd.id), fr = mix(g => g.frontier.includes(nd.id) && !g.visited.includes(nd.id));
      const hl = Math.max(visited, s.valHl?.[nd.id] ?? 0), rr = r * (.6 + .4 * e) * (1 + .14 * cur);
      if (p > 0) {
        dots.circle(x, y, rr).fill({ color: bg }).circle(x, y, rr).fill({ color: fg, alpha: .07 + .85 * hl })
          .stroke({ width: sw * (1 + fr), color: fg, alpha: .8 * Math.min(1, p * 3) });
        if (fr > 0) dots.circle(x, y, rr + sw * 3).stroke({ width: sw * .8, color: fg, alpha: .5 * fr });
        if (cur > 0) dots.circle(x, y, rr + sw * 4.5).stroke({ width: sw * 1.4, color: fg, alpha: cur });
      }
      const t = labels[i];
      fitOnce(t, nd.label ?? nd.id, r * 1.5, r * 1.3, r * .8);
      t.position.set(x, y); t.alpha = clamp01(p * 2); t.style.fill = hl > .5 ? bg : fg;
      const order = to.visited.indexOf(nd.id), b = badges[i];
      b.visible = active && order >= 0;
      if (b.visible) { set(b, String(order + 1), r * .5); b.position.set(x + r * 1.05, y - r * 1.05); b.alpha = .8 * (from && !from.visited.includes(nd.id) ? k : 1); }
      point(`${o.id}.val(${nd.id})`, s.x * w + x * s.scale, s.y * h + y * s.scale, r * s.scale);
    });
    frontier.visible = active;
    if (active) {
      const names = to.frontier.map(id => o.nodes[index.get(id)!].label ?? id);
      set(frontier, `${to.mode === "dfs" ? "stack" : "queue"}: ${names.length ? names.join(to.mode === "dfs" ? " → " : ", ") : "∅"}`, Math.max(12, h * .032));
      frontier.position.set(0, bh / 2 + h * .05); frontier.alpha = .75;
    }
    return [bw / 2, bh / 2 + (active ? h * .07 : 0)];
  } };
}

/** Numberline: axis with arrowheads, ticks and numbers. Values map onto the middle NL_SPAN of its width (see numberlineX). */
export function buildNumberline(o: O<"numberline">, fg: string) {
  const node = new Container(), g = new Graphics(), step = o.step ?? 1, n = Math.round((o.max - o.min) / step);
  node.addChild(g);
  const nums = Array.from({ length: n + 1 }, () => txt(node, fg, false, true));
  const every = Math.ceil((n + 1) / 12);
  return { node, draw(s: ObjState, w: number, h: number): Ext {
    const W = (o.width ?? .8) * w, span = W * NL_SPAN, sw = strokeW(h), p = s.reveal ?? 1, k = ease(p, "inOutSine");
    g.clear();
    g.moveTo(-W / 2 * k, 0).lineTo(W / 2 * k, 0).stroke({ width: sw, color: fg, alpha: .85, cap: "round" });
    if (k > .9) { arrowHead(g, [W / 2, 0], [1, 0], sw * 3, fg, .85); arrowHead(g, [-W / 2, 0], [-1, 0], sw * 3, fg, .85); }
    for (let i = 0; i <= n; i++) {
      const x = -span / 2 + span * i / n, a = window01(p, .3 + .5 * i / Math.max(1, n), .45 + .5 * i / Math.max(1, n)), big = i % every === 0;
      g.moveTo(x, -h * (big ? .018 : .01)).lineTo(x, h * (big ? .018 : .01)).stroke({ width: sw, color: fg, alpha: .7 * a });
      nums[i].visible = big;
      set(nums[i], fmtNum(o.min + i * step), h * .03); nums[i].position.set(x, h * .05); nums[i].alpha = .7 * a;
    }
    return [W / 2, h * .07];
  } };
}

/** Matrix in brackets; highlight row/col tints a band. */
export function buildMatrix(o: O<"matrix">, fg: string, cell: () => Cell) {
  const node = new Container(), g = new Graphics(), R = o.rows.length, C = o.rows[0].length;
  node.addChild(g);
  const cells = o.rows.flatMap((row, r) => row.map((v, c) => ({ r, c, v: String(v), t: txt(node, fg, false, true) })));
  const label = txt(node, fg, true);
  return { node, draw(s: ObjState, _w: number, h: number): Ext {
    const cl = cell(), S = Math.min((o.cell ?? .1) * h, cl?.cw ? cl.cw * .9 / C : Infinity, cl?.ch ? cl.ch * .8 / R : Infinity);
    const cw = S * Math.max(1, Math.min(1.8, Math.max(...cells.map(x => x.v.length)) * .38)), W = C * cw, H = R * S, sw = strokeW(h), p = s.reveal ?? 1;
    g.clear();
    const br = window01(p, 0, .35), lip = S * .18;
    strokePath(g, [[-W / 2 - lip * .2, -H / 2 - lip], [-W / 2 - lip, -H / 2 - lip], [-W / 2 - lip, H / 2 + lip], [-W / 2 - lip * .2, H / 2 + lip]], br, fg, sw, .85);
    strokePath(g, [[W / 2 + lip * .2, -H / 2 - lip], [W / 2 + lip, -H / 2 - lip], [W / 2 + lip, H / 2 + lip], [W / 2 + lip * .2, H / 2 + lip]], br, fg, sw, .85);
    if (s.hl > 0 && s.row !== undefined) g.roundRect(-W / 2, -H / 2 + s.row * S, W, S, S * .15).fill({ color: fg, alpha: .2 * s.hl });
    if (s.hl > 0 && s.col !== undefined) g.roundRect(-W / 2 + s.col * cw, -H / 2, cw, H, S * .15).fill({ color: fg, alpha: .2 * s.hl });
    cells.forEach((x, i) => {
      const a = s.style === "stagger" ? staggerProgress(window01(p, .25, 1), i, cells.length, s.gap) : p;
      const on = s.hl > .05 && (x.r === s.row || x.c === s.col);
      fitOnce(x.t, x.v, cw * .86, S * .7, S * .42);
      x.t.position.set(-W / 2 + (x.c + .5) * cw, -H / 2 + (x.r + .5) * S + (1 - ease(a)) * S * .2);
      x.t.alpha = a * (on || s.hl <= .05 ? 1 : .55 + .45 * (1 - s.hl)); x.t.style.fontWeight = on ? "bold" : "normal";
    });
    label.visible = !!o.label;
    if (o.label) { set(label, o.label, Math.max(12, h * .032)); label.position.set(0, -H / 2 - lip - h * .04); label.alpha = .7 * br; }
    return [W / 2 + lip, H / 2 + lip];
  } };
}

/** Distribution curve (or binomial bars) computed from its parameters. With a/b set it draws only the shaded area, swept in. */
export function buildDistribution(o: O<"distribution">, fg: string, cell: () => Cell) {
  const node = new Container(), g = new Graphics(), d = o as unknown as Dist, [x0, x1] = domain(d), top = peak(d);
  node.addChild(g);
  const shade = o.a !== undefined || o.b !== undefined;
  const ticks = shade ? [o.a, o.b].filter((v): v is number => v !== undefined)
    : d.kind === "normal" ? [-2, -1, 0, 1, 2].map(z => d.mean + z * d.sd) : d.kind === "uniform" ? [d.min, d.max] : Array.from({ length: d.n + 1 }, (_, k) => k).filter(k => k % Math.ceil((d.n + 1) / 11) === 0);
  const nums = ticks.map(() => txt(node, fg, false, true));
  return { node, draw(s: ObjState, w: number, h: number): Ext {
    const c = cell(), W = Math.min((o.width ?? .7) * w, c?.cw ?? Infinity), H = Math.min((o.height ?? .45) * h, c?.ch ? c.ch * .8 : Infinity);
    const X = (x: number) => -W / 2 + (x - x0) / (x1 - x0) * W, Y = (v: number) => H / 2 - v / top * H * .9, sw = strokeW(h), p = s.reveal ?? 1;
    g.clear();
    const lo = Math.max(x0, o.a ?? x0), hi = Math.min(x1, o.b ?? x1);
    if (d.kind === "binomial") {
      const bw = W / (d.n + 1) * .7;
      for (let k = 0; k <= d.n; k++) {
        const inside = k >= lo && k <= hi, a = shade ? (inside ? window01(p, (k - lo) / Math.max(1, hi - lo + 1), (k - lo + 1) / Math.max(1, hi - lo + 1)) : 0) : staggerProgress(p, k, d.n + 1, s.gap);
        if (a <= 0) continue;
        const v = density(d, k) * ease(a), x = X(k);
        g.rect(x - bw / 2, Y(v), bw, H / 2 - Y(v)).fill({ color: fg, alpha: shade ? .55 : .14 }).stroke({ width: sw, color: fg, alpha: shade ? 0 : .8 });
      }
    } else if (shade) {
      const end = lo + (hi - lo) * ease(p, "inOutSine"), pts: number[] = [X(lo), H / 2];
      for (let i = 0; i <= 80; i++) { const x = lo + (end - lo) * i / 80; pts.push(X(x), Y(density(d, x))); }
      pts.push(X(end), H / 2);
      if (end > lo) g.poly(pts).fill({ color: fg, alpha: .32 });
      for (const v of [o.a, o.b]) if (v !== undefined && v >= x0 && v <= x1 && (v === o.a || p >= 1)) g.moveTo(X(v), H / 2).lineTo(X(v), Y(density(d, v))).stroke({ width: sw, color: fg, alpha: .9 });
    } else {
      const pts: Point[] = Array.from({ length: 161 }, (_, i) => { const x = x0 + (x1 - x0) * i / 160; return [X(x), Y(density(d, x))]; });
      strokePath(g, pts, s.style === "draw" ? p : 1, fg, sw * 1.3, .95, true);
    }
    if (!shade) g.moveTo(-W / 2, H / 2).lineTo(W / 2, H / 2).stroke({ width: sw, color: fg, alpha: .5 });
    ticks.forEach((v, i) => {
      const t = nums[i];
      set(t, fmtNum(v), h * .028); t.position.set(X(v), H / 2 + h * .035); t.alpha = shade ? window01(p, .6, 1) : .6 * window01(p, .4, 1);
      if (!shade) g.moveTo(X(v), H / 2).lineTo(X(v), H / 2 + h * .01).stroke({ width: sw, color: fg, alpha: .5 });
    });
    return [W / 2, H / 2 + h * .06];
  } };
}

/** Subtle static background: drawn once per stage size, oversized so camera moves never show an edge. */
export function buildTexture(o: O<"texture">, fg: string) {
  const node = new Container(), g = new Graphics();
  node.addChild(g);
  let key = "";
  return { node, draw(_s: ObjState, w: number, h: number): Ext {
    if (key !== `${w}x${h}`) {
      key = `${w}x${h}`; g.clear();
      const W = w * .75, H = h * .75, gap = h * .045;
      if (o.pattern === "dots") { for (let x = -W; x <= W; x += gap) for (let y = -H; y <= H; y += gap) g.circle(x, y, Math.max(1, h * .0018)); g.fill({ color: fg, alpha: .1 }); }
      else if (o.pattern === "grid") { for (let x = -W; x <= W; x += gap * 1.6) g.moveTo(x, -H).lineTo(x, H); for (let y = -H; y <= H; y += gap * 1.6) g.moveTo(-W, y).lineTo(W, y); g.stroke({ width: 1, color: fg, alpha: .06 }); }
      else { for (let y = -H; y <= H; y += Math.max(3, h * .006)) g.moveTo(-W, y).lineTo(W, y); g.stroke({ width: 1, color: fg, alpha: .045 }); }
    }
    return [w / 2, h / 2];
  } };
}
