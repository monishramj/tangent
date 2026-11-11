// Scene DSL v0. zod over hand-rolled: one definition gives both the runtime check (with issue paths) and the TS types.
// Objects/actions are loose: extra style/layout props (x, y, color, ...) pass through; layout is not specified yet.
import { z } from "zod";
import { TREE_OPS } from "./treeOps";

const id = z.string().regex(/^[A-Za-z_][\w-]*$/);
const num2 = z.tuple([z.number(), z.number()]);
export const CreateStyle = z.enum(["draw", "pop", "bounce", "type", "slide", "stagger", "stamp", "flip", "grow"]); // stamp: big -> 1x with a squash + settle into def.rotation; flip: hidden half, then grows in x (second half of a card flip); grow: shape grows out of its pivot (y, or x for pivot "left"), e.g. liquid filling
export const Easing = z.enum(["outCubic", "outBack", "inOutQuad", "outQuart", "outExpo", "inOutCubic", "inOutExpo", "inExpo", "inOutSine", "inCubic", "linear"]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const animation = { style: CreateStyle.optional(), easing: Easing.optional(), gap: z.number().min(0).max(.9).optional() };
const index = z.number().int().nonnegative();
const range = z.tuple([index, index]).refine(([a, b]) => a <= b, "range must be ordered");
const unit = z.number().min(0).max(1);
const focus = z.tuple([unit, unit, unit, unit]).refine(([x, y, r, b]) => x < r && y < b, "focus box must have positive size");
const point = z.union([id, num2]); // object id or [x, y]
const size = z.number().positive().max(1).optional(); // fraction of stage height
const value = z.union([z.number(), z.string()]);
export const SHAPES = ["rect", "circle", "polygon", "diamond", "pill", "cylinder", "trapezoid", "hexagon", "parallelogram", "alu",
  "triangle", "star", "octagon", "gear", "ring", "cloud", "thought", "document", "chip", "tag", "bubble", "brace", "check", "cross"] as const;
export const MARKS = ["underline", "circle", "strike", "marker"] as const;
export const SEQ_TYPES = ["Stack", "Queue", "LinkedList"] as const; // linear computed components (one renderer, different layouts)
export const POSES = ["stand", "point", "think", "shrug", "celebrate", "wave", "confused", "walk", "explain"] as const;
export const Pose = z.enum(POSES);
const obj = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.looseObject({ id, type: z.literal(type), ...animation, color: color.optional(), ...shape });

// Binary children retain null placeholders; other kinds use a dense children list.
export type TreeNode = { keys: number[]; children: (TreeNode | null)[]; color?: "red" | "black" };
export const TreeNode: z.ZodType<TreeNode> = z.lazy(() => z.object({
  keys: z.array(z.number()).min(1),
  children: z.array(TreeNode.nullable()),
  color: z.enum(["red", "black"]).optional(),
}));
const heap = z.enum(["min", "max"]).default("max");
const tree = obj("Tree", {
  kind: z.string().default("bst").refine(kind => Object.prototype.hasOwnProperty.call(TREE_OPS, kind), "unknown Tree kind"),
  init: z.union([TreeNode.nullable(), z.array(z.number().nullable())]),
  order: z.number().int().min(3).default(3),
  heap,
}).superRefine((o, ctx) => {
  if (Array.isArray(o.init)) {
    if (o.kind === "btree" || o.kind === "generic")
      ctx.addIssue({ code: "custom", path: ["init"], message: "level-order shorthand requires a binary kind" });
    for (let i = 1; i < o.init.length; i++) if (o.init[i] !== null && o.init[Math.floor((i - 1) / 2)] == null)
      ctx.addIssue({ code: "custom", path: ["init", i], message: "node has no parent" });
    return;
  }
  const check = (n: TreeNode | null, path: (string | number)[]) => {
    if (!n) return;
    if (o.kind !== "btree" && o.kind !== "generic" && (n.keys.length !== 1 || n.children.length > 2))
      ctx.addIssue({ code: "custom", path, message: "binary nodes need one key and at most two children" });
    if (o.kind === "btree" && (n.keys.length >= o.order ||
      (n.children.length > 0 && (n.children.length !== n.keys.length + 1 || n.children.some(c => !c)))))
      ctx.addIssue({ code: "custom", path, message: "invalid B-tree node capacity or children" });
    if (o.kind === "generic" && (n.keys.length !== 1 || n.children.some(c => !c)))
      ctx.addIssue({ code: "custom", path, message: "generic nodes need one key and dense children" });
    n.children.forEach((c, i) => check(c, [...path, "children", i]));
  };
  check(o.init, ["init"]);
});
export type TreeObject = z.infer<typeof tree>;

export const SceneObject = z.discriminatedUnion("type", [
  // size: font size as a fraction of stage height; weight/mono/align/maxW only matter for explicitly placed text.
  obj("text", { text: z.string(), size, weight: z.enum(["normal", "bold"]).optional(), mono: z.boolean().optional(), align: z.enum(["left", "center", "right"]).optional(), maxW: unit.optional(), maxH: unit.optional(), opacity: unit.optional() }), // maxH: explicitly placed text shrinks to fit this height
  obj("KineticText", { text: z.string(), variant: z.string().optional(), size, maxW: unit.optional() }), // variant: slam | punch | words | stack
  obj("Math", { tex: z.string(), size }), // KaTeX
  obj("shape", { shape: z.enum(SHAPES), points: z.array(num2).min(3).max(128).optional(), label: z.string().optional(), sublabel: z.string().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), filled: z.boolean().optional(), ghost: z.boolean().optional(), pivot: z.enum(["bottom", "top", "left", "corner"]).optional(), tail: z.enum(["left", "right"]).optional(), radius: unit.optional(), typing: z.boolean().optional() }), // pivot: rotate/grow about the bottom/top edge, left edge, or bottom-right corner (a domino tipping right); radius: corner radius (fraction of stage height, capped at half the short side); typing: three bouncing dots inside (chat typing indicator); tail: speech-bubble pointer under the shape; ghost: translucent fill (overlaps show, e.g. venn)
  obj("icon", { name: z.string().min(1), size, label: z.string().optional() }), // Hugeicons name, e.g. "laptop", "database", "user"
  obj("emoji", { char: z.string().min(1).max(16), size, label: z.string().optional() }),
  obj("person", { tangenter: z.boolean().optional(), aim: num2.optional(), pose: Pose.default("stand"), size, facing: z.enum(["left", "right"]).default("right"), label: z.string().optional() }), // stick figure
  obj("gif", { query: z.string().optional(), src: z.string().optional(), caption: z.string().optional(), width: z.number().positive().optional(), height: z.number().positive().optional() }),
  obj("chart", { kind: z.enum(["bar", "line"]).default("bar"), labels: z.array(z.string()).min(1), values: z.array(z.number()).min(1), max: z.number().positive().optional(), width: z.number().positive().optional(), height: z.number().positive().optional() }).superRefine((o, ctx) => {
    if (o.labels.length !== o.values.length) ctx.addIssue({ code: "custom", message: "chart needs one label per value" });
  }),
  obj("counter", { to: z.number(), from: z.number().default(0), prefix: z.string().optional(), suffix: z.string().optional(), decimals: z.number().int().min(0).max(4).default(0), label: z.string().optional(), size }),
  obj("flow", {
    nodes: z.array(z.object({ id, label: z.string(), x: unit.optional(), y: unit.optional() })).min(1),
    edges: z.array(z.object({ from: id, to: id, label: z.string().optional() })),
  }).superRefine((o, ctx) => {
    const ids = new Set(o.nodes.map(n => n.id));
    if (ids.size !== o.nodes.length || o.edges.some(e => !ids.has(e.from) || !ids.has(e.to)))
      ctx.addIssue({ code: "custom", message: "flow needs unique nodes and existing edge endpoints" });
  }),
  obj("table", { headers: z.array(z.string()).min(1), rows: z.array(z.array(z.string())), highlightRow: index.optional(), highlightCol: index.optional() }).superRefine((o, ctx) => {
    if (o.rows.some(r => r.length !== o.headers.length) || (o.highlightRow !== undefined && o.highlightRow >= o.rows.length) || (o.highlightCol !== undefined && o.highlightCol >= o.headers.length))
      ctx.addIssue({ code: "custom", message: "table dimensions or highlight out of range" });
  }),
  obj("code", { lines: z.array(z.string()).min(1), highlight: z.array(range).optional(), duration: z.number().positive().optional() }).superRefine((o, ctx) => {
    if (o.highlight?.some(([, end]) => end >= o.lines.length)) ctx.addIssue({ code: "custom", message: "code highlight out of range" });
  }),
  obj("figure", { src: z.string().min(1), focus: z.array(focus).min(1).optional(), duration: z.number().positive().optional() }),
  obj("bits", { bits: z.string().regex(/^[01]+$/), label: z.string().optional(), groups: z.array(z.number().int().positive()).optional() }).superRefine((o, ctx) => {
    if (o.groups && o.groups.reduce((a, b) => a + b, 0) !== o.bits.length) ctx.addIssue({ code: "custom", message: "groups must cover all bits" });
  }),
  obj("stack", { frames: z.array(z.object({ label: z.string(), items: z.array(z.string()) })).min(1) }),
  obj("arrow", { from: point, to: point, label: z.string().optional(), route: z.enum(["straight", "elbow", "curve"]).optional(), dashed: z.boolean().optional() }),
  obj("line", { from: point, to: point, points: z.array(num2).min(2).max(128).optional(), label: z.string().optional(), route: z.enum(["straight", "elbow", "curve"]).optional(), dashed: z.boolean().optional(), weight: z.enum(["hair"]).optional() }), // hair: leader ticks, guides
  obj("axes", { x: num2, y: num2 }),
  obj("numberline", { min: z.number(), max: z.number(), step: z.number().positive().optional(), width: unit.optional() }).superRefine((o, ctx) => {
    if (!(o.min < o.max) || (o.max - o.min) / (o.step ?? 1) > 24) ctx.addIssue({ code: "custom", message: "numberline needs min < max and at most 24 ticks" });
  }),
  obj("matrix", { rows: z.array(z.array(value)).min(1).max(6), label: z.string().optional(), cell: z.number().positive().max(.3).optional() }).superRefine((o, ctx) => {
    if (o.rows.some(r => r.length !== o.rows[0].length || !r.length) || o.rows[0].length > 6) ctx.addIssue({ code: "custom", message: "matrix rows must be equal length (1-6)" });
  }),
  obj("distribution", { kind: z.enum(["normal", "uniform", "binomial"]), mean: z.number().default(0), sd: z.number().positive().default(1), min: z.number().default(0), max: z.number().default(1),
    n: z.number().int().min(1).max(40).default(10), p: unit.default(.5), a: z.number().optional(), b: z.number().optional(), width: unit.optional(), height: unit.optional() }).superRefine((o, ctx) => {
    if (o.kind === "uniform" && !(o.min < o.max)) ctx.addIssue({ code: "custom", message: "uniform needs min < max" });
    if (o.a !== undefined && o.b !== undefined && o.a > o.b) ctx.addIssue({ code: "custom", message: "shaded range needs a <= b" });
  }),
  obj("mark", { target: id, text: z.string().optional(), mark: z.enum(MARKS) }), // hand-drawn emphasis on an object (or a phrase inside a text)
  obj("texture", { pattern: z.enum(["dots", "grid", "scanlines"]) }), // subtle full-stage background
  ...SEQ_TYPES.map(t => obj(t, { init: z.array(value).max(10), label: z.string().optional(), cap: z.number().int().min(1).max(10).optional() })), // cap: slots to lay out
  obj("Graph", {
    nodes: z.array(z.object({ id, label: z.string().optional(), x: unit.optional(), y: unit.optional() })).min(1).max(12),
    edges: z.array(z.object({ from: id, to: id, w: z.number().optional() })).max(30), directed: z.boolean().default(false),
    width: unit.optional(), height: unit.optional(),
  }).superRefine((o, ctx) => {
    const ids = new Set(o.nodes.map(n => n.id));
    if (ids.size !== o.nodes.length || o.edges.some(e => !ids.has(e.from) || !ids.has(e.to))) ctx.addIssue({ code: "custom", message: "graph needs unique node ids and existing edge endpoints" });
  }),
  obj("plot", { axes: id, expr: z.string() }),
  obj("media", { src: z.string() }), // gif/image
  // computed components (MVP set; Heap, Graph, ... later)
  obj("Array", { init: z.array(z.union([z.number(), z.string()])), heap }),
  tree,
]);

// A spoken phrase from the beat's say, or "@f": the word at fraction f (0..1) of the beat (templates use this; robust to TTS rewording).
export const FRACTION_ANCHOR = /^@(0(\.\d+)?|1(\.0+)?)$/;
const anchor = z.string().min(1);
const act = <K extends string, T extends z.ZodRawShape>(verb: K, shape: T, targetRequired = true) =>
  z.looseObject({ at: anchor, do: z.literal(verb), target: targetRequired ? z.string() : z.string().optional(), easing: Easing.optional(), duration: z.number().positive().optional(), delay: z.number().min(0).max(5).optional(), ...shape }); // delay: start this many seconds after the anchor word (choreography inside one word gap)

export const Action = z.discriminatedUnion("do", [
  act("create", { ...animation, edge: z.enum(["left", "right", "top", "bottom"]).optional() }),
  act("fade", { to: z.number().min(0).max(1).optional() }), // opacity only (default 0); a faded object stays addressable
  act("move", { to: z.union([z.string(), num2]).optional(), path: z.array(num2).min(2).optional(), arc: z.number().optional() }),
  act("transform", { scale: z.number().positive().optional(), scaleX: z.number().min(0).optional(), rotate: z.number().optional(), color: color.optional() }),
  act("highlight", { row: index.optional(), col: index.optional(), range: range.optional() }),
  act("indicate", {}),
  act("camera", { x: z.number().optional(), y: z.number().optional(), zoom: z.number().positive().optional(), shake: z.number().min(0).max(.1).optional() }, false), // OPEN QUESTION: camera DSL undecided, loosely typed on purpose
  act("wait", {}, false),
  act("pose", { to: Pose, aim: num2.optional() }), // person: animate to a new pose
  act("pulse", {}), // arrow/line: a dot travels from -> to (signal flow)
  act("op", { op: z.string(), args: z.array(z.unknown()).default([]) }),
]);

export const Transition = z.enum(["cut", "whip", "push", "match-cut"]);

export const SpeechBeat = z.object({
  say: z.string().min(1),
  actions: z.array(Action),
  cite: z.string().optional(),
  transition: Transition.optional(),
});
export const ReactionBeat = z.object({
  reaction: z.object({ intent: z.string(), maxSec: z.number().positive() }),
});
export const Beat = z.union([SpeechBeat, ReactionBeat]);

export const Scene = z.object({ scene: z.string(), objects: z.array(SceneObject), beats: z.array(Beat) });

export type SceneObject = z.infer<typeof SceneObject>;
export type Action = z.infer<typeof Action>;
export type Beat = z.infer<typeof Beat>;
export type Scene = z.infer<typeof Scene>;

// slot = a POSITION (index); val = an element IDENTITY that follows the value through ops.
export type Target = { id: string } | { id: string; slot: number } | { id: string; val: number | string };

export function parseTarget(s: string): Target | null {
  const m = /^([A-Za-z_][\w-]*)(?:\.slot\[(\d+)\]|\.val\(([^()\s]+)\))?$/.exec(s);
  if (!m) return null;
  if (m[2] !== undefined) return { id: m[1], slot: Number(m[2]) };
  if (m[3] !== undefined) return { id: m[1], val: isNaN(Number(m[3])) ? m[3] : Number(m[3]) };
  return { id: m[1] };
}
