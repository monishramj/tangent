// Pure: (scene, compiled timeline, t) -> per-object render state. No clocks, no Pixi; seeking is just a different t.
import { parseTarget, type Scene } from "@/dsl/schema";
import type { Timeline, TimelineEvent } from "@/dsl/compile";

export type Slot = { value: number | string; hl: number; to?: number; p: number }; // to/p: mid-move toward slot `to`
export type ObjState = {
  id: string;
  visible: boolean;
  opacity: number;
  x: number; // stage fractions 0..1
  y: number;
  scale: number;
  hl: number; // 0..1 highlight pulse
  slots?: Slot[]; // Array
  valHl?: Record<string, number>; // Tree: highlight by node key
};
export type SceneState = {
  objects: Map<string, ObjState>;
  transition: { type: string; p: number } | null;
  reaction: string | null;
};

export const HL_FADE = 0.4; // highlight pulse holds until its event ends, then fades over this
export const CUT_SEC = 0.06; // a cut is a brief black dip
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOut = (p: number) => 1 - (1 - p) ** 3;
const lerp = (a: number, b: number, k: number) => (k >= 1 ? b : a + (b - a) * k);
const num = (x: unknown, d: number) => (typeof x === "number" ? x : d);

const DEFAULT_POS: Record<string, [number, number]> = {
  KineticText: [0.5, 0.3], text: [0.5, 0.8], Math: [0.5, 0.5], Array: [0.5, 0.6], Tree: [0.5, 0.55],
};

export function applyEventsAt(scene: Scene, tl: Timeline, t: number): SceneState {
  const objects = new Map<string, ObjState>();
  for (const o of scene.objects) {
    const [dx, dy] = DEFAULT_POS[o.type] ?? [0.5, 0.5];
    const s: ObjState = { id: o.id, visible: false, opacity: 0, x: num(o.x, dx), y: num(o.y, dy), scale: 1, hl: 0 };
    if (o.type === "Array") s.slots = o.init.map((value) => ({ value, hl: 0, p: 0 }));
    if (o.type === "Tree") s.valHl = {};
    objects.set(o.id, s);
  }
  const kind = new Map(scene.objects.map((o) => [o.id, o]));
  const st: SceneState = { objects, transition: null, reaction: null };

  for (const e of tl.events) { // sorted by start; per-target events don't overlap, so "before" values are well defined
    if (e.start > t) break;
    const p = e.end > e.start ? clamp01((t - e.start) / (e.end - e.start)) : 1;
    if (e.verb === "reaction") { if (t < e.end) st.reaction = String(e.args.intent); continue; }
    if (e.verb === "transition") {
      const type = String(e.args.type);
      const end = type === "cut" ? e.start + CUT_SEC : e.end;
      if (t < end) st.transition = { type, p: clamp01((t - e.start) / (end - e.start)) };
      continue;
    }
    if (!e.target) continue;
    const tg = parseTarget(e.target);
    const o = tg && objects.get(tg.id);
    if (!tg || !o) continue;
    const pulse = p < 1 ? 1 : clamp01(1 - (t - e.end) / HL_FADE);
    if ("slot" in tg) applySlot(o, tg.slot, e, p, pulse);
    else if ("val" in tg) {
      const k = String(tg.val);
      if (o.valHl && (e.verb === "highlight" || e.verb === "indicate")) o.valHl[k] = Math.max(o.valHl[k] ?? 0, pulse);
    } else applyObject(o, e, p, pulse, kind.get(o.id)!, objects);
  }
  return st;
}

function applyObject(o: ObjState, e: TimelineEvent, p: number, pulse: number, def: Scene["objects"][number], all: Map<string, ObjState>) {
  switch (e.verb) {
    case "create":
      o.visible = true;
      o.opacity = clamp01(p * 3); // fast fade-in
      if (def.type === "KineticText" && def.variant === "slam") o.scale = 1 + 1.2 * (1 - easeOut(p)); // scale-punch in
      break;
    case "fade":
      o.opacity = lerp(o.opacity, num(e.args.to, 0), easeOut(p));
      break;
    case "move": {
      const to = e.args.to;
      const dest = Array.isArray(to) ? { x: num(to[0], o.x), y: num(to[1], o.y) } : typeof to === "string" ? all.get(to) : undefined;
      if (dest) { o.x = lerp(o.x, dest.x, easeOut(p)); o.y = lerp(o.y, dest.y, easeOut(p)); }
      break;
    }
    case "highlight": o.hl = Math.max(o.hl, pulse); break;
    case "indicate": o.hl = Math.max(o.hl, pulse); o.scale *= 1 + 0.1 * pulse; break;
  }
}

function applySlot(o: ObjState, i: number, e: TimelineEvent, p: number, pulse: number) {
  const s = o.slots?.[i];
  if (!s) return;
  if (e.verb === "highlight" || e.verb === "indicate") s.hl = Math.max(s.hl, pulse);
  else if (e.verb === "transform" && e.args.value !== undefined) s.value = e.args.value as Slot["value"];
  else if (e.verb === "move") {
    const to = typeof e.args.to === "string" ? parseTarget(e.args.to) : null;
    const j = to && "slot" in to ? Number(to.slot) : -1;
    if (!o.slots![j]) return;
    if (p < 1) { s.to = j; s.p = easeOut(p); }
    else o.slots![j].value = (e.args.value ?? s.value) as Slot["value"]; // paired swap events land values simultaneously
  }
}
