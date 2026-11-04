// Scene DSL v0. zod over hand-rolled: one definition gives both the runtime check (with issue paths) and the TS types.
// Objects/actions are loose: extra style/layout props (x, y, color, ...) pass through; layout is not specified yet.
import { z } from "zod";
import { TREE_OPS } from "./treeOps";

const id = z.string().regex(/^[A-Za-z_][\w-]*$/);
const num2 = z.tuple([z.number(), z.number()]);
export const CreateStyle = z.enum(["draw", "pop", "type", "slide", "stagger"]);
export const Easing = z.enum(["outCubic", "outBack", "inOutQuad"]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const animation = { style: CreateStyle.optional(), easing: Easing.optional(), gap: z.number().min(0).max(.9).optional() };
const index = z.number().int().nonnegative();
const range = z.tuple([index, index]).refine(([a, b]) => a <= b, "range must be ordered");
const unit = z.number().min(0).max(1);
const focus = z.tuple([unit, unit, unit, unit]).refine(([x, y, r, b]) => x < r && y < b, "focus box must have positive size");
const point = z.union([id, num2]); // object id or [x, y]
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
  obj("text", { text: z.string() }),
  obj("KineticText", { text: z.string(), variant: z.string().optional() }), // e.g. "slam"
  obj("Math", { tex: z.string() }), // KaTeX
  obj("shape", { shape: z.enum(["rect", "circle", "polygon"]), label: z.string().optional(), width: z.number().positive().optional(), height: z.number().positive().optional() }),
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
  obj("arrow", { from: point, to: point }),
  obj("line", { from: point, to: point }),
  obj("axes", { x: num2, y: num2 }),
  obj("plot", { axes: id, expr: z.string() }),
  obj("media", { src: z.string() }), // gif/image
  // computed components (MVP set; Heap, Graph, ... later)
  obj("Array", { init: z.array(z.union([z.number(), z.string()])), heap }),
  tree,
]);

const act = <K extends string, T extends z.ZodRawShape>(verb: K, shape: T, targetRequired = true) =>
  z.looseObject({ at: z.string().min(1), do: z.literal(verb), target: targetRequired ? z.string() : z.string().optional(), easing: Easing.optional(), duration: z.number().positive().optional(), ...shape });

export const Action = z.discriminatedUnion("do", [
  act("create", { ...animation, edge: z.enum(["left", "right", "top", "bottom"]).optional() }),
  act("fade", { to: z.number().min(0).max(1).optional() }), // opacity only (default 0); a faded object stays addressable
  act("move", { to: z.union([z.string(), num2]).optional(), path: z.array(num2).min(2).optional(), arc: z.number().optional() }),
  act("transform", { scale: z.number().positive().optional(), rotate: z.number().optional(), color: color.optional() }),
  act("highlight", { row: index.optional(), col: index.optional(), range: range.optional() }),
  act("indicate", {}),
  act("camera", { x: z.number().optional(), y: z.number().optional(), zoom: z.number().positive().optional(), shake: z.number().min(0).max(.1).optional() }, false), // OPEN QUESTION: camera DSL undecided, loosely typed on purpose
  act("wait", {}, false),
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
