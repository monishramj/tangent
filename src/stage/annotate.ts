// Pure: tutor annotations + laid-out target points -> primitive shapes. The renderer paints them; no Pixi here.
import { parseTarget } from "@/dsl/schema";
import type { Annotation } from "@/tutor/annotations";

export type Pt = { x: number; y: number; r: number }; // px, center + rough radius
export type Shape =
  | { k: "circle"; x: number; y: number; r: number }
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { k: "text"; x: number; y: number; text: string };

/** Key into the renderer's point map: "h", "h.slot[0]", "t.val(5)". */
export const ptKey = (target: string) => {
  const t = parseTarget(target);
  if (!t) return target;
  return "slot" in t ? `${t.id}.slot[${t.slot}]` : "val" in t ? `${t.id}.val(${t.val})` : t.id;
};

export function annotationShapes(anns: Annotation[], pts: Map<string, Pt>, w: number, h: number): Shape[] {
  const out: Shape[] = [];
  for (const a of anns) {
    const p = pts.get(ptKey(a.target)) ?? pts.get(a.target.split(".")[0]); // fall back to the whole object
    if (!p) continue;
    const { x, y, r } = p;
    if (a.kind === "circle") out.push({ k: "circle", x, y, r: r * 1.25 });
    else if (a.kind === "highlight") out.push({ k: "rect", x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    else if (a.kind === "label") out.push({ k: "text", x, y: Math.max(16, y - r * 1.6), text: a.text });
    else {
      const x1 = Math.min(w - 8, x + r * 3), y1 = Math.min(h - 8, y + r * 3);
      const d = Math.hypot(x1 - x, y1 - y) || 1;
      out.push({ k: "arrow", x1, y1, x2: x + ((x1 - x) / d) * r * 1.1, y2: y + ((y1 - y) / d) * r * 1.1 });
    }
  }
  return out;
}
