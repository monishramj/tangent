// shortcut: static bounds omit unknown or crowded layouts; add exact component bounds when more presenter coverage is needed.
// Conservative layout bounds: when geometry is unknown, omit the presenter rather than cover the lesson.
import { z } from "zod";
import { Pose, type SceneObject } from "./schema";
import { layoutScene, type LItem } from "../stage/layout";
import type { C } from "./tplkit";

export const Tangenter = z.object({ pose: Pose, poseTo: Pose.optional(), says: z.string().min(1).max(80).optional(), thinks: z.string().min(1).max(80).optional(), at: z.string().min(1).optional() });
export type Box = { x: number; y: number; w: number; h: number };
export const overlaps = (a: Box, b: Box) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

export function contentBoxes(objects: SceneObject[]): Box[] {
  const measure = (s: string, size: number) => s.length * size * .8;
  const placed = layoutScene(objects as LItem[], 1600, 900, measure);
  return objects.flatMap(o => {
    if (["texture", "mark"].includes(o.type)) return [];
    if (o.type === "arrow" || o.type === "line") {
      const endpoint = (v: unknown) => typeof v === "string" ? objects.find(o => o.id === v) : undefined;
      const pt = (v: unknown) => Array.isArray(v) ? { x: v[0], y: v[1] } : endpoint(v); // fixed endpoints have a known box
      const a = pt(o.from), b = pt(o.to);
      if (!a || !b) return [{ x: .5, y: .5, w: 1, h: 1 }];
      const ax = Number(a.x ?? .5), ay = Number(a.y ?? .5), bx = Number(b.x ?? .5), by = Number(b.y ?? .5);
      const pad = o.route === "curve" ? .25 : .06;
      return [{ x: (ax + bx) / 2, y: (ay + by) / 2, w: Math.abs(ax - bx) + pad, h: Math.abs(ay - by) + pad }];
    }
    const p = placed.get(o.id), x = Number(o.x ?? p?.x ?? .5), y = Number(o.y ?? p?.y ?? .5);
    if (o.type === "text" || o.type === "KineticText") {
      const lines = (p?.text ?? o.text).split("\n"), fs = (p?.fontSize ?? 54) / 900;
      const w = Math.max(...lines.map(l => measure(l, fs))) * 9 / 16;
      return [{ x: x + (o.align === "left" ? w / 2 : o.align === "right" ? -w / 2 : 0), y, w: w + .025, h: lines.length * fs * 1.15 + .025 }];
    }
    const size = Number(o.size ?? .38);
    if (["icon", "emoji", "person", "counter"].includes(o.type)) {
      const w = o.type === "counter" ? .9 : size * 9 / 16;
      return [{ x, y, w: w + .025, h: size + .08 }];
    }
    if (typeof o.width === "number" && typeof o.height === "number") return [{ x, y, w: o.width + .025, h: o.height + .04 }];
    return [{ x: .5, y: .5, w: 1, h: 1 }];
  });
}

export type Presenter = { id: string; x: number };
export function addTangenter(c: C, d: z.infer<typeof Tangenter>, content: SceneObject[], previous?: Presenter): Presenter | undefined {
  const boxes = contentBoxes(content);
  const band = (x: number): Box => ({ x, y: .835, w: .09, h: .3 });
  const score = (x: number) => boxes.filter(b => overlaps(band(x), b)).length;
  const sides = previous ? [previous.x] : [.06, .94].sort((a, b) => score(a) - score(b));
  const x = sides.find(x => score(x) === 0);
  if (x === undefined) return;
  const key = content.find(o => o.id === c.keyId) ?? content.find(o => !["text", "texture", "mark", "arrow", "line"].includes(o.type)) ?? content[0];
  const aim = key && [Number(key.x ?? .5), Number(key.y ?? .5)];
  const when = c.anchor(.55, d.at);
  const immediate = when.startsWith("@") ? Math.floor(Number(when.slice(1)) * c.say.split(/\s+/).length) === 0 : c.say.toLowerCase().startsWith(when.toLowerCase());
  const pose = immediate ? d.poseTo ?? d.pose : d.pose;
  const id = previous?.id ?? c.add({ id: c.id("tangenter"), type: "person", tangenter: true, pose, aim, facing: x < .5 ? "right" : "left", x, y: .85, size: .22 }, "@0", { style: "pop", duration: .45 });
  if (previous) c.act({ at: "@0", do: "pose", target: id, to: pose, aim, duration: .35 });
  if (d.poseTo && !immediate) c.act({ at: when, do: "pose", target: id, to: d.poseTo, aim, duration: .45 });
  const text = d.says ?? d.thinks;
  if (text) {
    const words = { id: "words", type: "text", text, x: x < .5 ? .17 : .83, y: .64, size: .027, maxW: .24 } as SceneObject;
    const height = Math.max(.1, contentBoxes([words])[0].h + .025);
    const bubble = { x: Number(words.x), y: .69 - height / 2, w: .28, h: height + .035 };
    if (!boxes.some(b => overlaps(bubble, b))) {
      c.add({ id: c.id("tangenter_bubble"), type: "shape", shape: d.says ? "bubble" : "thought", x: bubble.x, y: bubble.y, width: bubble.w, height, tail: d.says ? x < .5 ? "left" : "right" : undefined }, when, { style: "draw", duration: .25 });
      c.add({ id: c.id("tangenter_words"), type: "text", text, x: bubble.x, y: bubble.y, size: .027, maxW: .24, opacity: 1 }, when, { style: "type", duration: .8 });
    }
  }
  return { id, x };
}
