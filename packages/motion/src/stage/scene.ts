// Pure: (scene, compiled timeline, t) -> per-object render state. No clocks, no Pixi; seeking is just a different t.
import { parseTarget, type Scene } from "../dsl/schema";
import type { Timeline, TimelineEvent } from "../dsl/compile";
import { seqItems, type SeqSnap } from "../dsl/components";
import { ease, progress, defaultStyle, pathPoint, type Style, type Ease, type Point, focusAt, type Focus, MOTION, clamp01 } from "./motion";

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
  valHl?: Record<string, number>; // Tree/Graph: highlight by node key
  snap?: unknown; snapFrom?: unknown; snapP?: number; // computed components: current snapshot, previous one, blend 0..1
  keyHl?: Record<string, number>; // Stack/Queue/LinkedList: highlight by item key (follows the item as it moves)
  pulse?: number; // arrow/line: 0..1 position of the travelling dot, only while a pulse event runs
  pose?: string; poseFrom?: string; poseP?: number; // person: target pose, previous pose, blend progress
  born?: number; // start time of the create event (transitions tell incoming objects from outgoing ones)
  exitFrom?: number; // opacity just before a transition's clear faded it out
  dx?: number; // transition offset (stage widths) already added to x; connectors with fixed endpoints add it too
};
export type SceneState = {
  objects: Map<string, ObjState>;
  transition: { type: string; p: number } | null;
  reaction: string | null;
  camera?: { x: number; y: number; zoom: number; shake: number; shakeY?: number; stretch?: number }; // stretch: whip x-scale
};

export const HL_FADE = 0.4; // highlight pulse holds until its event ends, then fades over this
export const CUT_SEC = 0.06; // a cut is an instant swap; the state keeps a short window so the player can see it
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
    if (o.type === "Tree" || o.type === "Graph") s.valHl = {};
    if (o.type === "Stack" || o.type === "Queue" || o.type === "LinkedList") { s.snap = { items: seqItems(o) }; s.keyHl = {}; }
    if (o.type === "Graph") s.snap = { visited: [], frontier: [], tree: [] };
    if (o.type === "person") { s.pose = s.poseFrom = o.pose; s.poseP = 1; }
    objects.set(o.id, s);
  }
  const kind = new Map(scene.objects.map((o) => [o.id, o]));
  const st: SceneState = { objects, transition: null, reaction: null, camera: { x: .5, y: .5, zoom: 1, shake: 0, shakeY: 0 } };
  // The transition running at t (if any) and the objects its clear fades out: those stay on screen and leave with it.
  const tr = tl.events.find((e) => e.verb === "transition" && e.start <= t && t < e.end && e.args.type !== "cut");
  const exiting = new Set(tr ? tl.events.filter((e) => e.verb === "fade" && e.target && num(e.args.to, 1) === 0 && e.start >= tr.start - 1e-6 && e.start < tr.end).map((e) => e.target!) : []);

  for (const e of tl.events) { // sorted by start; per-target events don't overlap, so "before" values are well defined
    if (e.start > t) break;
    const p = progress(t, e.start, e.end);
    if (e.verb === "camera") {
      const camera = st.camera!, k = ease(p, e.args.easing as Ease ?? "inOutQuad");
      camera.x = lerp(camera.x, num(e.args.x, camera.x), k);
      camera.y = lerp(camera.y, num(e.args.y, camera.y), k);
      camera.zoom = lerp(camera.zoom, num(e.args.zoom, camera.zoom), k);
      // shake: two incommensurate frequencies per axis with a fast decay reads as an impact, not a vibrating sine
      const amp = p === 1 ? 0 : num(e.args.shake, 0) * (1 - p) ** 2, u = t - e.start;
      camera.shake = amp && amp * (Math.sin(u * 61) + .5 * Math.sin(u * 97 + 1));
      camera.shakeY = amp && amp * .7 * (Math.sin(u * 53 + 2) + .5 * Math.sin(u * 89));
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
    } else {
      if (e.verb === "fade" && exiting.has(o.id) && o.exitFrom === undefined) o.exitFrom = o.opacity;
      applyObject(o, e, p, pulse, kind.get(o.id)!, objects, t);
    }
  }
  if (tr) applyTransition(st, String(tr.args.type), progress(t, tr.start, tr.end), tr.start, exiting);
  for (const o of objects.values()) {
    const def = kind.get(o.id)!;
    if (o.visible && def.type === "figure") o.focus = focusAt(def.focus, progress(o.age ?? 0, 0, def.duration ?? 8));
    if (o.visible && def.type === "code" && !o.range && def.highlight?.length) {
      const i = Math.min(def.highlight.length - 1, Math.floor(progress(o.age ?? 0, 0, def.duration ?? 8) * def.highlight.length));
      o.range = def.highlight[i];
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
      o.style = style; o.gap = num(e.args.gap, num(def.gap, .12)); o.age = t - e.start; o.born = e.start;
      // type/stagger reveal linearly (the renderer staggers words/children with its own curve); draw traces at an even pace
      o.reveal = (style === "type" || style === "stagger") && !easing ? p : style === "draw" && !easing ? ease(p, "inOutSine") : clamp01(k);
      o.visible = true; o.opacity = clamp01(p * 3);
      const variant = def.type === "KineticText" && e.args.style === undefined && def.style === undefined ? def.variant : undefined;
      if (variant === "slam") { o.scale = 1 + .6 * (1 - ease(p, "outExpo")); o.opacity = clamp01(p * 6); } // big -> 1x, no bounce
      else if (variant === "punch") o.scale = 1 + .5 * (1 - ease(p, "outBack")); // hits, dips just under 1x, settles
      else if (variant === "words" || variant === "stack") o.reveal = p; // the renderer reveals each word at its share
      else if (style === "pop") o.scale = .6 + .4 * ease(p, easing ?? "outBack");
      else if (style === "slide") {
        const edge = e.args.edge ?? "left", d = MOTION.slide * (1 - ease(p, easing ?? "outExpo"));
        if (edge === "left" || edge === "right") o.x += edge === "left" ? -d : d;
        else o.y += edge === "top" ? -d : d;
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
      if (e.args.snap !== undefined) { // computed component: blend from the previous snapshot while the step runs
        if (p < 1) { o.snapFrom = o.snap; o.snapP = ease(p, "inOutCubic"); } else { o.snapFrom = undefined; o.snapP = 1; }
        o.snap = e.args.snap;
      }
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
    case "highlight": {
      o.hl = Math.max(o.hl, pulse);
      const part = typeof e.args.row === "number" || typeof e.args.col === "number" || Array.isArray(e.args.range);
      if (pulse > 0) {
        if (typeof e.args.row === "number") o.row = e.args.row;
        if (typeof e.args.col === "number") o.col = e.args.col;
        if (Array.isArray(e.args.range)) o.range = e.args.range as [number, number];
      }
      // one scale punch when the highlight lands (whole-object highlights only), then hold: no looping wobble
      if (!part) o.scale *= 1 + MOTION.punch * Math.sin(Math.PI * ease((t - e.start) / MOTION.punchSec));
      break;
    }
    case "pulse": if (p < 1) o.pulse = p; break;
    case "pose": o.poseFrom = o.pose; o.pose = String(e.args.to); o.poseP = k; break;
    case "indicate": o.hl = Math.max(o.hl, pulse); o.ring = p < 1 ? p : 0; break;
  }
}

function applySlot(o: ObjState, i: number, e: TimelineEvent, p: number, pulse: number) {
  if (o.keyHl) { // keyed components: the slot is a position in the current snapshot; the highlight sticks to that item
    const k = (o.snap as SeqSnap).items[i]?.k;
    if (k && (e.verb === "highlight" || e.verb === "indicate")) o.keyHl[k] = Math.max(o.keyHl[k] ?? 0, pulse);
    return;
  }
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
    if (p < 1) { s.to = j; s.p = ease(p, "inOutCubic"); }
    else o.slots![j].value = (e.args.value ?? s.value) as Slot["value"]; // paired swap events land values simultaneously
  }
}

/** whip/push: the cleared frame leaves while the new one arrives. Offsets are stage widths, added to x (and kept in dx). */
function applyTransition(st: SceneState, type: string, p: number, start: number, exiting: Set<string>) {
  const whip = type !== "push", e = ease(p, whip ? "inOutCubic" : "outQuart");
  const out = -e, inc = 1 - e;
  if (whip) st.camera!.stretch = 1 + .5 * Math.sin(Math.PI * p) ** 2; // a horizontal smear that peaks with the speed
  for (const o of st.objects.values()) {
    if (exiting.has(o.id)) {
      if (o.exitFrom !== undefined) o.opacity = o.exitFrom;
      if (whip) o.opacity *= 1 - .7 * e;
      o.x += out; o.dx = out;
    } else if (o.visible && o.born !== undefined && o.born >= start - 1e-6) {
      if (whip) o.opacity *= .3 + .7 * e;
      o.x += inc; o.dx = inc;
    }
  }
}
