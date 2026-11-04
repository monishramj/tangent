// Pixi v8 drawing of SceneState. Display objects are built once per scene object and mutated per frame; no clocks here.
import { CanvasTextMetrics, Container, Graphics, Text, TextStyle, type Application } from "pixi.js";
import katex from "katex";
import type { Scene, SceneObject, TreeNode } from "@/dsl/schema";
import { fromLevel } from "@/dsl/trees/shared";
import type { Annotation } from "@/tutor/annotations";
import { annotationShapes, type Pt } from "./annotate";
import { DEFAULT_POS, easeOut, type ObjState, type SceneState } from "./scene";
import { layoutScene, type Placed } from "./layout";
import { buildVisual, fitText, strokePath } from "./visuals";
import { ease, staggerProgress, type Point } from "./motion";

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
type Drawer = (s: ObjState, w: number, h: number, all: Map<string, ObjState>) => void;

export class SceneRenderer {
  private root = new Container();
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

  constructor(private app: Application, private scene: Scene, private mathLayer: HTMLElement, css: (n: string) => string) {
    this.fg = css("--fg");
    this.bg = css("--bg");
    app.stage.addChild(this.root);
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
        const kinetic = o.type === "KineticText";
        const t = this.text(o.text, kinetic ? 120 : 30, kinetic ? "bold" : "normal");
        if (!kinetic) t.alpha = 0.72;
        t.anchor.set(0.5);
        c.addChild(t);
        this.root.addChild(c);
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const p = this.lay.get(o.id);
          const full = p?.text ?? o.text;
          const shown = s.style === "type" ? full.slice(0, Math.floor(full.length * (s.reveal ?? 1))) : full;
          if (t.text !== shown) t.text = shown;
          if (p?.fontSize && t.style.fontSize !== p.fontSize) { t.style.fontSize = p.fontSize; t.style.letterSpacing = kinetic ? -p.fontSize * 0.03 : 0; }
        } };
      }
      case "flow": case "table": case "code": case "figure": case "bits": case "stack": {
        const visual = buildVisual(o, this.fg, () => { if (this.lastState) this.draw(this.lastState); }, this.bg);
        this.root.addChild(visual.node);
        return { node: visual.node, draw: (s, w, h) => {
          place(s, w, h, visual.node);
          visual.draw(s, w, h);
        } };
      }
      case "shape": {
        const g = new Graphics(), label = this.text(o.label ?? "", 30);
        label.anchor.set(.5); c.addChild(g, label); this.root.addChild(c);
        let bw = 0, bh = 0, points: Point[] = [];
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const cell = this.lay.get(o.id);
          const width = Math.min((o.width ?? (o.shape === "rect" ? .36 : .24) * h / w) * w, cell?.cw ? cell.cw * .88 : Infinity);
          const height = Math.min((o.height ?? .24) * h, cell?.ch ? cell.ch * .8 : Infinity);
          if (width !== bw || height !== bh) {
            bw = width; bh = height;
            if (o.shape === "circle") points = Array.from({ length: 65 }, (_, i) => [Math.cos(i/64*Math.PI*2)*bw/2, Math.sin(i/64*Math.PI*2)*bh/2]);
            else if (o.shape === "rect") points = [[-bw/2,-bh/2],[bw/2,-bh/2],[bw/2,bh/2],[-bw/2,bh/2],[-bw/2,-bh/2]];
            else points = [[0,-bh/2],[bw/2,bh/2],[-bw/2,bh/2],[0,-bh/2]];
            const inset = o.shape === "polygon" ? .4 : o.shape === "circle" ? .65 : .84;
            fitText(label, o.label ?? "", bw * inset, bh * inset, h*.04);
            label.y = o.shape === "polygon" ? bh * .12 : 0;
          }
          g.clear();
          if ((s.reveal ?? 1) >= 1 || s.style !== "draw") g.poly(points.flat()).fill({ color: this.bg }).poly(points.flat()).fill({ color: this.fg, alpha: .06 + .14 * s.hl });
          strokePath(g, points, s.style === "draw" ? s.reveal ?? 1 : 1, this.fg, 3, .6 + .4*s.hl);
          this.ext.set(o.id, [bw / 2 * s.scale, bh / 2 * s.scale]);
          label.alpha = s.reveal ?? 1;
        } };
      }
      case "arrow":
      case "line": {
        const g = new Graphics();
        c.addChild(g); this.root.addChildAt(c, 0); // connectors sit under the boxes they join
        return { node: c, draw: (s, w, h, all) => {
          c.visible = s.visible; c.alpha = s.opacity;
          const pt = (p: string | [number, number]): [number, number] | null => {
            if (Array.isArray(p)) return [p[0] * w, p[1] * h];
            const t = all.get(p);
            return t?.visible ? [t.x * w, t.y * h] : null;
          };
          const a0 = pt(o.from), b0 = pt(o.to);
          g.clear();
          if (!a0 || !b0) return; // endpoint missing or hidden: draw nothing rather than a line to the centre
          const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1, ux = (b0[0] - a0[0]) / len, uy = (b0[1] - a0[1]) / len;
          const trim = (p: string | [number, number]) => {
            if (Array.isArray(p)) return 0;
            const [hw, hh] = this.ext.get(p) ?? [.04 * h, .04 * h];
            return Math.min(hw / Math.max(1e-3, Math.abs(ux)), hh / Math.max(1e-3, Math.abs(uy))) + 6;
          };
          const ta = Math.min(trim(o.from), len / 2 - 1), tb = Math.min(trim(o.to), len / 2 - 1);
          if (ta + tb >= len - 4) return; // boxes overlap: no room for a connector
          const x1 = a0[0] + ux * ta, y1 = a0[1] + uy * ta, tx = b0[0] - ux * tb, ty = b0[1] - uy * tb;
          const p = s.style === "draw" ? s.reveal ?? 1 : 1;
          const x2 = x1 + (tx-x1)*p, y2 = y1 + (ty-y1)*p;
          g.moveTo(x1, y1).lineTo(x2, y2);
          if (o.type === "arrow" && p > 0) {
            const a = Math.atan2(y2 - y1, x2 - x1), k = 0.025 * h;
            g.moveTo(x2 - k * Math.cos(a - 0.45), y2 - k * Math.sin(a - 0.45)).lineTo(x2, y2).lineTo(x2 - k * Math.cos(a + 0.45), y2 - k * Math.sin(a + 0.45));
          }
          g.stroke({ width: 3, color: this.fg });
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
          el.style.fontSize = `${0.06 * h}px`;
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
          const n = cells.length, size = Math.min(0.14 * h, (w * 0.9) / (n * 1.15)), step = size * 1.15, x0 = -((n - 1) * step) / 2;
          cells.forEach(({ g, t }, i) => {
            const enter = s.style === "stagger" ? staggerProgress(s.reveal ?? 1, i, n, s.gap) : s.reveal ?? 1;
            g.alpha = enter; t.alpha = enter;
            const slot = s.slots![i];
            const x = x0 + (slot.to === undefined ? i : i + (slot.to - i) * slot.p) * step;
            const lift = (slot.to === undefined ? 0 : -Math.sin(Math.PI * slot.p) * size * 0.35) + (1-ease(enter))*size*.3 - Math.sin((s.age ?? 0)*3)*size*.025*slot.hl; // hop so swaps read
            g.clear().roundRect(-size / 2, -size / 2, size, size, size * 0.12)
              .fill({ color: this.fg, alpha: slot.hl })
              .stroke({ width: 2, color: this.fg, alpha: 0.6 });
            if (slot.ring) g.circle(0, 0, size*(.6+.25*slot.ring)).stroke({ color: this.fg, width: 2, alpha: 1-slot.ring });
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
            g.moveTo(x1, y1).lineTo(x1+(x2-x1)*reveal, y1+(y2-y1)*reveal).stroke({ width: 2, color: this.fg, alpha: 0.5 });
          });
          nodes.forEach(({ n }, i) => {
            const hl = s.valHl?.[n.keys[0]] ?? 0, [x, y] = at(i);
            const reveal = s.style === "stagger" ? staggerProgress(s.reveal ?? 1, i, nodes.length, s.gap) : s.reveal ?? 1;
            g.circle(x, y, r * ease(reveal)).fill({ color: this.bg }).circle(x, y, r * ease(reveal)).fill({ color: this.fg, alpha: hl }).stroke({ width: 2, color: this.fg, alpha: 0.7 });
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
    const measure = (s: string, size: number, bold: boolean) =>
      CanvasTextMetrics.measureText(s, new TextStyle({ fontSize: size, fontWeight: bold ? "bold" : "normal", fontFamily: FONT, letterSpacing: bold ? -size * 0.03 : 0 })).width;
    this.lay = layoutScene(this.scene.objects, w, h, measure);
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
      d.draw(s, w, h, st.objects);
      this.setPoint(id, s.x*w, s.y*h, .12*h*s.scale);
    }
    this.rings.clear();
    for (const s of st.objects.values()) if (s.visible && s.ring) this.rings.circle(s.x*w, s.y*h, (.12+.06*s.ring)*h*s.scale).stroke({ color: this.fg, width: 3, alpha: 1-s.ring });
    this.reaction.visible = !!st.reaction;
    this.reaction.text = st.reaction ?? "";
    this.reaction.style.fontSize = 0.1 * h;
    this.reaction.position.set(w / 2, h / 2);
    // transitions act on the whole layer: cut = black dip, whip/push = slide in from the right
    const tr = st.transition;
    this.root.alpha = tr?.type === "cut" ? 0 : 1;
    const slide = tr && tr.type !== "cut" ? (1 - easeOut(tr.p)) * w * (tr.type === "push" ? 1 : 1.5) : 0;
    const camera = st.camera ?? { x: .5, y: .5, zoom: 1, shake: 0 };
    const tx = w/2 - camera.x*w*camera.zoom + camera.shake*w + slide;
    const ty = h/2 - camera.y*h*camera.zoom + camera.shake*h;
    this.root.scale.set(camera.zoom); this.root.position.set(tx, ty);
    this.mathLayer.style.transformOrigin = "0 0";
    this.mathLayer.style.transform = `matrix(${camera.zoom},0,0,${camera.zoom},${tx},${ty})`;
    this.mathLayer.style.opacity = String(this.root.alpha);
    for (const [key] of this.pts) if (!st.objects.get(key.split(".")[0])?.visible) this.pts.delete(key);
    for (const pt of this.pts.values()) { pt.x = pt.x*camera.zoom+tx; pt.y = pt.y*camera.zoom+ty; pt.r *= camera.zoom; }
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
