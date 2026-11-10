// Shared template helpers: slot fragments, the expansion context (ids, anchors, objects/actions), reveal spreading.
import { z } from "zod";
import { Transition, type SceneObject } from "./schema";
import { TYPE } from "../stage/motion";

export const s = z.string().min(1);
export const visual = { icon: s.optional(), emoji: s.max(16).optional() };
export const at = { at: s.optional() };
export const ident = z.string().regex(/^[A-Za-z_][\w-]*$/);
export const Op = z.object({ op: s, args: z.array(z.unknown()).default([]), ...at });

export const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const occurrences = (say: string, phrase: string) => [...say.matchAll(new RegExp(`(?<![\\w'])${esc(phrase)}(?![\\w'])`, "gi"))].length;
export const frac = (f: number) => `@${Math.min(1, Math.max(0, f)).toFixed(3).replace(/\.?0+$/, "") || "0"}`;
export const TRANSITIONS: z.infer<typeof Transition>[] = ["whip", "push", "cut", "whip"];

export type Ctx = { b: number; say: string; objects: SceneObject[]; actions: unknown[]; ids: Set<string> };

export function ctx(b: number, say: string, ids: Set<string>): Ctx & {
  id(base: string): string; anchor(f: number, phrase?: string): string;
  add(o: Record<string, unknown>, when: string, create?: Record<string, unknown>): string; act(a: Record<string, unknown>): void;
  key(id: string): string; keyId?: string;
} {
  const c = { b, say, objects: [] as SceneObject[], actions: [] as unknown[], ids };
  return {
    ...c,
    id(base) { let id = base, n = 2; while (ids.has(id)) id = `${base}_${n++}`; ids.add(id); return id; },
    anchor(f, phrase) { return phrase && occurrences(say, phrase) === 1 ? phrase : frac(f); },
    add(o, when, create = {}) {
      if (o.type === "text" && typeof o.size === "number" && o.size < TYPE.caption) o.size = TYPE.caption; // type-scale floor: nothing smaller than a caption
      c.objects.push(o as SceneObject); c.actions.push({ at: when, do: "create", target: o.id, ...create }); return o.id as string; },
    act(a) { c.actions.push(a); },
    key(id) { if (!this.keyId) this.keyId = id; return id; }, keyId: undefined as string | undefined,
    get objects() { return c.objects; }, get actions() { return c.actions; },
  };
}
export type C = ReturnType<typeof ctx>;
/** n evenly spread reveal anchors over [from, to] of the beat. */
export const spread = (n: number, from = 0, to = .7) => Array.from({ length: n }, (_, i) => n === 1 ? from : from + (to - from) * i / (n - 1));

export function visualAt(c: C, base: string, v: { icon?: string; emoji?: string }, x: number, y: number, size: number, when: string, label?: string) {
  // icons are drawn on stroke by stroke (pen pace); colour emoji can't be traced, so they land with the soft settle
  if (v.emoji) return c.add({ id: c.id(base), type: "emoji", char: v.emoji, x, y, size, label }, when, { style: "pop" });
  if (v.icon) return c.add({ id: c.id(base), type: "icon", name: v.icon, x, y, size, label }, when, { style: "draw", duration: .5 });
  return undefined;
}


/** Anchors for actions on ONE object that must land on strictly increasing words (ops, steps): phrase if it occurs once
 * and comes after the previous anchor, else a fraction anchor on the next free word. */
export function orderedAnchors(say: string, fs: number[], phrases: (string | undefined)[]): string[] {
  const words = say.split(/\s+/).filter(Boolean), n = Math.max(1, words.length);
  let prev = -1;
  return fs.map((f, i) => {
    const ph = phrases[i], hit = ph && occurrences(say, ph) === 1 ? say.slice(0, say.search(new RegExp(`(?<![\\w'])${esc(ph)}(?![\\w'])`, "i"))).split(/\s+/).filter(Boolean).length : -1;
    if (hit > prev) { prev = hit; return ph!; }
    const w = Math.min(n - 1, Math.max(prev + 1, Math.floor(f * n)));
    prev = w;
    return frac((w + .5) / n);
  });
}

/** A short hand-drawn tick from a label toward the thing it names, drawn on with the label: pointed at, not floating. */
export const leader = (c: C, base: string, from: [number, number], to: [number, number], when: string) =>
  c.add({ id: c.id(base), type: "line", from, to, points: [from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - .006], to] }, when, { style: "draw", duration: .3 });

/** Frame heading in the title size, with the house detail under it: a short hand-drawn tick, drawn on after the words. */
export function heading(c: C, base: string, title: string, y = .1, o: Record<string, unknown> = {}) {
  const id = c.add({ id: c.id(base), type: "text", text: title, x: .5, y, size: TYPE.title, weight: "bold", opacity: 1, maxW: .84, ...o }, frac(0), { style: "type" });
  const ty = y + TYPE.title * .78;
  c.add({ id: c.id(`${base}_tick`), type: "line", from: [.468, ty], to: [.532, ty], points: [[.468, ty + .003], [.489, ty - .002], [.511, ty + .002], [.532, ty - .003]] }, frac(0), { style: "draw", duration: .3 });
  return id;
}
