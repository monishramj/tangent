// Templates: the LLM picks a layout per beat and fills its slots; this expands each into positioned DSL
// objects and word-anchored actions. Layout, sizing and timing live here, so a weak model can't make a clunky frame.
// Positions are stage fractions on a 16:9 stage. Anchors: a phrase from `say` if it occurs exactly once, else "@f".
import { z } from "zod";
import { Tangenter, addTangenter, type Presenter } from "./tangenter";
import { MARKS, Pose, SceneObject, Transition, type Scene } from "./schema";
import { C, Op, TRANSITIONS, at, ctx, frac, heading, occurrences, s, spread, visual, visualAt } from "./tplkit";
import { VOCAB_EXPAND, VOCAB_GUIDE, VOCAB_TEMPLATES, VOCAB_VARIANTS } from "./vocabTemplates";
import * as tCodex from "./tpl/codex";
import * as tAgy from "./tpl/antigravity";
import * as tClaude from "./tpl/claude";
const HUMAN = [tCodex, tAgy, tClaude] as const;
import { ACCENT, MOTION } from "../stage/motion";
import { ICON_GUIDE, EMOJI_GUIDE } from "../stage/icons";
const Item = z.object({ text: s, ...visual, ...at });
const Side = z.object({ title: s, ...visual, points: z.array(s).max(3).optional() });
const Node = z.object({ id: z.string().regex(/^[A-Za-z_][\w-]*$/), label: s, shape: z.string().optional(), sub: z.string().optional(), ...at });

export const TEMPLATES = {
  title: z.object({ text: s, kicker: s.optional(), ...visual }),
  stat: z.object({ value: z.number(), prefix: z.string().optional(), suffix: z.string().optional(), decimals: z.number().int().min(0).max(3).optional(), label: s, ...visual }),
  versus: z.object({ left: Side, right: Side }),
  list: z.object({ title: s.optional(), items: z.array(Item).min(2).max(5) }),
  character: z.object({ pose: Pose.default("explain"), poseTo: Pose.optional(), says: s.optional(), thinks: s.optional(), ...visual,
    other: z.object({ pose: Pose.default("stand"), says: s.optional() }).optional() }),
  diagram: z.object({ title: s.optional(), nodes: z.array(Node).min(2).max(8), edges: z.array(z.object({ from: s, to: s, label: z.string().optional() })).default([]),
    pulse: z.array(z.tuple([s, s])).max(4).optional() }),
  math: z.object({ steps: z.array(s).min(1).max(4), notes: z.array(z.object({ text: s, ...at })).max(3).optional() }),
  code: z.object({ title: s.optional(), lines: z.array(z.string()).min(1).max(14), highlight: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(4).optional() }),
  array: z.object({ id: z.string().regex(/^[A-Za-z_][\w-]*$/).default("arr"), label: s.optional(), values: z.array(z.union([z.number(), z.string()])).min(1).max(10), heap: z.enum(["min", "max"]).optional(), ops: z.array(Op).max(3).default([]) }),
  tree: z.object({ id: z.string().regex(/^[A-Za-z_][\w-]*$/).default("tree"), label: s.optional(), kind: z.string().default("bst"), init: z.unknown(), ops: z.array(Op).max(3).default([]) }),
  chart: z.object({ title: s.optional(), labels: z.array(s).min(1).max(8), values: z.array(z.number()).min(1).max(8), highlight: z.number().int().min(0).optional() }),
  figure: z.object({ src: s, caption: s.optional(), focus: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional() }),
  gif: z.object({ query: s, caption: s.optional() }),
  callout: z.object({ text: s, sub: s.optional() }),
  table: z.object({ headers: z.array(s).min(1).max(5), rows: z.array(z.array(z.string())).min(1).max(6), highlightRows: z.array(z.number().int().min(0)).optional() }),
  ...VOCAB_TEMPLATES, ...tCodex.TEMPLATES, ...tAgy.TEMPLATES, ...tClaude.TEMPLATES,
} as const;
export type TemplateName = keyof typeof TEMPLATES;
export const VARIANTS: Record<TemplateName, string[]> = {
  title: ["slam", "punch", "words", "stack"], stat: ["center", "side"], versus: ["split", "cards"], list: ["column", "grid", "steps"],
  character: ["left", "right", "duo"], diagram: ["flow-h", "flow-v", "cycle", "hub", "datapath", "layers"], math: ["derive", "focus"],
  code: ["walk"], array: ["default"], tree: ["default"], chart: ["bars", "line"], figure: ["kenburns"], gif: ["full", "center"],
  callout: ["underline", "box", "punch"], table: ["default"], ...VOCAB_VARIANTS, ...tCodex.VARIANTS, ...tAgy.VARIANTS, ...tClaude.VARIANTS,
};
/** The variant a beat actually gets: the requested one if valid, else a rotation by beat index. */
export const resolveVariant = (template: TemplateName, variant: string | undefined, b: number) =>
  variant && VARIANTS[template].includes(variant) ? variant : template === "gif" ? "full" : VARIANTS[template][b % VARIANTS[template].length];

const Sticker = z.object({ ...visual, ...at }).refine(x => x.icon || x.emoji, "sticker needs icon or emoji");
export const TemplateBeat = z.object({
  say: s,
  template: z.enum(Object.keys(TEMPLATES) as [TemplateName, ...TemplateName[]]).optional(),
  variant: z.string().optional(),
  data: z.unknown().optional(),
  keep: z.boolean().optional(), // keep the previous beat's objects on screen (build on them with actions)
  sticker: Sticker.optional(),
  tangenter: Tangenter.optional(),
  camera: z.enum(["drift", "zoom", "shake"]).optional(),
  emphasis: z.array(z.object({ text: s.optional(), target: s.optional(), mark: z.enum(MARKS), ...at }).refine(e => e.text || e.target, "emphasis needs text or target")).max(3).optional(),
  energy: z.enum(["calm", "punchy"]).optional(), // calm: slower entrances + slow drift; punchy: faster entrances + a camera punch
  texture: z.enum(["none", "dots", "grid", "scanlines"]).optional(), // subtle background for this frame
  accent: z.boolean().optional(), // tint this beat's key element with the one accent colour
  objects: z.array(z.unknown()).optional(), // escape hatch: raw DSL objects
  actions: z.array(z.unknown()).optional(), // raw DSL actions (e.g. highlight/pulse/op on kept objects)
  cite: z.string().optional(),
  transition: Transition.optional(),
});
export const TemplateScene = z.object({ scene: z.string().optional(), objects: z.array(z.unknown()).default([]), beats: z.array(TemplateBeat).min(1) });
export type TemplateBeat = z.infer<typeof TemplateBeat>;
export type TemplateSceneT = z.input<typeof TemplateScene>;
export type ExpandError = { path: string; message: string; beat?: number };

/** Shape kind from a free-form hint or a datapath label ("ALU" -> alu, "MUX" -> trapezoid, "Data memory" -> cylinder). */
export function shapeFor(hint: string | undefined, label: string): string {
  const k = (hint ?? "").toLowerCase();
  const known = ["rect", "circle", "diamond", "pill", "cylinder", "trapezoid", "hexagon", "parallelogram", "alu", "polygon"];
  if (known.includes(k)) return k;
  if (/decision|if|\?/.test(k)) return "diamond";
  if (/start|end|terminal/.test(k)) return "pill";
  if (/data(base)?|store|disk/.test(k)) return "cylinder";
  if (/input|output|io/.test(k)) return "parallelogram";
  if (/\balu\b/i.test(label)) return "alu";
  if (/\bmux\b/i.test(label)) return "trapezoid";
  return "rect";
}

/** Longest-path layering (cycles broken by input order): node id -> [layer, index within layer]. */
export function layers(nodes: { id: string }[], edges: { from: string; to: string }[]) {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const layer = new Map(nodes.map(n => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++)
    for (const e of edges) {
      if (!order.has(e.from) || !order.has(e.to) || order.get(e.to)! <= order.get(e.from)!) continue; // forward edges only
      if (layer.get(e.to)! < layer.get(e.from)! + 1) layer.set(e.to, layer.get(e.from)! + 1);
    }
  const count = new Map<number, number>();
  const pos = new Map<string, [number, number]>();
  for (const n of nodes) { const l = layer.get(n.id)!; const i = count.get(l) ?? 0; count.set(l, i + 1); pos.set(n.id, [l, i]); }
  return { pos, layerCount: Math.max(...layer.values()) + 1, perLayer: count };
}

// Each expander gets parsed data and a variant; it adds objects + actions through the context.
const EXPAND: { [K in TemplateName]: (c: C, d: z.infer<(typeof TEMPLATES)[K]>, v: string) => void } = {
  title(c, d, v) {
    const size = d.text.length > 18 ? .12 : d.text.length > 10 ? .16 : .2, y = d.icon || d.emoji ? .45 : .5;
    if (d.kicker) c.add({ id: c.id("kicker"), type: "text", text: d.kicker.toUpperCase(), x: .5, y: y - size * .5 - .075, size: .04, opacity: .6 }, frac(0), { style: "type" });
    const id = c.add({ id: c.id("title"), type: "KineticText", text: d.text, variant: v, x: .5, y, size, maxW: .84 }, frac(.05));
    if (v === "punch") c.act({ at: frac(.05), do: "camera", shake: .02, duration: .4 });
    visualAt(c, "title_v", d, .5, y + size * .5 + .13, .13, frac(.45));
    void id;
  },
  stat(c, d, v) {
    const side = v === "side";
    visualAt(c, "stat_v", d, side ? .27 : .5, side ? .5 : .2, side ? .32 : .13, frac(0));
    c.add({ id: c.id("stat"), type: "counter", from: 0, to: d.value, prefix: d.prefix, suffix: d.suffix, decimals: d.decimals ?? 0, x: side ? .66 : .5, y: side ? .42 : .47, size: .22 }, frac(.1), { duration: 1.2 });
    c.add({ id: c.id("stat_label"), type: "text", text: d.label, x: side ? .66 : .5, y: side ? .64 : .7, size: .054, maxW: side ? .5 : .8 }, frac(.4), { style: "type" });
  },
  versus(c, d, v) {
    const sides = [[d.left, .25, "left", .05], [d.right, .75, "right", .5]] as const;
    for (const [side, x, edge, f] of sides) {
      const when = frac(f), slide = v === "cards" ? { style: "slide", edge } : { style: "pop" };
      if (v === "split") c.add({ id: c.id(`${edge}_card`), type: "shape", shape: "rect", x, y: .5, width: .36, height: .7 }, when, { style: "draw", duration: MOTION.draw });
      c.add({ id: c.id(`${edge}_title`), type: "text", text: side.title, weight: "bold", x, y: .27, size: .064, maxW: .32, opacity: 1 }, when, slide);
      visualAt(c, `${edge}_v`, side, x, .45, .17, when);
      (side.points ?? []).forEach((p, i) => c.add({ id: c.id(`${edge}_p${i}`), type: "text", text: p, x, y: .62 + i * .075, size: .04, maxW: .31, opacity: .8 }, frac(f + .12 + i * .08), { style: "type" }));
    }
    c.add({ id: c.id("vs"), type: "KineticText", text: "VS", variant: "punch", x: .5, y: .5, size: .08 }, frac(.38));
  },
  list(c, d, v) {
    const n = d.items.length, top = d.title ? .3 : .22;
    if (d.title) c.add({ id: c.id("list_title"), type: "KineticText", text: d.title, variant: "words", x: .5, y: .13, size: .07 }, frac(0));
    const when = spread(n, d.title ? .12 : 0, .78).map((f, i) => c.anchor(f, d.items[i].at));
    d.items.forEach((it, i) => {
      if (v === "grid") {
        const cols = n <= 3 ? n : Math.ceil(n / 2), row = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, n - row * cols);
        const x = .5 + (col - (inRow - 1) / 2) * .29, y = (n <= 3 ? .55 : .42 + row * .32) + (d.title ? .03 : 0);
        c.add({ id: c.id(`card${i}`), type: "shape", shape: "rect", x, y, width: .25, height: n <= 3 ? .45 : .28 }, when[i], { style: "draw", duration: MOTION.draw });
        visualAt(c, `card${i}_v`, it, x, y - .06, .12, when[i]);
        c.add({ id: c.id(`card${i}_t`), type: "text", text: it.text, x, y: y + (it.icon || it.emoji ? .07 : 0), size: .046, maxW: .21, opacity: .95 }, when[i], { style: "type" });
      } else if (v === "steps") {
        const x = .5 + (i - (n - 1) / 2) * Math.min(.24, .86 / n);
        const dot = c.add({ id: c.id(`step${i}`), type: "shape", shape: "circle", label: String(i + 1), x, y: .52, width: .1, height: .178, filled: i === n - 1 }, when[i], { style: "draw", duration: .5 });
        if (i > 0) c.add({ id: c.id(`step${i}_e`), type: "arrow", from: `${c.objects.find(o => o.id.startsWith(`step${i - 1}`))?.id}`, to: dot }, when[i], { style: "draw" });
        visualAt(c, `step${i}_v`, it, x, .33, .09, when[i]);
        c.add({ id: c.id(`step${i}_t`), type: "text", text: it.text, x, y: .71, size: .042, maxW: Math.min(.22, .84 / n), opacity: .9 }, when[i], { style: "type" });
      } else {
        // the block (icon + longest line) is centred on its estimated width, not pinned to the left
        const size = .052, tw = Math.min(.62, Math.max(...d.items.map(x => x.text.length)) * size * .5 * 9 / 16), x0 = .5 - (tw + .07) / 2;
        const y = top + .02 + i * Math.min(.15, .64 / n);
        visualAt(c, `item${i}_v`, it.icon || it.emoji ? it : { icon: "checkmark-circle" }, x0 + .02, y, .085, when[i]);
        c.add({ id: c.id(`item${i}`), type: "text", text: it.text, x: x0 + .07, y, size, maxW: .62, align: "left", opacity: .95 }, when[i], { style: "slide", edge: "right" });
      }
    });
  },
  character(c, d, v) {
    // Speech bubbles sit above the speaker with a tail pointing down at them; nothing overlaps the head.
    const right = v === "right", duo = v === "duo" && d.other;
    const px = duo ? .25 : right ? .7 : .3;
    const me = c.add({ id: c.id("person"), type: "person", pose: d.pose, facing: right ? "left" : "right", x: px, y: .62, size: .5 }, frac(0), { style: "draw", duration: .6 });
    const bx = duo ? .33 : right ? .5 : .5, tail = duo || !right ? "left" : "right";
    if (d.says) c.add({ id: c.id("says"), type: "shape", shape: "pill", label: d.says, x: bx, y: .17, width: duo ? .32 : .36, height: .14, tail }, frac(.15), { style: "pop" });
    if (d.thinks) {
      const tx = right ? .38 : .62;
      c.add({ id: c.id("bubble"), type: "shape", shape: "circle", x: tx, y: .3, width: .2, height: .34 }, frac(.2), { style: "draw", duration: .6 });
      c.add({ id: c.id("thinks"), type: "text", text: d.thinks, x: tx, y: .3, size: .035, maxW: .14, opacity: .9 }, frac(.3), { style: "type" });
    }
    if (!d.thinks) visualAt(c, "prop", d, duo ? .5 : right ? .4 : .6, .6, .18, frac(.35));
    if (d.poseTo) c.act({ at: frac(.55), do: "pose", target: me, to: d.poseTo });
    if (duo) {
      c.add({ id: c.id("person2"), type: "person", pose: d.other!.pose, facing: "left", x: .75, y: .62, size: .5 }, frac(.3), { style: "draw", duration: .6 });
      if (d.other!.says) c.add({ id: c.id("says2"), type: "shape", shape: "pill", label: d.other!.says, x: .67, y: .17, width: .32, height: .14, tail: "right" }, frac(.5), { style: "pop" });
    }
  },
  diagram(c, d, v) {
    const nodes = d.nodes, ids = new Set(nodes.map(n => n.id));
    const edges = d.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    const top = d.title ? .2 : .1, bottom = .9, n = nodes.length;
    if (d.title) heading(c, "diagram_title", d.title);
    const place = new Map<string, [number, number]>();
    let w = .16, h = .13, layered: ReturnType<typeof layers> | undefined;
    if (v === "cycle" || v === "hub") {
      const ring = v === "hub" ? nodes.slice(1) : nodes, cy = (top + bottom) / 2;
      if (v === "hub") place.set(nodes[0].id, [.5, cy]);
      ring.forEach((nd, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / ring.length; place.set(nd.id, [.5 + .3 * Math.cos(a), cy + .27 * Math.sin(a)]); });
      w = Math.min(.18, .9 / Math.max(3, ring.length)); h = .13;
    } else if (v === "layers") {
      nodes.forEach((nd, i) => place.set(nd.id, [.5, top + (i + .5) * (bottom - top) / n]));
      w = .56; h = Math.min(.12, (bottom - top) / n * .75);
    } else {
      const L = layered = layers(nodes, edges), vertical = v === "flow-v";
      const across = Math.max(...L.perLayer.values());
      for (const nd of nodes) {
        const [l, i] = L.pos.get(nd.id)!, k = L.perLayer.get(l)!;
        const main = (l + .5) / L.layerCount, cross = (i - (k - 1) / 2) / Math.max(1, across);
        place.set(nd.id, vertical ? [.5 + cross * .7, top + main * (bottom - top)] : [.06 + main * .88, (top + bottom) / 2 + cross * (bottom - top) * .8]);
      }
      w = vertical ? Math.min(.24, .7 / across) : Math.min(.19, .88 / L.layerCount * .68);
      h = vertical ? Math.min(.14, (bottom - top) / L.layerCount * .6) : Math.min(.17, (bottom - top) / across * .55);
    }
    const when = spread(n, d.title ? .1 : 0, .7).map((f, i) => c.anchor(f, nodes[i].at));
    const made = new Map<string, { id: string; i: number }>();
    nodes.forEach((nd, i) => {
      const [x, y] = place.get(nd.id)!;
      made.set(nd.id, { id: c.add({ id: c.id(nd.id), type: "shape", shape: shapeFor(nd.shape, nd.label), label: nd.label, sublabel: nd.sub, x, y, width: w, height: h }, when[i], { style: "draw", duration: .6 }), i });
    });
    const edgeIds = new Map<string, string>();
    for (const e of edges) {
      const a = made.get(e.from)!, b = made.get(e.to)!;
      // Edges that point backwards (or sideways) in a layered layout would overlap forward ones: bend them.
      const back = (v.startsWith("flow") || v === "datapath") && layered!.pos.get(e.to)![0] <= layered!.pos.get(e.from)![0];
      const id = c.add({ id: c.id(`e_${e.from}_${e.to}`), type: "arrow", from: a.id, to: b.id, label: e.label, route: back || v === "cycle" ? "curve" : v === "datapath" ? "elbow" : "straight", dashed: back || undefined }, when[Math.max(a.i, b.i)], { style: "draw" });
      edgeIds.set(`${e.from}>${e.to}`, id);
    }
    (d.pulse ?? []).map(([f, t]) => edgeIds.get(`${f}>${t}`)).filter(Boolean)
      .forEach((id, i, all) => c.act({ at: frac(.78 + .18 * i / Math.max(1, all.length)), do: "pulse", target: id }));
  },
  math(c, d, v) {
    if (v === "focus") {
      c.add({ id: c.id("eq"), type: "Math", tex: d.steps[0], x: .5, y: .4, size: .1 }, frac(0));
      (d.notes ?? []).forEach((nt, i, all) => c.add({ id: c.id(`note${i}`), type: "text", text: nt.text, x: .5 + (i - (all.length - 1) / 2) * .3, y: .7, size: .035, maxW: .26 }, c.anchor(.3 + .5 * i / Math.max(1, all.length), nt.at), { style: "type" }));
      return;
    }
    const n = d.steps.length, when = spread(n, 0, .75), ids: string[] = [];
    d.steps.forEach((tex, i) => {
      ids.push(c.add({ id: c.id(`step${i}`), type: "Math", tex, x: .5, y: .5 + (i - (n - 1) / 2) * .17, size: .065 }, frac(when[i])));
      if (i > 0) c.act({ at: frac(when[i]), do: "fade", target: ids[i - 1], to: .35 });
    });
    (d.notes ?? []).slice(0, 1).forEach(nt => c.add({ id: c.id("note"), type: "text", text: nt.text, x: .5, y: .88, size: .035 }, c.anchor(.6, nt.at), { style: "type" }));
  },
  code(c, d) {
    if (d.title) heading(c, "code_title", d.title, .11, { mono: true });
    const id = c.add({ id: c.id("code"), type: "code", lines: d.lines, x: .5, y: .55, width: .76, height: Math.min(.7, .06 + d.lines.length * .075) }, frac(0), { style: "type" });
    const hl = (d.highlight ?? []).filter(([a, b]) => a <= b && b < d.lines.length);
    spread(hl.length, .3, .85).forEach((f, i) => c.act({ at: frac(f), do: "highlight", target: id, range: hl[i] }));
  },
  array(c, d) {
    if (d.label) c.add({ id: c.id(`${d.id}_label`), type: "text", text: d.label, x: .5, y: .3, size: .046, opacity: .75 }, frac(0), { style: "type" });
    const id = c.add({ id: c.id(d.id), type: "Array", init: d.values, heap: d.heap ?? "max", x: .5, y: .55 }, frac(0), { style: "stagger" });
    spread(d.ops.length, .3, .7).forEach((f, i) => c.act({ at: c.anchor(f, d.ops[i].at), do: "op", target: id, op: d.ops[i].op, args: d.ops[i].args }));
  },
  tree(c, d) {
    if (d.label) c.add({ id: c.id(`${d.id}_label`), type: "text", text: d.label, x: .5, y: .1, size: .046, opacity: .75 }, frac(0), { style: "type" });
    const id = c.add({ id: c.id(d.id), type: "Tree", kind: d.kind, init: d.init, x: .5, y: .55 }, frac(0), { style: "stagger" });
    spread(d.ops.length, .3, .7).forEach((f, i) => c.act({ at: c.anchor(f, d.ops[i].at), do: "op", target: id, op: d.ops[i].op, args: d.ops[i].args }));
  },
  chart(c, d, v) {
    if (d.title) heading(c, "chart_title", d.title, .11);
    const n = Math.min(d.labels.length, d.values.length);
    const id = c.add({ id: c.id("chart"), type: "chart", kind: v === "line" ? "line" : "bar", labels: d.labels.slice(0, n), values: d.values.slice(0, n), x: .5, y: .56, width: .72, height: .6 }, frac(.05), { style: v === "line" ? "draw" : "stagger", duration: 1.2 });
    if (d.highlight !== undefined && d.highlight < n) c.act({ at: frac(.75), do: "highlight", target: id, col: d.highlight });
  },
  figure(c, d) {
    c.add({ id: c.id("figure"), type: "figure", src: d.src, focus: d.focus, x: .5, y: .46, width: .78, height: .7 }, frac(0));
    if (d.caption) c.add({ id: c.id("figure_cap"), type: "text", text: d.caption, x: .5, y: .9, size: .032, opacity: .7 }, frac(.2), { style: "type" });
  },
  gif(c, d, v) {
    // The gif alone: no caption or text beside it (any caption the model sends is ignored).
    const box = v === "center" ? { x: .5, y: .48, width: .6, height: .7 } : { x: .5, y: .5, width: .9, height: .82 };
    c.add({ id: c.id("gif"), type: "gif", query: d.query, ...box }, frac(0));
  },
  callout(c, d, v) {
    // The frame is pushed before the text so it sits behind it (draw order = object order).
    const y = d.sub ? .44 : .5;
    if (v === "box") c.add({ id: c.id("callout_box"), type: "shape", shape: "rect", x: .5, y: d.sub ? .5 : .5, width: .86, height: d.sub ? .48 : .38 }, frac(.25), { style: "draw", duration: .7 });
    c.add({ id: c.id("callout"), type: v === "punch" ? "KineticText" : "text", text: d.text, variant: "punch", weight: "bold", x: .5, y, size: .085, maxW: .76, opacity: 1 }, frac(0), v === "punch" ? {} : { style: "type" });
    if (v === "underline") c.add({ id: c.id("callout_line"), type: "line", from: [.2, y + .1], to: [.8, y + .1] }, frac(.4), { style: "draw", duration: .5 });
    if (v === "punch") c.act({ at: frac(.3), do: "camera", zoom: 1.08, duration: 2 });
    if (d.sub) c.add({ id: c.id("callout_sub"), type: "text", text: d.sub, x: .5, y: y + .19, size: .044, opacity: .65 }, frac(.5), { style: "type" });
  },
  ...VOCAB_EXPAND, ...tCodex.EXPAND, ...tAgy.EXPAND, ...tClaude.EXPAND,
  table(c, d) {
    const cols = d.headers.length, rows = d.rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
    const id = c.add({ id: c.id("table"), type: "table", headers: d.headers, rows, x: .5, y: .5, width: .8, height: Math.min(.75, (rows.length + 1) * .1) }, frac(0), { style: "stagger" });
    const hl = (d.highlightRows ?? []).filter(r => r < rows.length);
    spread(hl.length, .35, .85).forEach((f, i) => c.act({ at: frac(f), do: "highlight", target: id, row: hl[i] }));
  },
};

/** Reading order: elements a template creates on the same narration word enter MOTION.stagger apart (container, heading,
 * picture, detail: the order templates add them), never all at once. The whole cascade stays under MOTION.staggerMax. */
export function staggerCreates(actions: unknown[]) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const a of actions as Record<string, unknown>[]) {
    if (a.do !== "create" || a.delay !== undefined) continue;
    if ((actions as Record<string, unknown>[]).some(b => b !== a && b.target === a.target && b.at === a.at)) continue; // another action on it on this word: leave its timing alone
    const g = groups.get(String(a.at)) ?? []; g.push(a); groups.set(String(a.at), g);
  }
  for (const g of groups.values()) {
    const step = Math.min(MOTION.stagger, MOTION.staggerMax / Math.max(1, g.length - 1));
    g.forEach((a, i) => { if (i) a.delay = Math.round(i * step * 1000) / 1000; });
  }
}

/** Per-beat customization on top of the template: emphasis marks, energy, texture, accent. */
function decorate(c: C, beat: TemplateBeat, onScreen: string[], prior: unknown[], errors: ExpandError[]) {
  const all = [...prior, ...c.objects] as SceneObject[], live = new Set([...(beat.keep ? onScreen : []), ...c.objects.map(o => o.id)]);
  (beat.emphasis ?? []).forEach((e, i) => {
    const hit = e.target ? all.find(o => o.id === e.target && live.has(o.id))
      : [...all].reverse().find(o => live.has(o.id) && (o.type === "text" || o.type === "KineticText") && o.text.toLowerCase().includes(e.text!.toLowerCase()));
    if (!hit) return errors.push({ path: `beats[${c.b}].emphasis[${i}]`, message: e.target ? `no on-screen object "${e.target}"` : `no on-screen text contains "${e.text}"`, beat: c.b });
    const phrase = e.at ?? e.text, when = phrase && occurrences(c.say, phrase) === 1 ? phrase : frac(.55 + .12 * i);
    c.add({ id: c.id(`mark_${hit.id}`), type: "mark", target: hit.id, text: e.text, mark: e.mark }, when, { style: "draw", duration: e.mark === "circle" ? .6 : .45 });
  });
  if (beat.texture && beat.texture !== "none") {
    const id = c.id("texture");
    c.objects.unshift({ id, type: "texture", pattern: beat.texture } as SceneObject);
    c.actions.unshift({ at: "@0", do: "create", target: id, duration: .3 });
  }
  if (beat.energy) {
    const k = MOTION.energy[beat.energy];
    for (const a of c.actions as Record<string, unknown>[]) if (a.do === "create") a.duration = Math.max(.15, Number(a.duration ?? .4) * k.dur);
    if (beat.energy === "punchy" && !beat.camera) {
      c.act({ at: "@0.1", do: "camera", zoom: k.zoom, duration: .12, easing: "outExpo" });
      c.act({ at: "@0.2", do: "camera", zoom: 1, duration: .35, easing: "inOutQuad" });
    } else if (beat.energy === "calm" && !beat.camera) c.act({ at: "@0.05", do: "camera", zoom: k.zoom, duration: 5, easing: "inOutSine" });
  }
  if (beat.accent) {
    const key = c.objects.find(o => o.id === c.keyId) ?? c.objects.find(o => ["KineticText", "counter"].includes(o.type)) ?? c.objects.find(o => o.type === "text");
    if (key && key.type !== "emoji") (key as { color?: string }).color = ACCENT;
  }
}

const issuePath = (p: PropertyKey[]) => p.map(x => typeof x === "number" ? `[${x}]` : `.${String(x)}`).join("");

/** Template scene -> plain Scene JSON (validate it with validateScene). Errors are per beat so retries can target them. */
export function expandTemplates(raw: unknown): { scene: Scene | null; errors: ExpandError[] } {
  const parsed = TemplateScene.safeParse(raw);
  if (!parsed.success) return { scene: null, errors: parsed.error.issues.map(i => ({ path: issuePath(i.path).replace(/^\./, ""), message: i.message, beat: i.path[0] === "beats" && typeof i.path[1] === "number" ? i.path[1] : undefined })) };
  const errors: ExpandError[] = [];
  const ids = new Set<string>();
  const objects: unknown[] = [];
  for (const o of parsed.data.objects) { const id = (o as { id?: unknown })?.id; if (typeof id === "string") ids.add(id); objects.push(o); }
  let onScreen: string[] = [];
  let cleared = 0;
  let presenter: Presenter | undefined;
  const beats = parsed.data.beats.map((beat, b) => {
    const c = ctx(b, beat.say, ids);
    const raws = (beat.objects ?? []).map(o => { const id = (o as { id?: unknown })?.id; if (typeof id === "string") ids.add(id); return o; });
    let transition = beat.transition;
    if (b > 0 && !beat.keep && (beat.template || raws.length)) {
      // A new frame: drop the old one instantly; the transition carries the change.
      for (const id of onScreen) c.act({ at: "@0", do: "fade", target: id, to: 0, duration: .01 });
      c.act({ at: "@0", do: "camera", x: .5, y: .5, zoom: 1, duration: .01 });
      transition ??= TRANSITIONS[cleared++ % TRANSITIONS.length];
      onScreen = [];
    }
    if (beat.template) {
      const schema = TEMPLATES[beat.template];
      const data = schema.safeParse(beat.data ?? {});
      if (!data.success) for (const i of data.error.issues) errors.push({ path: `beats[${b}].data${issuePath(i.path)}`, message: `${beat.template}: ${i.message}`, beat: b });
      else {
        const variant = resolveVariant(beat.template, beat.variant, b);
        try { (EXPAND[beat.template] as (c: C, d: unknown, v: string) => void)(c, data.data, variant); }
        catch (e) { errors.push({ path: `beats[${b}].data`, message: `${beat.template}: ${e instanceof Error ? e.message : String(e)}`, beat: b }); }
      }
    }
    staggerCreates(c.actions);
    if (beat.sticker) visualAt(c, "sticker", beat.sticker, .87, .2, .12, c.anchor(.5, beat.sticker.at));
    decorate(c, beat, onScreen, objects, errors);
    const previous = presenter;
    const content = [...(beat.keep ? objects.filter(o => onScreen.includes((o as SceneObject).id) && (o as SceneObject).id !== previous?.id) : []), ...c.objects, ...raws] as SceneObject[];
    presenter = beat.tangenter && beat.template !== "gif" && beat.template !== "figure"
      ? addTangenter(c, beat.tangenter, content, previous) : undefined;
    if (presenter && previous) {
      for (let i = c.actions.length - 1; i >= 0; i--) {
        const a = c.actions[i] as { do?: string; target?: string };
        if (a.do === "fade" && a.target === presenter.id) c.actions.splice(i, 1);
      }
    }
    if (previous && !presenter && !c.actions.some(a => (a as { do?: string; target?: string }).do === "fade" && (a as { target?: string }).target === previous.id))
      c.act({ at: "@0", do: "fade", target: previous.id, to: 0, duration: .15 });
    if (beat.camera === "drift") c.act({ at: "@0.05", do: "camera", zoom: 1.06, duration: 4 });
    if (beat.camera === "zoom") c.act({ at: "@0.4", do: "camera", zoom: 1.15, duration: .8, easing: "outExpo" });
    if (beat.camera === "shake") c.act({ at: "@0.3", do: "camera", shake: .02, duration: .4 });
    objects.push(...c.objects, ...raws);
    if (presenter && previous && !onScreen.includes(presenter.id)) onScreen.push(presenter.id);
    onScreen.push(...c.objects.map(o => o.id), ...raws.map(o => String((o as { id?: unknown }).id)));
    return { say: beat.say, actions: [...c.actions, ...(beat.actions ?? [])], cite: beat.cite, transition };
  });
  if (errors.length) return { scene: null, errors };
  return { scene: { scene: parsed.data.scene ?? "scene", objects: objects as SceneObject[], beats: beats as Scene["beats"] }, errors };
}

// Exported for prompts: compact per-template slot reference.
export const TEMPLATE_GUIDE = `Templates (beat.template + beat.variant + beat.data). Text is SHORT labels (<= 6 words). icon = a simple noun ("laptop","database","cpu","lightbulb","rocket","lock","user","book","clock","cloud","bug","chart"); emoji = one emoji character. Items/nodes/notes/ops may carry "at": an exact phrase from say that times the reveal.
- title {text, kicker?, icon?|emoji?} variants slam|punch|words|stack. Hooks, section openers, big reveals.
- stat {value:number, prefix?, suffix?, decimals?, label, icon?|emoji?} center|side. Any number worth feeling (counts up).
- versus {left:{title, icon?|emoji?, points?:[<=3]}, right:{...}} split|cards. Comparisons, trade-offs, before/after.
- list {title?, items:[{text, icon?|emoji?, at?}] 2-5} column|grid|steps. Properties, causes, ordered steps.
- character {pose, poseTo?, says?, thinks?, icon?|emoji?, other?:{pose, says?}} left|right|duo. Poses: ${Pose.options.join(", ")}. A stick figure reacting, asking, explaining; duo = a dialogue.
- diagram {title?, nodes:[{id,label,shape?,sub?,at?}] 2-8, edges:[{from,to,label?}], pulse?:[[from,to]]} flow-h|flow-v|cycle|hub|datapath|layers. Flowcharts (shape: decision|terminal|io|database|rect), processes, cycles, architecture (datapath: ALU/MUX/register/memory blocks with signals pulsing along wires), layered stacks.
- math {steps:[latex] 1-4, notes?:[{text, at?}]} derive|focus. Equations; derive shows each step.
- code {title?, lines:[...] <=14, highlight?:[[startLine,endLine]]} walk.
- array {id?, label?, values:[...], heap?:"max"|"min", ops?:[{op,args,at?}]} ops: swap[i,j], compare[i,j], set[i,v], siftDown[i], siftUp[i] (computed for real).
- tree {id?, label?, kind, init, ops?:[{op,args,at?}]} computed tree ops (kinds/ops below).
- chart {title?, labels:[...], values:[...], highlight?:index} bars|line.
- figure {src, caption?, focus?:[[l,t,r,b]]} kenburns. Only with a listed figure src.
- gif {query} full|center. The gif alone, no text. A real GIPHY clip that SHOWS what this beat's narration is saying: an analogy made literal (a cache -> "post it notes", a deadlock -> "traffic jam", a pipeline -> "assembly line", a race condition -> "two people grab same door"), a pop-culture or meme moment ("this is fine", "confused math lady", "galaxy brain"), or a reaction ("mind blown", "wait what"). query = 2-4 concrete words naming the exact scene to show (the thing happening, not a mood: "traffic jam" not "frustrated"); someone watching it with the narration must see the link instantly, else pick another template. full fills the frame (default).
- callout {text, sub?} underline|box|punch. The key idea, the takeaway, "here's the catch".
- table {headers, rows, highlightRows?}.
${VOCAB_GUIDE}${HUMAN.map(h => h.GUIDE ? `\n${h.GUIDE}` : "").join("")}
Icons (any simple noun works; e.g.) ${ICON_GUIDE}.
Emoji packs: ${EMOJI_GUIDE}.
tangenter:{pose,poseTo?,says?,thinks?,at?}: the recurring explainer stick figure; ~1 in 3-4 beats; reactions, the viewer’s question, pointing at the key element; never on gif/figure beats.
Beat extras: emphasis:[{text|target, mark:"underline"|"circle"|"strike"|"marker", at?}] (<=2; text = a phrase that is ON SCREEN, e.g. in a callout); energy:"calm"|"punchy"; texture:"dots"|"grid"|"scanlines" (rarely); accent:true (at most one beat per scene: tints its key element); keep:true keeps the previous beat's objects and lets you add "actions" on them (highlight/indicate/pulse/op/pose/transform by id; diagram node ids and array/tree ids are kept as given, edges are e_<from>_<to>, the stick figure is "person"); sticker:{emoji|icon, at?} pops a small sticker in the corner; camera:"drift"|"zoom"|"shake"; transition:"whip"|"push"|"cut".`;
