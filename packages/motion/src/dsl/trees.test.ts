import { describe, expect, it } from "vitest";
import { Action, Scene, SceneObject, type TreeNode } from "./schema";
import { compileOps, expandOp } from "./ops";
import { validateScene } from "./validate";

const node = (key: number, children: (TreeNode | null)[] = []): TreeNode => ({ keys: [key], children });
const make = (kind: string, init: TreeNode | null = null, extra = {}) =>
  SceneObject.parse({ id: "t", type: "Tree", kind, init, ...extra });
const action = (op: string, args: unknown[]) => Action.parse({ at: "go", do: "op", target: "t", op, args });
const run = (o: SceneObject, op: string, args: unknown[]) => expandOp(o, action(op, args));
const root = (o: SceneObject) => o.init as TreeNode | null;
const values = (n: TreeNode | null): number[] => n ? [...n.keys, ...n.children.flatMap(values)] : [];
function binary(n: TreeNode | null, lo = -Infinity, hi = Infinity): number {
  if (!n) return 0;
  expect(n.keys).toHaveLength(1);
  expect(n.keys[0]).toBeGreaterThan(lo);
  expect(n.keys[0]).toBeLessThan(hi);
  const l = binary(n.children[0] ?? null, lo, n.keys[0]);
  const r = binary(n.children[1] ?? null, n.keys[0], hi);
  return 1 + Math.max(l, r);
}
function avl(n: TreeNode | null): number {
  if (!n) return 0;
  const l = avl(n.children[0] ?? null), r = avl(n.children[1] ?? null);
  expect(Math.abs(l - r)).toBeLessThanOrEqual(1);
  return 1 + Math.max(l, r);
}
function rb(n: TreeNode | null): number {
  if (!n) return 1;
  expect(n.color === "red" || n.color === "black").toBe(true);
  if (n.color === "red") for (const c of n.children) expect(c?.color).not.toBe("red");
  const l = rb(n.children[0] ?? null), r = rb(n.children[1] ?? null);
  expect(l).toBe(r);
  return l + Number(n.color === "black");
}
function btree(n: TreeNode | null, order: number, isRoot = true, lo = -Infinity, hi = Infinity): number {
  if (!n) return 0;
  expect(n.keys.length).toBeGreaterThanOrEqual(isRoot ? 1 : Math.ceil(order / 2) - 1);
  expect(n.keys.length).toBeLessThan(order);
  expect(n.keys).toEqual([...n.keys].sort((a, b) => a - b));
  for (const k of n.keys) { expect(k).toBeGreaterThan(lo); expect(k).toBeLessThan(hi); }
  if (!n.children.length) return 1;
  expect(n.children).toHaveLength(n.keys.length + 1);
  const heights = n.children.map((c, i) => {
    expect(c).not.toBeNull();
    return btree(c, order, false, i ? n.keys[i - 1] : lo, i < n.keys.length ? n.keys[i] : hi);
  });
  expect(new Set(heights).size).toBe(1);
  return 1 + heights[0];
}

describe("tree kinds", () => {
  it("defaults to BST and accepts nested and legacy binary data without mutation", () => {
    const o = SceneObject.parse({ id: "t", type: "Tree", init: node(4, [node(2), node(7)]) });
    expect(o.kind).toBe("bst");
    const before = structuredClone(o);
    expect(values(root(run(o, "remove", [4]).object)).sort()).toEqual([2, 7]);
    expect(o).toEqual(before);
    const legacy = SceneObject.parse({ id: "t", type: "Tree", init: [4, 2, 7] });
    expect(run(legacy, "insert", [6]).object.init).toEqual([4, 2, 7, null, null, 6]);
  });

  it.each(["avl", "redblack"])("%s maintains search and balance invariants through inserts and deletes", kind => {
    let o = make(kind);
    const steps: Action[] = [];
    const present = new Set<number>();
    const input = [30, 10, 20, 50, 40, 60, 5, 1, 7, 15, 25, 45, 55, 70, 65];
    for (const [op, xs] of [["insert", input], ["remove", [30, 1, 50, 10, 65, 7, 20, 5, 15, 25, 40, 45, 55, 60, 70]]] as const) {
      for (const x of xs) {
        const before = structuredClone(o);
        const result = run(o, op, [x]);
        expect(o).toEqual(before);
        o = result.object;
        steps.push(...result.steps.flat());
        if (op === "insert") present.add(x); else present.delete(x);
        expect(values(root(o)).sort((a, b) => a - b)).toEqual([...present].sort((a, b) => a - b));
        binary(root(o));
        if (kind === "avl") avl(root(o));
        else { if (root(o)) expect(root(o)?.color).toBe("black"); rb(root(o)); }
      }
    }
    expect(root(o)).toBeNull();
    expect(steps.some(s => s.operation === "rotateLeft" || s.operation === "rotateRight")).toBe(true);
    if (kind === "redblack") expect(steps.some(s => s.color === "red")).toBe(true);
  });

  it("accepts right-leaning red-black input and retains colors after shorthand conversion", () => {
    let o = make("redblack", { keys: [2], color: "black", children: [null, { ...node(3), color: "red" }] });
    o = run(o, "insert", [4]).object;
    binary(root(o)); rb(root(o));
    o = run(o, "remove", [2]).object;
    binary(root(o)); rb(root(o));
    o = SceneObject.parse({ id: "t", type: "Tree", kind: "redblack", init: [4, 2, 6] });
    for (const x of [1, 3, 5, 7]) { o = run(o, "insert", [x]).object; rb(root(o)); }
    expect(Array.isArray(o.init)).toBe(false);
  });

  it.each(["bst", "avl", "redblack", "btree"])("%s ignores duplicate inserts and missing removals", kind => {
    let o = make(kind);
    for (const x of [4, 2, 6]) o = run(o, "insert", [x]).object;
    const before = structuredClone(o);
    expect(run(o, "insert", [4]).object).toEqual(before);
    expect(run(o, "remove", [99]).object).toEqual(before);
    expect(() => run(o, "toString", [])).toThrow();
  });

  it.each([3, 4, 5, 6])("B-tree order %i splits, borrows, merges and collapses the root", order => {
    let o = make("btree", null, { order });
    const present = new Set<number>();
    const input = Array.from({ length: 40 }, (_, i) => (i * 17) % 40);
    const steps: Action[] = [];
    for (const op of ["insert", "remove"]) for (const x of input) {
      const result = run(o, op, [x]);
      o = result.object;
      steps.push(...result.steps.flat());
      if (op === "insert") present.add(x); else present.delete(x);
      expect(values(root(o)).sort((a, b) => a - b)).toEqual([...present].sort((a, b) => a - b));
      btree(root(o), order);
    }
    expect(root(o)).toBeNull();
    expect(steps.some(s => s.operation === "split")).toBe(true);
    expect(steps.some(s => s.operation === "merge")).toBe(true);
  });

  it.each(["min", "max"])("Tree and Array support %s heaps", heap => {
    let o = make("heap", null, { heap });
    const check = () => {
      const walk = (n: TreeNode | null) => {
        if (!n) return;
        for (const c of n.children) if (c) {
          expect(heap === "min" ? n.keys[0] <= c.keys[0] : n.keys[0] >= c.keys[0]).toBe(true);
          walk(c);
        }
      };
      walk(root(o));
    };
    for (const x of [3, 9, 7, 1, 4, 9]) { o = run(o, "insert", [x]).object; check(); }
    for (const x of [9, 1, 7, 4, 3, 9]) { o = run(o, "remove", [x]).object; check(); }
    expect(root(o)).toBeNull();
    const a = SceneObject.parse({ id: "t", type: "Array", heap, init: heap === "min" ? [9, 1, 3, 2] : [1, 9, 7, 4] });
    expect(run(a, "siftDown", [0]).object.init).toEqual(heap === "min" ? [1, 2, 3, 9] : [9, 4, 7, 1]);
    const up = SceneObject.parse({ id: "t", type: "Array", heap, init: [4, 6, heap === "min" ? 1 : 9] });
    expect(run(up, "siftUp", [2]).object.init).toEqual(heap === "min" ? [1, 6, 4] : [9, 6, 4]);
  });

  it("generic adds, moves and removes subtrees, rejecting cycles", () => {
    let o = make("generic", node(1, [node(2), node(3)]));
    o = run(o, "add", [2, 4]).object; // parent value, new value
    expect(values(root(o))).toEqual([1, 2, 4, 3]);
    o = run(o, "move", [2, 3]).object; // node value, new parent value
    expect(root(o)?.children[0]?.children[0]?.keys).toEqual([2]);
    expect(() => run(o, "move", [3, 4])).toThrow();
    o = run(o, "remove", [3]).object;
    expect(values(root(o))).toEqual([1]);
    expect(() => run(o, "add", [99, 5])).toThrow();
  });

  it("rejects invalid options, data shapes, kind-specific ops and arguments", () => {
    for (const props of [{ kind: "no" }, { order: 2 }, { heap: "no" }, { init: { keys: [], children: [] } },
      { kind: "btree", init: [1] }, { kind: "generic", init: [1] },
      { init: node(1, [node(2), node(3), node(4)]) }, { init: { keys: [1], children: [], color: "blue" } }])
      expect(SceneObject.safeParse({ id: "t", type: "Tree", init: null, ...props }).success).toBe(false);
    expect(() => run(make("avl", node(1)), "rotateLeft", [0])).toThrow();
    expect(() => run(make("btree"), "insert", [NaN])).toThrow();
    expect(() => run(make("heap"), "insert", [1, 2])).toThrow();
    const scene = Scene.parse({ scene: "kinds", objects: [make("generic", node(1))], beats: [
      { say: "make go", actions: [{ at: "make", do: "create", target: "t" }, action("insert", [2])] },
    ] });
    expect(validateScene(scene).some(e => e.code === "unknown-op")).toBe(true);
    scene.beats[0] = { say: "make go", actions: [{ at: "make", do: "create", target: "t" }, action("add", [1, 2])] };
    expect(validateScene(scene)).toEqual([]);
  });

  it.each(["avl", "redblack", "btree", "heap", "generic"])("compiles %s steps through the existing timeline", kind => {
    const scene = Scene.parse({ scene: "kinds", objects: [make(kind)], beats: [
      { say: "go", actions: [action(kind === "generic" ? "add" : "insert", kind === "generic" ? [null, 4] : [4])] },
    ] });
    const before = structuredClone(scene);
    const tl = compileOps(scene, [{ words: [{ word: "go", start: 0, end: 0.2 }], duration: 2 }]);
    expect(tl.events.some(e => e.verb === "create")).toBe(true);
    expect(tl.events.some(e => e.verb === "op")).toBe(false);
    expect(tl.events.every(e => Number.isFinite(e.end))).toBe(true);
    expect(scene).toEqual(before);
  });
});
