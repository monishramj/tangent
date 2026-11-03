// Pixi v8 drawing of SceneState. Display objects are built once per scene object and mutated per frame; no clocks here.
import { Container, Graphics, Text, type Application } from "pixi.js";
import katex from "katex";
import type { Scene, SceneObject, TreeNode } from "@/dsl/schema";
import { fromLevel } from "@/dsl/trees/shared";
import { easeOut, type ObjState, type SceneState } from "./scene";

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
type Drawer = (s: ObjState, w: number, h: number, all: Map<string, ObjState>) => void;

export class SceneRenderer {
  private root = new Container();
  private draws = new Map<string, { node: Container | HTMLElement; draw: Drawer }>();
  private reaction: Text;
  private fg: string;
  private bg: string;

  constructor(private app: Application, scene: Scene, private mathLayer: HTMLElement, css: (n: string) => string) {
    this.fg = css("--fg");
    this.bg = css("--bg");
    app.stage.addChild(this.root);
    for (const o of scene.objects) {
      const d = this.build(o);
      if (d) this.draws.set(o.id, d);
    }
    this.reaction = this.text("", 64, "bold");
    this.reaction.anchor.set(0.5);
    this.root.addChild(this.reaction);
  }

  private text(s: string, size: number, weight: "normal" | "bold" = "normal", mono = false) {
    return new Text({ text: s, style: { fill: this.fg, fontSize: size, fontWeight: weight, fontFamily: mono ? MONO : FONT, letterSpacing: weight === "bold" ? -size * 0.03 : 0 } });
  }

  private build(o: SceneObject): { node: Container | HTMLElement; draw: Drawer } | null {
    const c = new Container();
    const place = (s: ObjState, w: number, h: number) => {
      c.visible = s.visible;
      c.alpha = s.opacity;
      c.position.set(s.x * w, s.y * h);
      c.scale.set(s.scale);
    };
    switch (o.type) {
      case "text":
      case "KineticText": {
        const kinetic = o.type === "KineticText";
        const t = this.text(kinetic ? o.text : o.text, kinetic ? 120 : 30, kinetic ? "bold" : "normal");
        if (!kinetic) t.alpha = 0.72;
        t.anchor.set(0.5);
        c.addChild(t);
        this.root.addChild(c);
        return { node: c, draw: (s, w, h) => { place(s, w, h); t.style.fontSize = (kinetic ? 0.16 : 0.04) * h; } };
      }
      case "shape": {
        const g = new Graphics();
        c.addChild(g);
        this.root.addChild(c);
        return { node: c, draw: (s, w, h) => {
          place(s, w, h);
          const r = 0.12 * h;
          g.clear();
          if (o.shape === "circle") g.circle(0, 0, r); else if (o.shape === "rect") g.rect(-r, -r, 2 * r, 2 * r); else g.poly([0, -r, r, r, -r, r]);
          g.stroke({ width: 3, color: this.fg, alpha: 0.5 + 0.5 * s.hl });
        } };
      }
      case "arrow":
      case "line": {
        const g = new Graphics();
        this.root.addChild(g);
        return { node: g, draw: (s, w, h, all) => {
          g.visible = s.visible; g.alpha = s.opacity;
          const pt = (p: string | [number, number]): [number, number] => {
            const t = typeof p === "string" ? all.get(p) : undefined;
            return Array.isArray(p) ? [p[0] * w, p[1] * h] : [(t?.x ?? 0.5) * w, (t?.y ?? 0.5) * h];
          };
          const [x1, y1] = pt(o.from), [x2, y2] = pt(o.to);
          g.clear().moveTo(x1, y1).lineTo(x2, y2);
          if (o.type === "arrow") {
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
          el.style.transform = `translate(-50%,-50%) scale(${s.scale})`;
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
            const slot = s.slots![i];
            const x = x0 + (slot.to === undefined ? i : i + (slot.to - i) * slot.p) * step;
            const lift = slot.to === undefined ? 0 : -Math.sin(Math.PI * slot.p) * size * 0.35; // hop so swaps read
            g.clear().roundRect(-size / 2, -size / 2, size, size, size * 0.12)
              .fill({ color: this.fg, alpha: slot.hl })
              .stroke({ width: 2, color: this.fg, alpha: 0.6 });
            g.position.set(x, lift);
            t.text = String(slot.value);
            t.style.fontSize = size * 0.45;
            t.style.fill = slot.hl > 0.5 ? this.bg : this.fg;
            t.position.set(x, lift);
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
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 2, color: this.fg, alpha: 0.5 });
          });
          nodes.forEach(({ n }, i) => {
            const hl = s.valHl?.[n.keys[0]] ?? 0, [x, y] = at(i);
            g.circle(x, y, r).fill({ color: this.fg, alpha: hl }).stroke({ width: 2, color: this.fg, alpha: 0.7 });
            labels[i].position.set(x, y);
            labels[i].style.fontSize = r * 0.9;
            labels[i].style.fill = hl > 0.5 ? this.bg : this.fg;
          });
        } };
      }
      default:
        return null; // axes, plot, media: not in the MVP renderer
    }
  }

  draw(st: SceneState) {
    const { width: w, height: h } = this.app.screen;
    for (const [id, d] of this.draws) d.draw(st.objects.get(id)!, w, h, st.objects);
    this.reaction.visible = !!st.reaction;
    this.reaction.text = st.reaction ?? "";
    this.reaction.style.fontSize = 0.1 * h;
    this.reaction.position.set(w / 2, h / 2);
    // transitions act on the whole layer: cut = black dip, whip/push = slide in from the right
    const tr = st.transition;
    this.root.alpha = tr?.type === "cut" ? 0 : 1;
    this.root.x = tr && tr.type !== "cut" ? (1 - easeOut(tr.p)) * w * (tr.type === "push" ? 1 : 1.5) : 0;
    this.app.render();
  }

  destroy() {
    this.draws.forEach((d) => d.node instanceof HTMLElement && d.node.remove());
    this.root.destroy({ children: true });
  }
}
