// Pixi v8 drawing of SceneState. Display objects are built once per scene object and mutated per frame; no clocks here.
import { CanvasTextMetrics, Container, Graphics, Text, TextStyle, type Application } from "pixi.js";
import katex from "katex";
import type { Scene, SceneObject, TreeNode } from "../dsl/schema";
import { fromLevel } from "../dsl/trees/shared";
import type { Annotation } from "../annotations";
import { annotationShapes, type Pt } from "./annotate";
import { DEFAULT_POS, type ObjState, type SceneState } from "./scene";
import { layoutScene, type Placed } from "./layout";
import { buildVisual, fitText } from "./visuals";
import { buildCounter, buildEmoji, buildGif, buildIcon, buildPerson } from "./extras";
import { buildDistribution, buildGraph, buildMatrix, buildNumberline, buildSeq, buildTexture } from "./vocab";
import { LABEL_BOX, dashPolylines, partialPath, pathDir, pathLength, routePoints, smoothOutline, symmetricTrace, trimPath, wordPlacements } from "./geometry";
import { ease, pathPoint, staggerProgress, strokeW, window01, type Point } from "./motion";

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
type Drawer = (s: ObjState, w: number, h: number, all: Map<string, ObjState>) => void | [number, number]; // optional return: drawn half-extents (px, unscaled)

export class SceneRenderer {
  private root = new Container();
  private bgLayer = new Container(); // textures: under everything, connectors included
  private draws = new Map<string, { node: Container | HTMLElement; draw: Drawer }>();
  private reaction: Text;
  private fg: string;
  private bg: string;
  private pts = new Map<string, Pt>(); // laid-out target positions (px), refreshed every draw: annotations read these
  private anns: Annotation[] = [];
  private annG = new Graphics();
  private annTexts: Text[] = [];
  private lay = new Map<string, Placed>(); // layout pass result; recomputed only when the stage size changes
  private laidFor = "";
  private lastState?: SceneState;
  private placedObjects = new Map<string, ObjState>();
  private rings = new Graphics();
  private ext = new Map<string, [number, number]>(); // drawn half-extents (px) so arrows can stop at box edges
  private measure = (s: string, size: number, bold: boolean) => CanvasTextMetrics.measureText(s, new TextStyle({ fontSize: size, fontWeight: bold ? "bold" : "normal", fontFamily: FONT, letterSpacing: bold ? -size * 0.03 : 0 })).width;

  constructor(private app: Application, private scene: Scene, private mathLayer: HTMLElement, css: (n: string) => string) {
    this.fg = css("--fg");
    this.bg = css("--bg");
    app.stage.addChild(this.root);
    this.root.addChild(this.bgLayer);
    for (const o of scene.objects) {
      const d = this.build(o);
      if (d) this.draws.set(o.id, d);
    }
    this.root.addChild(this.rings);
    this.reaction = this.text("", 64, "bold");
    this.reaction.anchor.set(0.5);
    this.root.addChild(this.reaction);
    app.stage.addChild(this.annG); // above root so transitions don't move marks
  }

  /** Replace the tutor's marks; they paint on the next draw(). [] clears. */
  setAnnotations(a: Annotation[]) { this.anns = a; }

  private text(s: string, size: number, weight: "normal" | "bold" = "normal", mono = false) {
    return new Text({ text: s, style: { fill: this.fg, fontSize: size, fontWeight: weight, fontFamily: mono ? MONO : FONT, letterSpacing: weight === "bold" ? -size * 0.03 : 0 } });
  }

  private build(o: SceneObject): { node: Container | HTMLElement; draw: Drawer } | null {
    const c = new Container();
    const place = (s: ObjState, w: number, h: number, node = c) => {
      node.visible = s.visible;
      node.alpha = s.opacity;
      node.position.set(s.x * w, s.y * h);
      node.scale.set(s.scale);
      node.rotation = s.rotation ?? 0;
      node.tint = s.color ?? 0xffffff;
    };
    switch (o.type) {
      case "text":
      case "KineticText": {
        const kinetic = o.type === "KineticText", plain = o.type === "text" ? o : undefined;
        const variant = o.type === "KineticText" ? o.variant : undefined, split = variant === "words" || variant === "stack";
        const bold = kinetic || plain?.weight === "bold";
        const t = this.text(o.text, kinetic ? 120 : 30, bold ? "bold" : "normal", plain?.mono);
        if (plain) { t.alpha = plain.opacity ?? 0.72; if (plain.align) t.style.align = plain.align; }
        // explicitly placed text with align left/right: x is that edge of the block (y stays the vertical centre)
        const edge = plain && typeof plain.x === "number" && typeof plain.y === "number" ? plain.align : undefined;
        t.anchor.set(edge === "left" ? 0 : edge === "right" ? 1 : 0.5, 0.5);
        c.addChild(t);
        this.root.addChild(c);
        // Words are retained Text pieces laid out once per (text, size): reveals animate alpha/position/scale only, never re-wrap.
        let words: { t: Text; x: number; y: number }[] = [], key = "";
        const base = plain ? plain.opacity ?? 0.72 : 1;
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const p = this.lay.get(o.id);
          const full = p?.text ?? o.text;
          const fs = p?.fontSize ?? (kinetic ? 120 : 30);
          const perWord = split || s.style === "type"; // once split into words, stay split: no hand-off jump when the reveal ends
          if (t.style.fontSize !== fs) { t.style.fontSize = fs; t.style.lineHeight = fs * 1.15; t.style.letterSpacing = bold ? -fs * 0.03 : 0; }
          if (t.text !== full) t.text = full;
          t.visible = !perWord;
          words.forEach((x) => (x.t.visible = perWord));
          if (!perWord) return;
          if (key !== `${full}|${fs}`) {
            key = `${full}|${fs}`;
            words.forEach((x) => x.t.destroy());
            const m = (x: string) => plain?.mono ? CanvasTextMetrics.measureText(x, new TextStyle({ fontSize: fs, fontFamily: MONO })).width : this.measure(x, fs, bold);
            const align = (plain?.align ?? "center") as "left" | "center" | "right";
            words = wordPlacements(full, fs, m, 1.15, align, !!edge, m("a a") - m("aa")).map((x) => {
              const wt = this.text(x.word, fs, bold ? "bold" : "normal", plain?.mono); wt.anchor.set(0.5); c.addChild(wt); return { t: wt, x: x.x, y: x.y };
            });
          }
          // type: a quick left-to-right cascade with a small rise; words: each word lands with a slight scale; stack: words rise in
          const [gap, rise, grow] = variant === "stack" ? [0.2, 0.6, 0] : variant === "words" ? [0.12, 0.25, 0.15] : [0.08, 0.3, 0];
          words.forEach((x, i) => {
            const k = staggerProgress(s.reveal ?? 1, i, words.length, gap), e = ease(k, "outExpo");
            x.t.alpha = Math.min(1, k * 2) * base;
            x.t.position.set(x.x, x.y + (1 - e) * fs * rise);
            x.t.scale.set(1 - grow * (1 - e));
          });
        } };
      }
      case "flow": case "table": case "code": case "figure": case "bits": case "stack": case "chart": {
        const visual = buildVisual(o, this.fg, () => { if (this.lastState) this.draw(this.lastState); }, this.bg, () => this.lay.get(o.id));
        this.root.addChild(visual.node);
        return { node: visual.node, draw: (s, w, h) => {
          place(s, w, h, visual.node);
          return visual.draw(s, w, h);
        } };
      }
      case "icon": case "emoji": case "counter": case "person": {
        const cell = () => this.lay.get(o.id);
        const v = o.type === "icon" ? buildIcon(o, this.fg, cell) : o.type === "emoji" ? buildEmoji(o, this.fg, cell)
          : o.type === "counter" ? buildCounter(o, this.fg, cell) : buildPerson(o, this.fg, cell);
        this.root.addChild(v.node);
        return { node: v.node, draw: (s, w, h) => { place(s, w, h, v.node); return v.draw(s, w, h); } };
      }
      case "gif": return buildGif(o, this.mathLayer, () => this.lay.get(o.id));
      case "Stack": case "Queue": case "LinkedList": case "Graph": case "numberline": case "matrix": case "distribution": case "texture": {
        const cell = () => this.lay.get(o.id), pt = this.setPoint.bind(this);
        const v = o.type === "Graph" ? buildGraph(o, this.fg, this.bg, cell, pt) : o.type === "numberline" ? buildNumberline(o, this.fg)
          : o.type === "matrix" ? buildMatrix(o, this.fg, cell) : o.type === "distribution" ? buildDistribution(o, this.fg, cell)
          : o.type === "texture" ? buildTexture(o, this.fg) : buildSeq(o, this.fg, this.bg, cell, pt);
        (o.type === "texture" ? this.bgLayer : this.root).addChild(v.node);
        return { node: v.node, draw: (s, w, h) => { place(s, w, h, v.node); return v.draw(s, w, h); } };
      }
      case "mark": return this.buildMark(o, c);
      case "shape": {
        const g = new Graphics(), label = this.text(o.label ?? "", 30), sub = this.text(o.sublabel ?? "", 30);
        label.anchor.set(.5); sub.anchor.set(.5); c.addChild(g, label, sub); this.root.addChild(c);
        let bw = 0, bh = 0, out = smoothOutline(o.shape, 1, 1, o.tail);
        const lines = (t: Text) => t.text.split("\n").length * Number(t.style.lineHeight);
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const cell = this.lay.get(o.id);
          const wide = o.shape === "rect" || o.shape === "pill" || o.shape === "parallelogram";
          const width = Math.min((o.width ?? (wide ? .36 : .24 * h / w)) * w, cell?.cw ? cell.cw * .88 : Infinity);
          const height = Math.min((o.height ?? .24) * h, cell?.ch ? cell.ch * .8 : Infinity);
          if (o.pivot === "bottom") { c.pivot.y = height / 2; c.y += height / 2 * s.scale; }
          if (width !== bw || height !== bh) {
            bw = width; bh = height;
            out = smoothOutline(o.shape, bw, bh, o.tail, h * .025);
            const [fw, fh, dx, dy] = LABEL_BOX[o.shape] ?? LABEL_BOX.rect, cy = bh * dy;
            fitText(label, o.label ?? "", bw * fw, bh * fh * (o.sublabel ? .62 : 1), h * .045);
            sub.visible = !!o.sublabel;
            if (o.sublabel) {
              fitText(sub, o.sublabel, bw * fw, bh * fh * .36, Number(label.style.fontSize) * .6);
              label.y = cy - lines(sub) / 2; sub.y = cy + lines(label) / 2;
            } else label.y = cy;
            label.x = sub.x = bw * dx;
          }
          // Outline traces first (both ways from the top, meeting at the bottom), then the fill, detail strokes and label fade in.
          const r = s.style === "draw" ? s.reveal ?? 1 : 1, fillA = s.style === "draw" ? window01(r, .7, 1) : 1, sw = strokeW(h);
          const stroke = { width: sw, color: this.fg, alpha: .75 + .25 * s.hl, cap: "round", join: "round" } as const;
          const tick = o.shape === "check" || o.shape === "cross" ? { ...stroke, width: sw * 2.2 } : stroke;
          g.clear();
          if (fillA > 0 && !out.open) {
            if (!o.ghost) g.poly(out.fill.flat()).fill({ color: this.bg, alpha: fillA });
            g.poly(out.fill.flat()).fill(o.filled ? { color: this.fg, alpha: .92 * fillA } : { color: this.fg, alpha: ((o.ghost ? .1 : .07) + .15 * s.hl) * fillA });
          }
          if (r >= 1 && out.sym) g.poly(out.pts.slice(0, -1).flat(), true).stroke(stroke);
          else if (r > 0) { const part = out.sym ? symmetricTrace(out.pts, r) : partialPath(out.pts, out.open && out.extra ? Math.min(1, r * 2) : r); if (part.length > 1) g.poly(part.flat(), false).stroke(tick); }
          const xr = out.open ? window01(r, .5, 1) : window01(r, .55, 1);
          if (xr > 0) for (const x of o.shape === "gear" && o.label ? [] : out.extra ?? []) { const part = partialPath(x, xr); if (part.length > 1) g.poly(part.flat(), false).stroke(o.filled ? { ...tick, color: this.bg } : tick); }
          this.ext.set(o.id, [bw / 2 * s.scale, bh / 2 * s.scale]);
          label.style.fill = sub.style.fill = o.filled ? this.bg : this.fg;
          label.alpha = s.style === "draw" ? window01(r, .35, .9) : 1; sub.alpha = label.alpha * .65;
        } };
      }
      case "arrow":
      case "line": {
        const g = new Graphics(), lbl = this.text(o.label ?? "", 24);
        lbl.anchor.set(.5); c.addChild(g, lbl); this.root.addChildAt(c, 1); // connectors sit under the boxes they join (above textures)
        return { node: c, draw: (s, w, h, all) => {
          c.visible = s.visible; c.alpha = s.opacity;
          const pt = (p: string | [number, number]): [number, number] | null => {
            if (Array.isArray(p)) return [(p[0] + (s.dx ?? 0)) * w, p[1] * h]; // fixed endpoints ride along with a transition
            const t = all.get(p);
            return t?.visible ? [t.x * w, t.y * h] : null;
          };
          const a0 = pt(o.from), b0 = pt(o.to);
          g.clear(); lbl.visible = false;
          if (!a0 || !b0) return; // endpoint missing or hidden: draw nothing rather than a line to the centre
          const full = routePoints(a0, b0, o.route), len = pathLength(full);
          const trim = (p: string | [number, number], dir: Point) => {
            if (Array.isArray(p)) return 0;
            const [hw, hh] = this.ext.get(p) ?? [.04 * h, .04 * h];
            return Math.min(hw / Math.max(1e-3, Math.abs(dir[0])), hh / Math.max(1e-3, Math.abs(dir[1]))) + 6;
          };
          const ta = Math.min(trim(o.from, pathDir(full, false)), len / 2 - 1), tb = Math.min(trim(o.to, pathDir(full, true)), len / 2 - 1);
          if (ta + tb >= len - 4) return; // boxes overlap: no room for a connector
          const path = trimPath(full, ta, tb);
          if (path.length < 2) return;
          const p = s.style === "draw" ? s.reveal ?? 1 : 1, sw = strokeW(h), head = o.type === "arrow" ? sw * 3.2 : 0;
          // the shaft stops short of the tip so the filled head stays sharp; the head rides the drawing front
          const part = partialPath(path, p), tip = part[part.length - 1], dir = part.length > 1 ? pathDir(part, true) : [1, 0];
          const shaft = head && p > 0 ? trimPath(part, 0, Math.min(head * .8, pathLength(part))) : part;
          if (shaft.length > 1) {
            for (const d of o.dashed ? dashPolylines(shaft, sw * 4, sw * 2.6) : [shaft]) g.poly(d.flat(), false);
            g.stroke({ width: sw, color: this.fg, alpha: .85, cap: "round", join: "round" });
          }
          if (head && p > 0 && part.length > 1) {
            const k = head * Math.min(1, p * 4), [ux, uy] = dir, [x2, y2] = tip;
            g.poly([x2, y2, x2 - ux * k * 1.5 - uy * k * .75, y2 - uy * k * 1.5 + ux * k * .75, x2 - ux * k * 1.5 + uy * k * .75, y2 - uy * k * 1.5 - ux * k * .75]).fill({ color: this.fg, alpha: .85 });
          }
          if (o.label && p >= .5) { // label beside the midpoint, on a bg backing so it stays readable over other marks
            const fs = .028 * h, [mx, my] = pathPoint(path, .5), [x0, y0] = pathPoint(path, .49), [x1, y1] = pathPoint(path, .51);
            let nx = -(y1 - y0), ny = x1 - x0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
            if (ny > 0) { nx = -nx; ny = -ny; }
            const lx = mx + nx * fs * 1.1, ly = my + ny * fs * 1.1, tw = this.measure(o.label, fs, false) + fs;
            g.roundRect(lx - tw / 2, ly - fs * .75, tw, fs * 1.5, 4).fill({ color: this.bg });
            lbl.visible = true; lbl.text = o.label; lbl.style.fontSize = fs; lbl.position.set(lx, ly); lbl.alpha = Math.min(1, (p - .5) * 4);
          }
          if (s.pulse !== undefined) { // signal dot travelling from -> to
            const [x, y] = pathPoint(path, s.pulse);
            g.circle(x, y, sw * 4).fill({ color: this.fg, alpha: .15 }).circle(x, y, sw * 1.8).fill({ color: this.fg });
          }
        } };
      }
      case "Math": {
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;transform-origin:center;white-space:nowrap;color:var(--fg);display:none;pointer-events:none";
        el.innerHTML = katex.renderToString(o.tex, { throwOnError: false, displayMode: true });
        this.mathLayer.appendChild(el);
        return { node: el, draw: (s, w, h) => {
          el.style.display = s.visible ? "block" : "none";
          el.style.opacity = String(s.opacity);
          el.style.fontSize = `${(o.size ?? 0.06) * h}px`;
          el.style.left = `${s.x * w}px`; el.style.top = `${s.y * h}px`;
          el.style.transform = `translate(-50%,-50%) scale(${s.scale}) rotate(${s.rotation ?? 0}rad)`;
          el.style.color = `#${(s.color ?? 0xffffff).toString(16).padStart(6, "0")}`;
        } };
      }
      case "Array": {
        const cells = o.init.map(() => ({ g: new Graphics(), t: this.text("", 40, "bold", true) }));
        cells.forEach(({ g, t }) => { t.anchor.set(0.5); c.addChild(g, t); });
        this.root.addChild(c);
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const n = cells.length, size = Math.min(0.17 * h, (w * 0.9) / (n * 1.15)), step = size * 1.15, x0 = -((n - 1) * step) / 2;
          cells.forEach(({ g, t }, i) => {
            const enter = s.style === "stagger" ? staggerProgress(s.reveal ?? 1, i, n, s.gap) : s.reveal ?? 1;
            g.alpha = enter; t.alpha = enter;
            const slot = s.slots![i];
            const x = x0 + (slot.to === undefined ? i : i + (slot.to - i) * slot.p) * step;
            const lift = (slot.to === undefined ? 0 : -Math.sin(Math.PI * slot.p) * size * 0.35) + (1 - ease(enter, "outExpo")) * size * .25; // hop so swaps read
            g.clear().roundRect(-size / 2, -size / 2, size, size, size * 0.16)
              .fill({ color: this.bg }).roundRect(-size / 2, -size / 2, size, size, size * 0.16)
              .fill({ color: this.fg, alpha: .07 + .85 * slot.hl })
              .stroke({ width: strokeW(h), color: this.fg, alpha: 0.75, join: "round" });
            if (slot.ring) g.circle(0, 0, size*(.6+.25*slot.ring)).stroke({ color: this.fg, width: strokeW(h), alpha: 1-slot.ring });
            g.position.set(x, lift);
            const value = String(slot.value);
            if (t.label !== `${size}:${value}`) { fitText(t, value, size*.84, size*.8, size*.45); t.label = `${size}:${value}`; }
            t.style.fill = slot.hl > 0.5 ? this.bg : this.fg;
            t.position.set(x, lift);
            this.setPoint(`${o.id}.slot[${i}]`, s.x*w+x*s.scale, s.y*h+lift*s.scale, size/2*s.scale);
          });
        } };
      }
      case "Tree": {
        const root = Array.isArray(o.init) ? fromLevel(o.init) : o.init;
        const nodes: { n: TreeNode; x: number; y: number }[] = [];
        let col = 0;
        const lay = (n: TreeNode | null, depth: number) => { // inorder column (first child, node, rest), depth row
          if (!n) return;
          lay(n.children[0] ?? null, depth + 1);
          nodes.push({ n, x: col++, y: depth });
          n.children.slice(1).forEach((k) => lay(k, depth + 1));
        };
        lay(root, 0);
        const byNode = new Map(nodes.map((p, i) => [p.n, i]));
        const parentOf = new Map<TreeNode, TreeNode>();
        const walk = (n: TreeNode | null) => n?.children.forEach((k) => { if (k) { parentOf.set(k, n); walk(k); } });
        walk(root);
        const g = new Graphics();
        const labels = nodes.map(({ n }) => this.text(n.keys.join(","), 30, "bold", true));
        c.addChild(g, ...labels);
        labels.forEach((l) => l.anchor.set(0.5));
        this.root.addChild(c);
        const depth = Math.max(1, ...nodes.map((p) => p.y + 1));
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const r = Math.min(0.05 * h, (w * 0.8) / (2.4 * Math.max(1, nodes.length))), dx = r * 2.4, dy = Math.min(0.14 * h, (0.5 * h) / depth);
          const at = (i: number): [number, number] => [(nodes[i].x - (nodes.length - 1) / 2) * dx, nodes[i].y * dy - ((depth - 1) * dy) / 2];
          g.clear();
          nodes.forEach(({ n }, i) => {
            const p = parentOf.get(n);
            if (!p) return;
            const [x1, y1] = at(byNode.get(p)!), [x2, y2] = at(i);
            const reveal = s.style === "stagger" ? staggerProgress(s.reveal ?? 1, i, nodes.length, s.gap) : s.reveal ?? 1;
            if (reveal > 0) g.moveTo(x1, y1).lineTo(x1+(x2-x1)*ease(reveal), y1+(y2-y1)*ease(reveal)).stroke({ width: strokeW(h), color: this.fg, alpha: 0.5, cap: "round" });
          });
          nodes.forEach(({ n }, i) => {
            const hl = s.valHl?.[n.keys[0]] ?? 0, [x, y] = at(i);
            const reveal = s.style === "stagger" ? staggerProgress(s.reveal ?? 1, i, nodes.length, s.gap) : s.reveal ?? 1;
            const rr = r * (.6 + .4 * ease(reveal, "outBack"));
            if (reveal > 0) g.circle(x, y, rr).fill({ color: this.bg }).circle(x, y, rr).fill({ color: this.fg, alpha: .07 + .85 * hl }).stroke({ width: strokeW(h), color: this.fg, alpha: 0.75 * Math.min(1, reveal * 3) });
            labels[i].position.set(x, y);
            labels[i].alpha = reveal;
            if (labels[i].label !== String(r)) { fitText(labels[i], n.keys.join(","), r*1.4, r*1.4, r*.9); labels[i].label = String(r); }
            labels[i].style.fill = hl > 0.5 ? this.bg : this.fg;
            for (const k of n.keys) this.setPoint(`${o.id}.val(${k})`, s.x*w+x*s.scale, s.y*h+y*s.scale, r*s.scale);
          });
        } };
      }
      default:
        return null; // axes, plot, media: not in the MVP renderer
    }
  }

  /** Bounds (px, stage space) of a placed object, or of a phrase inside a text object. */
  private boundsOf(id: string, all: Map<string, ObjState>, phrase?: string): [number, number, number, number] | null {
    const t = all.get(id), def = this.scene.objects.find(x => x.id === id);
    if (!t?.visible || !def) return null;
    const cx = t.x * this.app.screen.width, cy = t.y * this.app.screen.height, p = this.lay.get(id);
    if ((def.type === "text" || def.type === "KineticText") && p?.text && p.fontSize) {
      const bold = def.type === "KineticText" || def.weight === "bold", fs = p.fontSize, m = (x: string) => this.measure(x, fs, bold);
      const align = (def.type === "text" ? def.align : undefined) ?? "center", edge = def.type === "text" && typeof def.x === "number" && typeof def.y === "number" && align !== "center";
      const words = wordPlacements(p.text, fs, m, 1.15, align, edge, m("a a") - m("aa"));
      const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      const want = (phrase ?? "").split(/\s+/).map(norm).filter(Boolean), got = words.map(x => norm(x.word));
      let hit = words;
      for (let i = 0; want.length && i + want.length <= got.length; i++) if (want.every((x, j) => got[i + j] === x)) { hit = words.slice(i, i + want.length); break; }
      const x0 = Math.min(...hit.map(x => x.x - m(x.word) / 2)), x1 = Math.max(...hit.map(x => x.x + m(x.word) / 2));
      const y0 = Math.min(...hit.map(x => x.y)) - fs * .55, y1 = Math.max(...hit.map(x => x.y)) + fs * .55;
      return [cx + x0 * t.scale, cy + y0 * t.scale, cx + x1 * t.scale, cy + y1 * t.scale];
    }
    const [hw, hh] = this.ext.get(id) ?? [.06 * this.app.screen.height, .06 * this.app.screen.height];
    return [cx - hw, cy - hh, cx + hw, cy + hh];
  }

  /** Hand-drawn emphasis (underline / circle / strike / marker) traced over its target while it reveals. */
  private buildMark(o: Extract<SceneObject, { type: "mark" }>, c: Container): { node: Container; draw: Drawer } {
    const g = new Graphics();
    c.addChild(g); this.root.addChild(c);
    return { node: c, draw: (s, _w, h, all) => {
      c.visible = s.visible; c.alpha = s.opacity; c.tint = s.color ?? 0xffffff;
      g.clear();
      const b = this.boundsOf(o.target, all, o.text);
      if (!b) return;
      const [x0, y0, x1, y1] = b, p = s.reveal ?? 1, sw = strokeW(h) * 1.6, pad = h * .012;
      const line = (pts: Point[], k = p) => { const part = partialPath(pts, k); if (part.length > 1) g.poly(part.flat(), false).stroke({ width: sw, color: this.fg, alpha: .9, cap: "round", join: "round" }); };
      const wave = (y: number, amp: number): Point[] => Array.from({ length: 13 }, (_, i) => [x0 - pad + (x1 - x0 + 2 * pad) * i / 12, y + Math.sin(i * .9) * amp]);
      if (o.mark === "underline") line(wave(y1 + pad * .6, h * .003));
      else if (o.mark === "strike") line(wave((y0 + y1) / 2, h * .002));
      else if (o.mark === "marker") { const k = ease(p, "outCubic"); if (k > 0) g.roundRect(x0 - pad, y0 + (y1 - y0) * .1, (x1 - x0 + 2 * pad) * k, (y1 - y0) * .8, pad).fill({ color: this.fg, alpha: .22 }); }
      else { // circle: an ellipse that overshoots its start a little, like a pen loop
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + pad * 2.2, ry = (y1 - y0) / 2 + pad * 1.6;
        line(Array.from({ length: 49 }, (_, i) => { const a = -Math.PI / 2 - .3 + i / 48 * (Math.PI * 2 + .5); return [cx + Math.cos(a) * rx * (1 + .03 * Math.sin(a * 3)), cy + Math.sin(a) * ry] as Point; }));
      }
    } };
  }

  private setPoint(id: string, x: number, y: number, r: number) {
    const p = this.pts.get(id);
    if (p) { p.x = x; p.y = y; p.r = r; }
    else this.pts.set(id, { x, y, r });
  }

  /** Layout pass: once per scene size (first draw, resize), never per frame. */
  private relayout(w: number, h: number) {
    const key = `${w}x${h}`;
    if (key === this.laidFor) return;
    this.laidFor = key;
    this.lay = layoutScene(this.scene.objects, w, h, this.measure);
  }

  /** Scene state positions are defaults/explicit + animation; swap the default for the laid-out spot, keep the animated delta. */
  private placed(st: SceneState): Map<string, ObjState> {
    const out = this.placedObjects;
    for (const o of this.scene.objects) {
      const s = st.objects.get(o.id)!, p = this.lay.get(o.id);
      const [dx, dy] = DEFAULT_POS[o.type] ?? [0.5, 0.5];
      const placed = { ...s }; // fresh copy: keys absent this frame (row/col/range highlights) must not linger
      out.set(o.id, placed);
      if (p) { placed.x = p.x + s.x - (typeof o.x === "number" ? o.x : dx); placed.y = p.y + s.y - (typeof o.y === "number" ? o.y : dy); }
    }
    return out;
  }

  draw(state: SceneState) {
    this.lastState = state;
    const { width: w, height: h } = this.app.screen;
    this.relayout(w, h);
    const st = { ...state, objects: this.placed(state) };
    for (const [id, d] of this.draws) {
      const s = st.objects.get(id)!;
      if (!s.visible) {
        if (d.node instanceof HTMLElement) d.node.style.display = "none";
        else d.node.visible = false;
        continue;
      }
      const ex = d.draw(s, w, h, st.objects);
      if (ex) this.ext.set(id, [ex[0] * s.scale, ex[1] * s.scale]);
      this.setPoint(id, s.x*w, s.y*h, ex ? Math.max(ex[0], ex[1]) * s.scale : .12*h*s.scale);
    }
    this.rings.clear();
    for (const s of st.objects.values()) if (s.visible && s.ring) this.rings.circle(s.x*w, s.y*h, (.12+.06*s.ring)*h*s.scale).stroke({ color: this.fg, width: 3, alpha: 1-s.ring });
    this.reaction.visible = !!st.reaction;
    this.reaction.text = st.reaction ?? "";
    this.reaction.style.fontSize = 0.1 * h;
    this.reaction.position.set(w / 2, h / 2);
    // whip/push move objects in the state (outgoing frame leaves, new one arrives); a cut is an instant swap.
    // Here only the camera applies, plus the whip's horizontal smear (scale about the screen centre).
    const camera = { x: .5, y: .5, zoom: 1, shake: 0, ...st.camera };
    const sx = camera.zoom * (camera.stretch ?? 1);
    const tx = w/2 + (camera.stretch ?? 1) * (-camera.x*w*camera.zoom + camera.shake*w);
    const ty = h/2 - camera.y*h*camera.zoom + (camera.shakeY ?? camera.shake)*h;
    this.root.scale.set(sx, camera.zoom); this.root.position.set(tx, ty); this.root.alpha = 1;
    this.mathLayer.style.transformOrigin = "0 0";
    this.mathLayer.style.transform = `matrix(${sx},0,0,${camera.zoom},${tx},${ty})`;
    this.mathLayer.style.opacity = String(this.root.alpha);
    for (const [key] of this.pts) if (!st.objects.get(key.split(".")[0])?.visible) this.pts.delete(key);
    for (const pt of this.pts.values()) { pt.x = pt.x*sx+tx; pt.y = pt.y*camera.zoom+ty; pt.r *= camera.zoom; }
    this.paintAnnotations(w, h);
    this.app.render();
  }

  private paintAnnotations(w: number, h: number) {
    const g = this.annG.clear();
    if (!this.anns.length && !this.annTexts.length) return;
    let labels = 0;
    for (const s of annotationShapes(this.anns, this.pts, w, h)) {
      if (s.k === "circle") g.circle(s.x, s.y, s.r).stroke({ width: 4, color: this.fg });
      else if (s.k === "rect") g.roundRect(s.x, s.y, s.w, s.h, 8).fill({ color: this.fg, alpha: 0.18 }).stroke({ width: 2, color: this.fg, alpha: 0.8 });
      else if (s.k === "arrow") {
        const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), k = 0.025 * h;
        g.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2)
          .moveTo(s.x2 - k * Math.cos(a - 0.45), s.y2 - k * Math.sin(a - 0.45)).lineTo(s.x2, s.y2).lineTo(s.x2 - k * Math.cos(a + 0.45), s.y2 - k * Math.sin(a + 0.45))
          .stroke({ width: 4, color: this.fg });
      } else {
        let t = this.annTexts[labels++];
        if (!t) {
          t = this.text(s.text, .035*h, "bold"); t.anchor.set(.5);
          this.app.stage.addChild(t); this.annTexts.push(t);
        }
        t.visible = true; t.text = s.text; t.style.fontSize = .035*h;
        t.position.set(s.x, s.y);
      }
    }
    for (let i = labels; i < this.annTexts.length; i++) this.annTexts[i].visible = false;
  }

  destroy() {
    this.annTexts.forEach((x) => x.destroy());
    this.draws.forEach((d) => d.node instanceof HTMLElement && d.node.remove());
    this.lastState = undefined;
    this.annG.destroy();
    this.mathLayer.style.transform = ""; this.mathLayer.style.opacity = "";
    this.root.destroy({ children: true });
  }
}
