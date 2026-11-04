// Pure: (scene, compiled timeline, t) -> per-object render state. No clocks, no Pixi; seeking is just a different t.
import { parseTarget, type Scene } from "@/dsl/schema";
import type { Timeline, TimelineEvent } from "@/dsl/compile";
import { ease, progress, defaultStyle, pathPoint, type Style, type Ease, type Point, focusAt, type Focus } from "./motion";

export type Slot = { value: number | string; hl: number; to?: number; p: number; ring?: number }; // to/p: mid-move toward slot `to`
export type ObjState = {
  id: string;
  visible: boolean;
  opacity: number;
  x: number; // stage fractions 0..1
  y: number;
  scale: number;
  reveal?: number;
  style?: Style;
  gap?: number;
  age?: number;
  rotation?: number;
  color?: number;
  ring?: number;
  row?: number;
  col?: number;
  range?: [number, number];
  focus?: Focus;
  hl: number; // 0..1 highlight pulse
  slots?: Slot[]; // Array
  valHl?: Record<string, number>; // Tree: highlight by node key
};
export type SceneState = {
  objects: Map<string, ObjState>;
  transition: { type: string; p: number } | null;
  reaction: string | null;
  camera?: { x: number; y: number; zoom: number; shake: number };
};

export const HL_FADE = 0.4; // highlight pulse holds until its event ends, then fades over this
export const CUT_SEC = 0.06; // a cut is a brief black dip
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOut = (p: number) => 1 - (1 - p) ** 3;
const lerp = (a: number, b: number, k: number) => (k >= 1 ? b : a + (b - a) * k);
const num = (x: unknown, d: number) => (typeof x === "number" ? x : d);

export const DEFAULT_POS: Record<string, [number, number]> = {
  KineticText: [0.5, 0.3], text: [0.5, 0.8], Math: [0.5, 0.5], Array: [0.5, 0.6], Tree: [0.5, 0.55],
};

export function applyEventsAt(scene: Scene, tl: Timeline, t: number): SceneState {
  const objects = new Map<string, ObjState>();
  for (const o of scene.objects) {
    const [dx, dy] = DEFAULT_POS[o.type] ?? [0.5, 0.5];
    const s: ObjState = { id: o.id, visible: false, opacity: 0, x: num(o.x, dx), y: num(o.y, dy), scale: 1, hl: 0, reveal: 0, age: 0, rotation: 0, color: typeof o.color === "string" ? parseInt(o.color.slice(1), 16) : 0xffffff, ring: 0 };
    if (o.type === "Array") s.slots = o.init.map((value) => ({ value, hl: 0, p: 0 }));
    if (o.type === "Tree") s.valHl = {};
    objects.set(o.id, s);
  }
  const kind = new Map(scene.objects.map((o) => [o.id, o]));
  const st: SceneState = { objects, transition: null, reaction: null, camera: { x: .5, y: .5, zoom: 1, shake: 0 } };

  for (const e of tl.events) { // sorted by start; per-target events don't overlap, so "before" values are well defined
    if (e.start > t) break;
    const p = progress(t, e.start, e.end);
    if (e.verb === "camera") {
      const camera = st.camera!, k = ease(p, e.args.easing as Ease ?? "inOutQuad");
      camera.x = lerp(camera.x, num(e.args.x, camera.x), k);
      camera.y = lerp(camera.y, num(e.args.y, camera.y), k);
      camera.zoom = lerp(camera.zoom, num(e.args.zoom, camera.zoom), k);
      camera.shake = p === 1 ? 0 : num(e.args.shake, 0) * Math.sin((t - e.start) * 73) * Math.sin(Math.PI * p);
      continue;
    }
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
    } else applyObject(o, e, p, pulse, kind.get(o.id)!, objects, t);
  }
  for (const o of objects.values()) {
    const def = kind.get(o.id)!;
    if (o.visible && def.type === "figure") o.focus = focusAt(def.focus, progress(o.age ?? 0, 0, def.duration ?? 8));
    if (o.visible && def.type === "code" && !o.range && def.highlight?.length) {
      const i = Math.min(def.highlight.length - 1, Math.floor(progress(o.age ?? 0, 0, def.duration ?? 8) * def.highlight.length));
      o.range = def.highlight[i];
    }
    if (o.hl > 0) {
      o.y += Math.sin(t * 3) * .004 * o.hl;
      o.scale *= 1 + .018 * Math.sin(t * 4) * o.hl;
    }
  }
  return st;
}

function applyObject(o: ObjState, e: TimelineEvent, p: number, pulse: number, def: Scene["objects"][number], all: Map<string, ObjState>, t: number) {
  const easing = (e.args.easing ?? (e.verb === "create" ? def.easing : undefined)) as Ease | undefined;
  const k = ease(p, easing);
  switch (e.verb) {
    case "create": {
      const style = (e.args.style ?? defaultStyle(def)) as Style;
      o.style = style; o.gap = num(e.args.gap, num(def.gap, .12)); o.age = t - e.start;
      o.reveal = (style === "type" || style === "stagger") && !easing ? p : clamp01(k);
      o.visible = true; o.opacity = clamp01(p * 3);
      if (def.type === "KineticText" && def.variant === "slam" && e.args.style === undefined && def.style === undefined) o.scale = 1 + 1.2 * (1 - easeOut(p));
      else if (style === "pop") o.scale = ease(p, easing ?? "outBack");
      else if (style === "slide") {
        const edge = e.args.edge ?? "left";
        if (edge === "left" || edge === "right") o.x += (edge === "left" ? -1.2 : 1.2) * (1 - k);
        else o.y += (edge === "top" ? -1.2 : 1.2) * (1 - k);
      }
      break;
    }
    case "fade":
      o.opacity = lerp(o.opacity, num(e.args.to, 0), k);
      break;
    case "move": {
      const to = e.args.to;
      const dest = Array.isArray(to) ? { x: num(to[0], o.x), y: num(to[1], o.y) } : typeof to === "string" ? all.get(to) : undefined;
      const path = e.args.path as Point[] | undefined;
      if (path || dest) {
        const points: Point[] = path ?? [[o.x, o.y], [dest!.x, dest!.y]];
        [o.x, o.y] = pathPoint(points, k, num(e.args.arc, 0));
      }
      break;
    }
    case "transform": {
      o.scale = lerp(o.scale, num(e.args.scale, o.scale), k);
      o.rotation = lerp(o.rotation ?? 0, num(e.args.rotate, o.rotation ?? 0), k);
      if (typeof e.args.color === "string") {
        const from = o.color ?? 0xffffff, to = parseInt(e.args.color.slice(1), 16);
        let color = 0;
        for (const shift of [16, 8, 0]) color |= Math.round(lerp((from >> shift) & 255, (to >> shift) & 255, k)) << shift;
        o.color = color;
      }
      break;
    }
    case "highlight":
      o.hl = Math.max(o.hl, pulse);
      if (pulse > 0) {
        if (typeof e.args.row === "number") o.row = e.args.row;
        if (typeof e.args.col === "number") o.col = e.args.col;
        if (Array.isArray(e.args.range)) o.range = e.args.range as [number, number];
      }
      break;
    case "indicate": o.hl = Math.max(o.hl, pulse); o.ring = p < 1 ? p : 0; break;
  }
}

function applySlot(o: ObjState, i: number, e: TimelineEvent, p: number, pulse: number) {
  const s = o.slots?.[i];
  if (!s) return;
  if (e.verb === "highlight" || e.verb === "indicate") {
    s.hl = Math.max(s.hl, pulse);
    if (e.verb === "indicate") s.ring = p < 1 ? p : 0;
  }
  else if (e.verb === "transform" && e.args.value !== undefined) s.value = e.args.value as Slot["value"];
  else if (e.verb === "move") {
    const to = typeof e.args.to === "string" ? parseTarget(e.args.to) : null;
    const j = to && "slot" in to ? Number(to.slot) : -1;
    if (!o.slots![j]) return;
    if (p < 1) { s.to = j; s.p = easeOut(p); }
    else o.slots![j].value = (e.args.value ?? s.value) as Slot["value"]; // paired swap events land values simultaneously
  }
}
