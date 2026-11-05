// Second-wave templates: layouts for definitions, timelines, processes, comparisons, course visuals (matrix, distribution,
// pipeline, encoding) and the computed components (stack, queue, linked list, graph). Same contract as templates.ts:
// the LLM fills short slots; positions, sizes and timing are decided here. Numbers shown on screen are computed here.
import { z } from "zod";
import { Pose, type Action, type SceneObject } from "./schema";
import { expandOp } from "./ops";
import { area, numberlineX, type Dist } from "./stats";
import { type C, Op, at, frac, ident, orderedAnchors, s, spread, visual, visualAt } from "./tplkit";

const Visual = z.object({ label: s, ...visual });
const Ops = z.array(Op).max(4).default([]);
const val = z.union([z.number(), z.string().min(1).max(12)]);
const num = z.number().finite();

export const VOCAB_TEMPLATES = {
  timeline: z.object({ title: s.optional(), events: z.array(z.object({ date: s, text: s, ...visual, ...at })).min(2).max(6) }),
  definition: z.object({ term: s, meaning: s, example: s.optional(), kind: s.optional() }),
  analogy: z.object({ left: Visual, right: Visual, relation: s.default("is like"), note: s.optional() }),
  steps: z.object({ title: s.optional(), steps: z.array(z.object({ text: s, sub: s.optional(), ...visual, ...at })).min(2).max(5) }),
  procon: z.object({ title: s.optional(), pros: z.array(s).min(1).max(4), cons: z.array(s).min(1).max(4), proLabel: s.default("PROS"), conLabel: s.default("CONS") }),
  quote: z.object({ text: s, by: s.optional() }),
  hook: z.object({ question: s, sub: s.optional(), pose: Pose.default("confused"), ...visual }),
  checklist: z.object({ title: s.optional(), items: z.array(z.object({ text: s, done: z.boolean().default(true), ...at })).min(2).max(6) }),
  numberline: z.object({ title: s.optional(), min: num, max: num, step: z.number().positive().optional(),
    points: z.array(z.object({ value: num, label: s.optional(), open: z.boolean().optional(), ...at })).max(4).default([]),
    intervals: z.array(z.object({ from: num, to: num, label: s.optional(), openFrom: z.boolean().optional(), openTo: z.boolean().optional(), ...at })).max(2).default([]) }),
  venn: z.object({ title: s.optional(), sets: z.array(z.object({ label: s, items: z.array(s).max(3).default([]) })).min(2).max(3), both: z.array(s).max(3).default([]) }),
  matrix: z.object({ label: s.optional(), rows: z.array(z.array(val).min(1).max(5)).min(1).max(5), vector: z.array(num).max(5).optional(),
    highlight: z.object({ row: z.number().int().min(0).optional(), col: z.number().int().min(0).optional() }).optional() }),
  distribution: z.object({ kind: z.enum(["normal", "uniform", "binomial"]), mean: num.default(0), sd: z.number().positive().default(1), min: num.default(0), max: num.default(1),
    n: z.number().int().min(1).max(40).default(10), p: z.number().min(0).max(1).default(.5), a: num.optional(), b: num.optional(), label: s.optional() }),
  pipeline: z.object({ instructions: z.array(s).min(2).max(5), stages: z.array(s.max(5)).min(3).max(6).default(["IF", "ID", "EX", "MEM", "WB"]),
    stall: z.object({ instr: z.number().int().min(1), cycles: z.number().int().min(1).max(2) }).optional() }),
  encoding: z.object({ word: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).default(32), instr: s.optional(),
    fields: z.array(z.object({ name: s, bits: z.number().int().min(1).max(64), value: z.union([num, z.string().regex(/^[01]+$/)]).optional() })).min(2).max(8) }),
  stack: z.object({ id: ident.default("stk"), label: s.optional(), values: z.array(val).max(8).default([]), ops: Ops }),
  queue: z.object({ id: ident.default("q"), label: s.optional(), values: z.array(val).max(8).default([]), ops: Ops }),
  linkedlist: z.object({ id: ident.default("list"), label: s.optional(), values: z.array(val).max(7).default([]), ops: Ops }),
  graph: z.object({ id: ident.default("g"), label: s.optional(), directed: z.boolean().default(false),
    nodes: z.array(z.object({ id: ident, label: s.max(6).optional() })).min(2).max(10),
    edges: z.array(z.union([z.tuple([ident, ident]), z.tuple([ident, ident, num])])).max(20), ops: z.array(Op).max(2).default([]) }),
} as const;
type V = typeof VOCAB_TEMPLATES;
export const VOCAB_VARIANTS: Record<keyof V, string[]> = {
  timeline: ["line", "vertical"], definition: ["card", "dictionary", "center"], analogy: ["arrow", "equals", "bridge"], steps: ["cards", "ladder", "vertical"],
  procon: ["columns", "cards"], quote: ["center", "side"], hook: ["big", "character", "split"], checklist: ["column", "cards"], numberline: ["line", "focus"],
  venn: ["classic", "focus"], matrix: ["grid", "multiply"], distribution: ["shade", "curve"], pipeline: ["diagram", "stages"], encoding: ["fields", "bits"],
  stack: ["plain", "log"], queue: ["plain", "log"], linkedlist: ["plain", "log"], graph: ["circle", "layered"],
};

const AR = 9 / 16; // a width that is d stage-heights wide, as a fraction of stage width: d * AR
const text = (c: C, base: string, t: string, x: number, y: number, size: number, when: string, o: Record<string, unknown> = {}) =>
  c.add({ id: c.id(base), type: "text", text: t, x, y, size, ...o }, when, { style: "type" });
const head = (c: C, title: string | undefined, y = .1) => title ? c.key(text(c, "title", title, .5, y, .05, frac(0), { weight: "bold", opacity: 1, maxW: .8 })) : undefined;
const dot = (c: C, base: string, x: number, y: number, d: number, when: string, filled = true, label?: string) =>
  c.add({ id: c.id(base), type: "shape", shape: "circle", x, y, width: d * AR, height: d, filled, label }, when, { style: "pop" });
const opLabel = (o: { op: string; args: unknown[] }) => `${o.op}(${o.args.map(a => typeof a === "string" ? a : String(a)).join(", ")})`;

/** Computed component templates: run the ops now (errors surface per beat; the max length sizes the layout). */
function component(c: C, type: "Stack" | "Queue" | "LinkedList", d: { id: string; label?: string; values: (string | number)[]; ops: { op: string; args: unknown[]; at?: string }[] }, v: string) {
  let sim = { id: d.id, type, init: d.values } as SceneObject, cap = d.values.length;
  for (const o of d.ops) {
    sim = expandOp(sim, { at: "@0", do: "op", target: d.id, op: o.op, args: o.args } as Action).object as SceneObject;
    cap = Math.max(cap, ((sim as { _items?: unknown[] })._items ?? []).length);
  }
  const log = v === "log", x = log ? .4 : .5;
  const id = c.key(c.add({ id: c.id(d.id), type, init: d.values, label: d.label, cap: Math.max(cap, type === "Stack" ? 4 : 3), x, y: .54, width: log ? .62 : .8, height: .68 }, frac(0), { style: "stagger" }));
  const when = orderedAnchors(c.say, spread(d.ops.length, .25, .72), d.ops.map(o => o.at));
  d.ops.forEach((o, i) => {
    c.act({ at: when[i], do: "op", target: id, op: o.op, args: o.args });
    if (log) text(c, `${d.id}_log`, opLabel(o), .8, .3 + i * .1, .042, when[i], { mono: true, opacity: .85, align: "left", maxW: .2 });
  });
  if (log) text(c, `${d.id}_logh`, "ops", .8, .2, .03, frac(0), { opacity: .5, align: "left" });
}

export const VOCAB_EXPAND: { [K in keyof V]: (c: C, d: z.infer<V[K]>, v: string) => void } = {
  timeline(c, d, v) {
    head(c, d.title);
    const n = d.events.length, when = spread(n, .08, .8).map((f, i) => c.anchor(f, d.events[i].at));
    if (v === "vertical") {
      const y0 = d.title ? .24 : .14, y1 = .88, ax = .34;
      c.add({ id: c.id("tl_axis"), type: "line", from: [ax, y0 - .04], to: [ax, y1 + .04] }, frac(0), { style: "draw", duration: 1 });
      d.events.forEach((e, i) => {
        const y = y0 + (y1 - y0) * i / (n - 1);
        dot(c, `tl_dot${i}`, ax, y, .034, when[i]);
        text(c, `tl_date${i}`, e.date, ax - .04, y, .045, when[i], { weight: "bold", opacity: 1, align: "right", maxW: .26 });
        text(c, `tl_text${i}`, e.text, ax + .04, y, .04, when[i], { align: "left", maxW: .5, opacity: .85 });
        visualAt(c, `tl_v${i}`, e, .9, y, Math.min(.1, (y1 - y0) / n * .9), when[i]);
      });
      return;
    }
    const y = .56, x0 = .12, x1 = .88, gap = (x1 - x0) / (n - 1);
    c.add({ id: c.id("tl_axis"), type: "arrow", from: [.05, y], to: [.95, y] }, frac(0), { style: "draw", duration: 1 });
    d.events.forEach((e, i) => {
      const x = x0 + gap * i, up = n > 4 && i % 2 === 1, mw = Math.min(.26, gap * (n > 4 ? 1.8 : .95));
      dot(c, `tl_dot${i}`, x, y, .036, when[i]);
      text(c, `tl_date${i}`, e.date, x, up ? y + .08 : y - .08, .045, when[i], { weight: "bold", opacity: 1, maxW: mw });
      text(c, `tl_text${i}`, e.text, x, up ? y + .17 : y + .1, .034, when[i], { maxW: mw, opacity: .8 });
      visualAt(c, `tl_v${i}`, e, x, up ? y - .14 : y - .2, .09, when[i]);
    });
  },
  definition(c, d, v) {
    if (v === "dictionary") {
      c.key(text(c, "def_term", d.term, .12, .3, .11, frac(0), { weight: "bold", opacity: 1, align: "left", maxW: .76 }));
      if (d.kind) text(c, "def_kind", `/ ${d.kind} /`, .12, .41, .036, frac(.08), { align: "left", opacity: .5 });
      c.add({ id: c.id("def_rule"), type: "line", from: [.12, .47], to: [.88, .47] }, frac(.12), { style: "draw", duration: .5 });
      text(c, "def_meaning", d.meaning, .12, .58, .05, frac(.2), { align: "left", maxW: .76, opacity: .95 });
      if (d.example) text(c, "def_ex", `→ ${d.example}`, .12, .76, .038, c.anchor(.6, d.example), { align: "left", maxW: .76, opacity: .6 });
      return;
    }
    const card = v === "card";
    if (card) c.add({ id: c.id("def_card"), type: "shape", shape: "rect", x: .5, y: .52, width: .74, height: .68 }, frac(0), { style: "draw", duration: .6 });
    c.key(c.add({ id: c.id("def_term"), type: "KineticText", text: d.term, variant: card ? "words" : "slam", x: .5, y: card ? .34 : .36, size: card ? .085 : .14, maxW: .66 }, frac(.05)));
    if (d.kind) text(c, "def_kind", d.kind, .5, card ? .25 : .2, .032, frac(.05), { opacity: .5 });
    if (card) c.add({ id: c.id("def_rule"), type: "line", from: [.3, .42], to: [.7, .42] }, frac(.15), { style: "draw", duration: .4 });
    text(c, "def_meaning", d.meaning, .5, card ? .56 : .6, .048, frac(.2), { maxW: .64, opacity: .95 });
    if (d.example) text(c, "def_ex", `e.g. ${d.example}`, .5, card ? .74 : .78, .036, c.anchor(.6, d.example), { maxW: .64, opacity: .6 });
  },
  analogy(c, d, v) {
    const side = (it: z.infer<typeof Visual>, x: number, when: string, base: string) =>
      visualAt(c, base, it, x, .44, .24, when, undefined) ?? c.add({ id: c.id(base), type: "shape", shape: "pill", label: it.label, x, y: .44, width: .26, height: .18 }, when, { style: "draw", duration: .5 });
    const a = side(d.left, .24, frac(0), "an_left"), b = side(d.right, .76, frac(.4), "an_right");
    if (d.left.icon || d.left.emoji) text(c, "an_left_t", d.left.label, .24, .66, .05, frac(.05), { weight: "bold", opacity: 1, maxW: .3 });
    if (d.right.icon || d.right.emoji) c.key(text(c, "an_right_t", d.right.label, .76, .66, .05, frac(.45), { weight: "bold", opacity: 1, maxW: .3 }));
    else c.key(b);
    if (v === "equals") {
      c.add({ id: c.id("an_eq"), type: "KineticText", text: "≈", variant: "punch", x: .5, y: .44, size: .16 }, frac(.3));
      text(c, "an_rel", d.relation, .5, .58, .036, frac(.3), { opacity: .6 });
    } else c.add({ id: c.id("an_arrow"), type: "arrow", from: a, to: b, label: d.relation, route: v === "bridge" ? "curve" : "straight", dashed: v === "bridge" || undefined }, frac(.3), { style: "draw", duration: .6 });
    if (d.note) text(c, "an_note", d.note, .5, .86, .036, frac(.65), { opacity: .6, maxW: .8 });
  },
  steps(c, d, v) {
    head(c, d.title);
    const n = d.steps.length, when = spread(n, .06, .78).map((f, i) => c.anchor(f, d.steps[i].at)), ids: string[] = [];
    d.steps.forEach((st, i) => {
      if (v === "vertical") {
        const y0 = d.title ? .26 : .16, y = y0 + (.86 - y0) * i / Math.max(1, n - 1);
        ids.push(dot(c, `step${i}`, .22, y, .085, when[i], true, String(i + 1)));
        text(c, `step${i}_t`, st.text, .29, st.sub ? y - .025 : y, .046, when[i], { align: "left", maxW: .58, opacity: 1, weight: "bold" });
        if (st.sub) text(c, `step${i}_s`, st.sub, .29, y + .035, .032, when[i], { align: "left", maxW: .58, opacity: .6 });
        visualAt(c, `step${i}_v`, st, .86, y, .08, when[i]);
        if (i > 0) c.add({ id: c.id(`step${i}_e`), type: "line", from: ids[i - 1], to: ids[i] }, when[i], { style: "draw", duration: .3 });
      } else if (v === "ladder") {
        const x = .17 + .66 * i / Math.max(1, n - 1), y = .78 - .5 * i / Math.max(1, n - 1);
        ids.push(c.add({ id: c.id(`step${i}`), type: "shape", shape: "rect", label: st.text, sublabel: st.sub, x, y, width: Math.min(.2, .62 / n), height: .14 }, when[i], { style: "draw", duration: .5 }));
        c.add({ id: c.id(`step${i}_n`), type: "text", text: String(i + 1), x, y: y - .12, size: .05, weight: "bold", opacity: .55 }, when[i], { style: "pop" });
        if (i > 0) c.add({ id: c.id(`step${i}_e`), type: "arrow", from: ids[i - 1], to: ids[i], route: "elbow" }, when[i], { style: "draw", duration: .35 });
      } else {
        const cw = Math.min(.21, .86 / n - .025), x = .5 + (i - (n - 1) / 2) * (cw + .025), y = .56;
        ids.push(c.add({ id: c.id(`step${i}`), type: "shape", shape: "rect", x, y, width: cw, height: .5 }, when[i], { style: "draw", duration: .5 }));
        const vis = !!(st.icon || st.emoji);
        c.add({ id: c.id(`step${i}_n`), type: "KineticText", text: String(i + 1), variant: "punch", x, y: y - .15, size: .1 }, when[i]);
        visualAt(c, `step${i}_v`, st, x, y - .03, .07, when[i]);
        text(c, `step${i}_t`, st.text, x, y + (vis ? .08 : .04), .036, when[i], { maxW: cw * .86, opacity: 1, weight: "bold" });
        if (st.sub) text(c, `step${i}_s`, st.sub, x, y + (vis ? .17 : .15), .028, when[i], { maxW: cw * .86, opacity: .6 });
      }
    });
    c.key(ids[n - 1]);
  },
  procon(c, d, v) {
    head(c, d.title);
    const top = d.title ? .26 : .2, cols = [[d.proLabel, d.pros, .27, "check"], [d.conLabel, d.cons, .73, "cross"]] as const;
    const all = d.pros.length + d.cons.length, when = spread(all + 2, .05, .82);
    let k = 0;
    if (v === "columns") c.add({ id: c.id("pc_div"), type: "line", from: [.5, top - .04], to: [.5, .9] }, frac(0), { style: "draw", duration: .6 });
    cols.forEach(([label, items, x, mark], side) => {
      const t0 = frac(when[k++]);
      if (v === "cards") c.add({ id: c.id(`pc_card${side}`), type: "shape", shape: "rect", x, y: (top + .9) / 2 + .02, width: .42, height: .9 - top + .08 }, t0, { style: "draw", duration: .6 });
      text(c, `pc_head${side}`, label, x, top + .03, .045, t0, { weight: "bold", opacity: 1 });
      items.forEach((it, i) => {
        const y = top + .15 + i * Math.min(.15, .56 / items.length), t = frac(when[k++]);
        c.add({ id: c.id(`pc_m${side}_${i}`), type: "shape", shape: mark, x: x - .16, y, width: .035 * AR * 1.4, height: .045 }, t, { style: "draw", duration: .35 });
        text(c, `pc_i${side}_${i}`, it, x - .12, y, .038, t, { align: "left", maxW: .3, opacity: .9 });
      });
    });
  },
  quote(c, d, v) {
    if (v === "side") {
      c.add({ id: c.id("q_bar"), type: "line", from: [.14, .3], to: [.14, .7] }, frac(0), { style: "draw", duration: .5 });
      c.key(text(c, "q_text", d.text, .18, .48, .06, frac(.05), { align: "left", maxW: .68, opacity: 1, weight: "bold" }));
      if (d.by) text(c, "q_by", `— ${d.by}`, .18, .76, .036, frac(.6), { align: "left", opacity: .6 });
      return;
    }
    c.add({ id: c.id("q_mark"), type: "text", text: "“", x: .5, y: .24, size: .26, weight: "bold", opacity: .3 }, frac(0), { style: "pop" });
    c.key(c.add({ id: c.id("q_text"), type: "KineticText", text: d.text, variant: "words", x: .5, y: .52, size: .07, maxW: .76 }, frac(.05)));
    if (d.by) text(c, "q_by", `— ${d.by}`, .5, .8, .036, frac(.6), { opacity: .6 });
  },
  hook(c, d, v) {
    if (v === "character") {
      c.add({ id: c.id("hook_person"), type: "person", pose: d.pose, facing: "right", x: .24, y: .64, size: .5 }, frac(0), { style: "draw", duration: .6 });
      c.key(c.add({ id: c.id("hook_q"), type: "shape", shape: "thought", label: d.question, x: .6, y: .32, width: .5, height: .4 }, frac(.15), { style: "draw", duration: .6 }));
      c.act({ at: frac(.5), do: "camera", shake: .015, duration: .35 });
      if (d.sub) text(c, "hook_sub", d.sub, .6, .6, .036, frac(.6), { opacity: .6, maxW: .4 });
      return;
    }
    const split = v === "split";
    if (split) c.add({ id: c.id("hook_mark"), type: "KineticText", text: "?", variant: "punch", x: .25, y: .5, size: .55 }, frac(0));
    else c.add({ id: c.id("hook_mark"), type: "text", text: "?", x: .5, y: .44, size: .8, weight: "bold", opacity: .07 }, frac(0), { style: "pop", duration: .5 });
    c.key(c.add({ id: c.id("hook_q"), type: split ? "text" : "KineticText", text: d.question, variant: "words", weight: "bold", x: split ? .5 : .5, y: split ? .46 : .46, size: split ? .075 : .1, maxW: split ? .44 : .8, align: split ? "left" : undefined, opacity: 1 }, frac(.08), split ? { style: "type" } : {}));
    visualAt(c, "hook_v", d, split ? .62 : .5, split ? .22 : .2, .12, frac(.45));
    c.act({ at: frac(.45), do: "camera", shake: .02, duration: .35 });
    if (d.sub) text(c, "hook_sub", d.sub, split ? .5 : .5, split ? .66 : .8, .04, frac(.55), { opacity: .6, maxW: split ? .44 : .8, align: split ? "left" : undefined });
  },
  checklist(c, d, v) {
    head(c, d.title);
    const n = d.items.length, top = d.title ? .26 : .18, when = spread(n, .15, .85).map((f, i) => c.anchor(f, d.items[i].at));
    const grid = v === "cards", cols = grid && n > 3 ? 2 : 1, rows = Math.ceil(n / cols);
    d.items.forEach((it, i) => {
      const col = grid ? Math.floor(i / rows) : 0, row = grid ? i % rows : i;
      const x = grid ? (cols === 1 ? .5 : .28 + .44 * col) : .2, y = top + .06 + row * Math.min(.14, (.88 - top) / rows);
      const bx = grid ? x - .17 : x;
      if (grid) c.add({ id: c.id(`ck_card${i}`), type: "shape", shape: "pill", x, y, width: .4, height: Math.min(.11, (.88 - top) / rows * .8) }, frac(.03 * i), { style: "draw", duration: .5 });
      c.add({ id: c.id(`ck_box${i}`), type: "shape", shape: grid ? "circle" : "rect", x: bx, y, width: .05 * AR, height: .05 }, frac(.03 * i), { style: "draw", duration: .35 });
      text(c, `ck_t${i}`, it.text, bx + .04, y, .04, frac(.03 * i + .02), { align: "left", maxW: grid ? .3 : .62, opacity: .9 });
      c.add({ id: c.id(`ck_m${i}`), type: "shape", shape: it.done ? "check" : "cross", x: bx, y: y - .005, width: .04 * AR, height: .04 }, when[i], { style: "draw", duration: .3 });
    });
  },
  numberline(c, d, v) {
    if (d.max <= d.min) throw new Error("numberline needs min < max");
    const step = d.step ?? niceStep(d.max - d.min);
    if ((d.max - d.min) / step > 24) throw new Error("too many ticks: raise step");
    const inRange = (x: number) => x >= d.min && x <= d.max;
    for (const p of d.points) if (!inRange(p.value)) throw new Error(`point ${p.value} is outside ${d.min}..${d.max}`);
    for (const r of d.intervals) if (!inRange(r.from) || !inRange(r.to) || r.from > r.to) throw new Error(`interval ${r.from}..${r.to} must be ordered and inside ${d.min}..${d.max}`);
    head(c, d.title);
    const line = { min: d.min, max: d.max, x: .5, width: .84 }, y = .56, X = (x: number) => numberlineX(line, x);
    c.add({ id: c.id("nl"), type: "numberline", min: d.min, max: d.max, step, x: .5, y, width: .84 }, frac(0), { style: "draw", duration: 1 });
    const marks: { r?: (typeof d.intervals)[number]; p?: (typeof d.points)[number] }[] = [...d.intervals.map(r => ({ r })), ...d.points.map(p => ({ p }))];
    const when = spread(marks.length, .3, .8).map((f, i) => c.anchor(f, (marks[i].r ?? marks[i].p)!.at));
    marks.forEach((m, i) => {
      if (m.r) {
        const r = m.r, x0 = X(r.from), x1 = X(r.to);
        c.key(c.add({ id: c.id(`nl_int${i}`), type: "shape", shape: "pill", x: (x0 + x1) / 2, y, width: Math.max(.01, x1 - x0), height: .028, filled: true }, when[i], { style: "draw", duration: .5 }));
        dot(c, `nl_a${i}`, x0, y, .04, when[i], !r.openFrom); dot(c, `nl_b${i}`, x1, y, .04, when[i], !r.openTo);
        if (r.label) text(c, `nl_il${i}`, r.label, (x0 + x1) / 2, y - .09, .04, when[i], { weight: "bold", opacity: 1, maxW: .4 });
      } else {
        const p = m.p!, x = X(p.value);
        c.key(dot(c, `nl_p${i}`, x, y, .045, when[i], !p.open));
        if (p.label) text(c, `nl_pl${i}`, p.label, x, y - .09, .04, when[i], { weight: "bold", opacity: 1, maxW: .2 });
      }
    });
    if (v === "focus" && marks.length) {
      const m = marks[0], cx = m.r ? (X(m.r.from) + X(m.r.to)) / 2 : X(m.p!.value);
      c.act({ at: frac(.85), do: "camera", x: cx, y: y - .02, zoom: 1.15, duration: .8, easing: "outExpo" });
    }
  },
  venn(c, d, v) {
    head(c, d.title, .08);
    const three = d.sets.length === 3, D = three ? .48 : .6;
    const centers: [number, number][] = three ? [[.42, .42], [.58, .42], [.5, .66]] : [[.39, .55], [.61, .55]];
    const out: [number, number][] = three ? [[-.13, -.06], [.13, -.06], [0, .14]] : [[-.11, 0], [.11, 0]];
    const circles: string[] = [];
    d.sets.forEach((st, i) => {
      const [x, y] = centers[i], f = frac(.05 + .2 * i);
      circles[i] = c.add({ id: c.id(`venn${i}`), type: "shape", shape: "circle", ghost: true, x, y, width: D * AR, height: D }, f, { style: "draw", duration: .6 });
      const lx = x + out[i][0] * (three ? 1.6 : 1.5), ly = three ? (i < 2 ? y - D / 2 - .04 : y + D / 2 + .04) : y - D / 2 - .05;
      text(c, `venn${i}_l`, st.label, three ? lx : x + out[i][0] * .9, ly, .045, f, { weight: "bold", opacity: 1, maxW: .24 });
      st.items.forEach((it, j) => text(c, `venn${i}_i${j}`, it, x + out[i][0], y + out[i][1] + (j - (st.items.length - 1) / 2) * .07, .032, frac(.12 + .2 * i + .05 * j), { maxW: three ? .12 : .16, opacity: .85 }));
    });
    const [ix, iy] = three ? [.5, .5] : [.5, .55];
    d.both.forEach((it, j) => {
      const id = text(c, `venn_both${j}`, it, ix, iy + (j - (d.both.length - 1) / 2) * .065, .032, frac(.65 + .06 * j), { maxW: three ? .09 : .1, opacity: 1, weight: "bold" });
      if (j === 0) c.key(id);
    });
    if (v === "focus") {
      circles.forEach(id => c.act({ at: frac(.82), do: "fade", target: id, to: .45 }));
      c.act({ at: frac(.8), do: "camera", x: ix, y: iy, zoom: 1.18, duration: .8, easing: "outExpo" });
    }
  },
  matrix(c, d, v) {
    const R = d.rows.length, C = d.rows[0].length;
    if (d.rows.some(r => r.length !== C)) throw new Error("matrix rows must have equal length");
    if (v !== "multiply" || !d.vector) {
      const m = c.key(c.add({ id: c.id("mat"), type: "matrix", rows: d.rows, label: d.label, x: .5, y: .52, cell: Math.min(.13, .6 / Math.max(R, C)) }, frac(0), { style: "stagger" }));
      const hl = d.highlight ?? { row: 0, col: 0 };
      if (hl.row !== undefined && hl.row < R) c.act({ at: frac(.35), do: "highlight", target: m, row: hl.row, duration: 1.2 });
      if (hl.col !== undefined && hl.col < C) c.act({ at: frac(.7), do: "highlight", target: m, col: hl.col, duration: 1.2 });
      return;
    }
    const vec = d.vector;
    if (vec.length !== C) throw new Error(`vector needs ${C} entries (one per matrix column)`);
    if (!d.rows.every(r => r.every(x => typeof x === "number"))) throw new Error("multiply needs numeric matrix entries");
    const M = d.rows as number[][], out = M.map(r => r.reduce((s2, x, j) => s2 + x * vec[j], 0)), round = (x: number) => Math.round(x * 1e4) / 1e4;
    const cell = Math.min(.11, .56 / Math.max(R, C));
    if (d.label) text(c, "mat_label", d.label, .5, .12, .04, frac(0), { opacity: .7 });
    const m = c.add({ id: c.id("mat"), type: "matrix", rows: M, x: .26, y: .5, cell }, frac(0), { style: "stagger" });
    text(c, "mat_x", "×", .26 + C * cell * AR * .75 + .05, .5, .06, frac(.05), { opacity: .7 });
    const vx = .26 + C * cell * AR * .75 + .12;
    const vm = c.add({ id: c.id("mat_v"), type: "matrix", rows: vec.map(x => [x]), x: vx, y: .5, cell }, frac(.08), { style: "stagger" });
    text(c, "mat_eq", "=", vx + .07, .5, .06, frac(.1), { opacity: .7 });
    const steps = spread(R, .25, .7);
    out.forEach((_, i) => {
      c.act({ at: frac(steps[i]), do: "highlight", target: m, row: i, duration: .9 });
      c.act({ at: frac(steps[i]), do: "highlight", target: vm, col: 0, duration: .9 });
      const sum = M[i].map((x, j) => `${x}·${vec[j]}`).join(" + ");
      const t = text(c, `mat_calc${i}`, `${sum} = ${round(out[i])}`, .5, .88, .038, frac(steps[i]), { mono: true, opacity: .8, maxW: .9 });
      if (i < R - 1) c.act({ at: frac(steps[i + 1]), do: "fade", target: t, to: 0, duration: .15 });
    });
    c.key(c.add({ id: c.id("mat_out"), type: "matrix", rows: out.map(x => [round(x)]), x: vx + .16, y: .5, cell }, frac(.78), { style: "stagger" }));
  },
  distribution(c, d, v) {
    const dist: Dist & { kind: typeof d.kind } = { kind: d.kind, mean: d.mean, sd: d.sd, min: d.min, max: d.max, n: d.n, p: d.p };
    if (d.kind === "uniform" && !(d.min < d.max)) throw new Error("uniform needs min < max");
    const params = d.kind === "normal" ? `μ = ${d.mean}, σ = ${d.sd}` : d.kind === "uniform" ? `uniform on [${d.min}, ${d.max}]` : `n = ${d.n}, p = ${d.p}`;
    const geo = { x: .5, y: .56, width: .74, height: .5 };
    if (d.label) text(c, "dist_label", d.label, .5, .1, .045, frac(0), { weight: "bold", opacity: 1 });
    c.add({ id: c.id("dist"), type: "distribution", ...dist, ...geo }, frac(0), { style: "draw", duration: 1.2 });
    text(c, "dist_params", params, .5, .9, .032, frac(.15), { opacity: .55, mono: true });
    if (v === "curve" || (d.a === undefined && d.b === undefined)) {
      if (v === "shade") throw new Error("shade needs a and/or b");
      return;
    }
    if (d.a !== undefined && d.b !== undefined && d.a > d.b) throw new Error("shaded range needs a <= b");
    c.add({ id: c.id("dist_area"), type: "distribution", ...dist, a: d.a, b: d.b, ...geo }, frac(.35), { style: "draw", duration: 1.2 });
    const P = area(dist, d.a, d.b), range = `${d.a ?? ""}${d.a !== undefined ? " ≤ " : ""}X${d.b !== undefined ? " ≤ " : ""}${d.b ?? ""}`;
    c.key(c.add({ id: c.id("dist_p"), type: "counter", from: 0, to: Math.round(P * 1000) / 1000, decimals: 3, prefix: `P(${range}) = `, x: .5, y: d.label ? .2 : .14, size: .075 }, frac(.45), { duration: 1.2 }));
  },
  pipeline(c, d, v) {
    const S = d.stages, n = d.instructions.length, stall = d.stall && d.stall.instr < n ? d.stall : undefined;
    // Real schedule: instruction i enters IF at cycle i; a stall holds `instr` after IF for `cycles` and delays every later one.
    const rows = d.instructions.map((_, i) => {
      const delay = stall && i >= stall.instr ? stall.cycles : 0, cells: { cycle: number; label: string }[] = [{ cycle: i + (stall && i > stall.instr ? delay : 0), label: S[0] }];
      if (stall && i === stall.instr) for (let k = 0; k < stall.cycles; k++) cells.push({ cycle: i + 1 + k, label: "stall" });
      S.slice(1).forEach((st, k) => cells.push({ cycle: i + delay + k + 1, label: st }));
      return cells;
    });
    const N = Math.max(...rows.flat().map(x => x.cycle)) + 1, when = spread(N, .04, .86).map(frac);
    if (v === "stages") {
      const gap = .8 / S.length, sx = (k: number) => .1 + gap * (k + .5);
      S.forEach((st, k) => c.add({ id: c.id(`pipe_s${k}`), type: "shape", shape: "rect", label: st, x: sx(k), y: .34, width: gap * .82, height: .16 }, frac(.02 * k), { style: "draw", duration: .5 }));
      for (let k = 0; k < S.length - 1; k++) c.add({ id: c.id(`pipe_e${k}`), type: "arrow", from: `pipe_s${k}`, to: `pipe_s${k + 1}` }, frac(.02 * k + .02), { style: "draw", duration: .3 });
      rows.forEach((cells, i) => {
        const tok = c.add({ id: c.id(`pipe_tok${i}`), type: "shape", shape: "pill", label: d.instructions[i], x: sx(0), y: .6, width: gap * .9, height: .1, filled: true }, when[cells[0].cycle], { style: "pop", duration: .25 });
        let stage = 0;
        cells.slice(1).forEach(cell => {
          if (cell.label === "stall") return;
          stage++;
          c.act({ at: when[cell.cycle], do: "move", target: tok, to: [sx(stage), .6], duration: .3, easing: "outCubic" });
        });
        const exit = cells[cells.length - 1].cycle + 1;
        if (exit < N) c.act({ at: when[exit], do: "fade", target: tok, to: .25, duration: .25 });
      });
      for (let k = 0; k < N; k++) {
        const t = text(c, `pipe_cyc${k}`, `cycle ${k + 1}`, .5, .84, .04, when[k], { mono: true, opacity: .7 });
        if (k < N - 1) c.act({ at: when[k + 1], do: "fade", target: t, to: 0, duration: .05 });
      }
      c.key(c.objects.find(o => o.type === "shape")!.id);
      return;
    }
    const x0 = .3, cw = Math.min(.08, .66 / N), top = .2, rh = Math.min(.13, .66 / (n + 1));
    for (let k = 0; k < N; k++) text(c, `pipe_h${k}`, String(k + 1), x0 + (k + .5) * cw, top, .03, when[k], { mono: true, opacity: .5 });
    rows.forEach((cells, i) => {
      const y = top + (i + 1) * rh;
      text(c, `pipe_i${i}`, d.instructions[i], .05, y, .034, frac(.01 * i), { mono: true, align: "left", maxW: x0 - .07, opacity: .9 });
      cells.forEach(cell => c.add({ id: c.id(`pipe_c${i}_${cell.cycle}`), type: "shape", shape: "rect", label: cell.label === "stall" ? "–" : cell.label, x: x0 + (cell.cycle + .5) * cw, y,
        width: cw * .9, height: rh * .78, filled: cell.label === S[S.length - 1] || undefined }, when[cell.cycle], { style: "pop", duration: .2 }));
    });
    c.key(c.objects.find(o => o.type === "text" && o.mono && o.align === "left")!.id);
  },
  encoding(c, d, v) {
    const total = d.fields.reduce((a, f) => a + f.bits, 0);
    if (total !== d.word) throw new Error(`field widths sum to ${total}, need ${d.word}`);
    const bin = d.fields.map(f => {
      if (f.value === undefined) return undefined;
      if (typeof f.value === "string") { if (f.value.length !== f.bits) throw new Error(`${f.name}: "${f.value}" is not ${f.bits} bits`); return f.value; }
      if (!Number.isInteger(f.value) || f.value < 0 || f.value >= 2 ** f.bits) throw new Error(`${f.name}: ${f.value} does not fit in ${f.bits} bits`);
      return f.value.toString(2).padStart(f.bits, "0");
    });
    if (d.instr) c.key(text(c, "enc_instr", d.instr, .5, .18, .06, frac(0), { mono: true, weight: "bold", opacity: 1, maxW: .86 }));
    const W = .88, when = spread(d.fields.length, .1, .78);
    let hi = d.word - 1, x = .06;
    d.fields.forEach((f, i) => {
      const w = W * f.bits / d.word, cx = x + w / 2, t = frac(when[i]), bits = v === "bits" && bin[i];
      c.add({ id: c.id(`enc_f${i}`), type: "shape", shape: "rect", label: bits || f.name, x: cx, y: .5, width: w * .97, height: .16 }, t, { style: "draw", duration: .45 });
      const lo = hi - f.bits + 1;
      text(c, `enc_r${i}`, f.bits === 1 ? `${hi}` : `${hi}–${lo}`, cx, .38, .026, t, { mono: true, opacity: .5, maxW: w * .95 });
      text(c, `enc_w${i}`, bits ? f.name : bin[i] ? bin[i]! : `${f.bits} bit${f.bits > 1 ? "s" : ""}`, cx, .63, .028, t, { mono: !!bin[i] && !bits, opacity: .7, maxW: w * .95 });
      hi = lo - 1; x += w;
    });
    text(c, "enc_word", `${d.word}-bit word`, .5, .78, .032, frac(.85), { opacity: .5 });
  },
  stack(c, d, v) { component(c, "Stack", d, v); },
  queue(c, d, v) { component(c, "Queue", d, v); },
  linkedlist(c, d, v) { component(c, "LinkedList", d, v); },
  graph(c, d, v) {
    const ids = new Set(d.nodes.map(n => n.id));
    const edges = d.edges.map(([from, to, w]) => { if (!ids.has(from) || !ids.has(to)) throw new Error(`edge ${from}-${to} names an unknown node`); return { from, to, ...(w !== undefined ? { w } : {}) }; });
    let nodes: { id: string; label?: string; x?: number; y?: number }[] = d.nodes;
    if (v === "layered") { // columns by BFS depth from the first traversal's start (or the first node)
      const start = String(d.ops[0]?.args[0] ?? d.nodes[0].id), depth = new Map([[start, 0]]), queue = [start];
      while (queue.length) {
        const u = queue.shift()!;
        for (const e of edges) for (const [a, b] of [[e.from, e.to], ...(d.directed ? [] : [[e.to, e.from]])]) if (a === u && !depth.has(b)) { depth.set(b, depth.get(u)! + 1); queue.push(b); }
      }
      const L = Math.max(0, ...depth.values()) + 1, per = new Map<number, string[]>();
      for (const n of d.nodes) { const l = depth.get(n.id) ?? L; per.set(l, [...(per.get(l) ?? []), n.id]); }
      const cols = Math.max(...per.keys()) + 1;
      nodes = d.nodes.map(n => { const l = depth.get(n.id) ?? L, col = per.get(l)!; return { ...n, x: cols === 1 ? .5 : l / (cols - 1), y: col.length === 1 ? .5 : col.indexOf(n.id) / (col.length - 1) }; });
    }
    else { // circle in DFS order from the first node: neighbours sit next to each other, so fewer edges cross
      const order: string[] = [], nb = (u: string) => edges.flatMap(e => e.from === u ? [e.to] : e.to === u ? [e.from] : []);
      const visit = (u: string) => { if (order.includes(u)) return; order.push(u); nb(u).forEach(visit); };
      d.nodes.forEach(n => visit(n.id));
      nodes = d.nodes.map(n => { const a = -Math.PI / 2 + order.indexOf(n.id) * 2 * Math.PI / d.nodes.length; return { ...n, x: .5 + .5 * Math.cos(a), y: .5 + .5 * Math.sin(a) }; });
    }
    if (d.label) text(c, "graph_label", d.label, .5, .08, .04, frac(0), { opacity: .7 });
    const g = { id: c.id(d.id), type: "Graph", nodes, edges, directed: d.directed, x: .5, y: .48, width: .64, height: .62 } as const;
    for (const o of d.ops) expandOp(g as unknown as SceneObject, { at: "@0", do: "op", target: g.id, op: o.op, args: o.args } as Action);
    c.key(c.add(g, frac(0), { style: "stagger" }));
    orderedAnchors(c.say, spread(d.ops.length, .2, .5), d.ops.map(o => o.at)).forEach((a, i) => c.act({ at: a, do: "op", target: g.id, op: d.ops[i].op, args: d.ops[i].args }));
  },
};

/** A tick step giving 5-12 ticks: 1, 2 or 5 times a power of ten. */
export function niceStep(span: number): number {
  const p = 10 ** Math.floor(Math.log10(span / 10));
  return [1, 2, 5, 10].map(k => k * p).find(st => span / st <= 12) ?? 10 * p;
}

export const VOCAB_GUIDE = `- timeline {title?, events:[{date, text, icon?|emoji?, at?}] 2-6} line|vertical. History, versions, a sequence of dated events.
- definition {term, meaning, example?, kind?} card|dictionary|center. Introducing a term BEFORE using it.
- analogy {left:{label, icon?|emoji?}, right:{...}, relation?, note?} arrow|equals|bridge. "X is like Y".
- steps {title?, steps:[{text, sub?, icon?|emoji?, at?}] 2-5} cards|ladder|vertical. A numbered procedure.
- procon {title?, pros:[...] 1-4, cons:[...] 1-4} columns|cards. Advantages vs drawbacks of ONE thing.
- quote {text, by?} center|side. A memorable line or definition from the source.
- hook {question, sub?, pose?, icon?|emoji?} big|character|split. Opening question, a puzzle, "but why?".
- checklist {title?, items:[{text, done?:bool, at?}] 2-6} column|cards. Requirements, conditions met (done:false = fails).
- numberline {title?, min, max, step?, points?:[{value,label?,open?,at?}], intervals?:[{from,to,label?,openFrom?,openTo?,at?}]} line|focus. Ranges, inequalities, bounds.
- venn {title?, sets:[{label, items?:[<=3]}] 2-3, both?:[<=3]} classic|focus. Overlap between categories.
- matrix {label?, rows:[[...]], vector?:[...], highlight?:{row?,col?}} grid|multiply. multiply = matrix × vector, result computed for you.
- distribution {kind:"normal"|"uniform"|"binomial", mean?, sd?, min?, max?, n?, p?, a?, b?, label?} shade|curve. Shade = P(a<=X<=b), computed for you.
- pipeline {instructions:[...] 2-5, stages?:[...], stall?:{instr, cycles}} diagram|stages. CPU pipelining (IF ID EX MEM WB), hazards.
- encoding {word?:32, instr?, fields:[{name, bits, value?}]} fields|bits. Instruction formats; bits must sum to word.
- stack|queue|linkedlist {id?, label?, values:[...], ops:[{op,args,at?}]} plain|log. ops: stack push[v]/pop[]/peek[]; queue enqueue[v]/dequeue[]/peek[]; linkedlist insert[i,v]/delete[i]/traverse[i]/find[v]. Computed for real.
- graph {id?, label?, directed?, nodes:[{id,label?}] 2-10, edges:[[from,to,weight?]], ops?:[{op:"bfs"|"dfs", args:[startId], at?}]} circle|layered. Traversal order and frontier computed for real.`;
