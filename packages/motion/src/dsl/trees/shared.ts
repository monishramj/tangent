import type { Action, TreeNode, TreeObject } from "../schema";
import type { OpSteps } from "../ops";

export type Node = TreeNode;
export const leaf = (value: number): Node => ({ keys: [value], children: [] });
export const left = (n: Node) => n.children[0] ?? null;
export const right = (n: Node) => n.children[1] ?? null;
export const key = (n: Node) => n.keys[0];
export const setLeft = (n: Node, c: Node | null) => {
  if (c || n.children.length) n.children[0] = c;
};
export const setRight = (n: Node, c: Node | null) => {
  if (c || n.children.length > 1) { n.children[0] ??= null; n.children[1] = c; }
};
export function numeric(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error("Tree op needs a finite numeric value");
  return x;
}
export function count(args: unknown[], n: number) {
  if (args.length !== n) throw new Error(`Tree op expects ${n} arguments`);
}
export function fromLevel(init: (number | null)[], i = 0): Node | null {
  return init[i] == null ? null : { keys: [init[i]!], children: [fromLevel(init, 2 * i + 1), fromLevel(init, 2 * i + 2)] };
}
export function toLevel(root: Node | null): (number | null)[] {
  const init: (number | null)[] = [];
  const write = (n: Node | null, i: number) => {
    if (!n) return;
    // shortcut: legacy array output needs sparse padding; use nested init for deep trees.
    if (i > 1_000_000) throw new Error("Tree operation exceeds level-order layout capacity");
    while (init.length <= i) init.push(null);
    init[i] = key(n);
    write(left(n), 2 * i + 1); write(right(n), 2 * i + 2);
  };
  write(root, 0);
  return init;
}

export class Trace {
  root: Node | null;
  steps: OpSteps = [];
  private identities = new WeakMap<Node, number>();
  constructor(readonly object: TreeObject, readonly at: string) {
    this.root = Array.isArray(object.init) ? fromLevel(object.init) : structuredClone(object.init);
    if (object.kind === "redblack") {
      const color = (n: Node | null) => {
        if (!n) return;
        n.color ??= "black"; n.children.forEach(color);
      };
      color(this.root);
    }
  }
  target(n: Node) {
    if (!this.identities.has(n)) this.identities.set(n, key(n));
    return `${this.object.id}.val(${this.identities.get(n)})`;
  }
  emit(verb: "highlight" | "move" | "create" | "fade" | "transform", n: Node, props = {}) {
    this.steps.push([{ at: this.at, do: verb, target: this.target(n), ...props }]);
  }
  highlight(n: Node) { this.emit("highlight", n); }
  change(n: Node, operation: string) {
    this.emit("transform", n, { operation, node: structuredClone(n) });
  }
  rotate(n: Node, direction: "left" | "right"): Node {
    const pivot = direction === "left" ? right(n) : left(n);
    if (!pivot) throw new Error("rotation needs a child");
    const locate = (root: Node | null, i: number): number | undefined => {
      if (!root) return;
      if (root === n) return i;
      return locate(left(root), 2 * i + 1) ?? locate(right(root), 2 * i + 2);
    };
    const start = locate(this.root, 0) ?? 0;
    const positions = (root: Node, i: number, out = new Map<Node, number>()) => {
      out.set(root, i);
      if (left(root)) positions(left(root)!, 2 * i + 1, out);
      if (right(root)) positions(right(root)!, 2 * i + 2, out);
      return out;
    };
    const before = positions(n, start);
    this.highlight(n); this.highlight(pivot);
    if (direction === "left") { setRight(n, left(pivot)); setLeft(pivot, n); }
    else { setLeft(n, right(pivot)); setRight(pivot, n); }
    const operation = `rotate${direction === "left" ? "Left" : "Right"}`;
    const moves: Action[] = [];
    for (const [node, i] of positions(pivot, start)) {
      const from = before.get(node)!;
      if (from !== i) moves.push({ at: this.at, do: "move", target: `${this.object.id}.slot[${from}]`,
        to: `${this.object.id}.slot[${i}]`, value: key(node), operation });
    }
    this.steps.push(moves);
    this.change(pivot, operation);
    return pivot;
  }
  color(n: Node | null, color: "red" | "black") {
    if (n && n.color !== color) { n.color = color; this.emit("highlight", n, { color, operation: "recolor" }); }
  }
  finish(): { object: TreeObject; steps: OpSteps } {
    const init = this.object.kind === "bst" && Array.isArray(this.object.init) ? toLevel(this.root) : this.root;
    if (JSON.stringify(init) !== JSON.stringify(this.object.init))
      this.steps.push([{ at: this.at, do: "transform", target: this.object.id, init: structuredClone(init) }]);
    return { object: { ...this.object, init }, steps: this.steps };
  }
}
export type TreeOps = Record<string, (trace: Trace, args: unknown[]) => void>;
