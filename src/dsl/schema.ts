// Scene DSL v0. zod over hand-rolled: one definition gives both the runtime check (with issue paths) and the TS types.
// Objects/actions are loose: extra style/layout props (x, y, color, ...) pass through; layout is not specified yet.
import { z } from "zod";
import { TREE_OPS } from "./treeOps";

const id = z.string().regex(/^[A-Za-z_][\w-]*$/);
const num2 = z.tuple([z.number(), z.number()]);
const point = z.union([id, num2]); // object id or [x, y]
const obj = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.looseObject({ id, type: z.literal(type), ...shape });

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
  obj("shape", { shape: z.enum(["rect", "circle", "polygon"]) }),
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
  z.looseObject({ at: z.string().min(1), do: z.literal(verb), target: targetRequired ? z.string() : z.string().optional(), ...shape });

export const Action = z.discriminatedUnion("do", [
  act("create", {}),
  act("fade", { to: z.number().min(0).max(1).optional() }), // opacity only (default 0); a faded object stays addressable
  act("move", {}),
  act("transform", {}),
  act("highlight", {}),
  act("indicate", {}),
  act("camera", {}, false), // OPEN QUESTION: camera DSL undecided, loosely typed on purpose
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
