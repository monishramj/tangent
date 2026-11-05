import { describe, expect, it } from "vitest";
import { expandOp } from "./ops";
import { validateScene } from "./validate";
import { area, binomialPmf, normalCdf } from "./stats";
import type { Action, SceneObject } from "./schema";
import type { GraphSnap, SeqSnap } from "./components";

const op = (target: string, name: string, ...args: unknown[]) => ({ at: "x", do: "op", target, op: name, args }) as Action;
const run = (o: Record<string, unknown>, ...ops: [string, ...unknown[]][]) => {
  let obj = o as SceneObject, steps: Action[][] = [];
  for (const [name, ...args] of ops) { const r = expandOp(obj, op(obj.id, name, ...args)); obj = r.object as SceneObject; steps = steps.concat(r.steps); }
  const snaps = steps.flat().filter(a => a.do === "transform").map(a => (a as unknown as { snap: unknown }).snap);
  return { obj, steps, snaps };
};
const last = <T,>(a: T[]) => a[a.length - 1];
const vals = (s: unknown) => (s as SeqSnap).items.map(i => i.v);

describe("Stack / Queue / LinkedList ops", () => {
  it("stack push/pop/peek, keys follow items", () => {
    const { snaps, steps } = run({ id: "s", type: "Stack", init: [3, 7] }, ["push", 9], ["pop"], ["peek"]);
    expect(snaps.map(vals)).toEqual([[3, 7, 9], [3, 7]]);
    expect(steps[steps.length - 1]).toEqual([{ at: "x", do: "highlight", target: "s.slot[1]" }]);
    expect((snaps[0] as SeqSnap).items.map(i => i.k)).toEqual(["i0", "i1", "n2"]);
  });
  it("queue is FIFO and errors when empty", () => {
    expect(run({ id: "q", type: "Queue", init: ["A"] }, ["enqueue", "B"], ["dequeue"]).snaps.map(vals)).toEqual([["A", "B"], ["B"]]);
    expect(() => run({ id: "q", type: "Queue", init: [] }, ["dequeue"])).toThrow(/empty/);
  });
  it("linked list insert/delete walk to the index first; find stops at the match", () => {
    const r = run({ id: "l", type: "LinkedList", init: [4, 8, 15] }, ["insert", 1, 6], ["delete", 3]);
    expect(r.snaps.map(vals)).toEqual([[4, 6, 8, 15], [4, 6, 8]]);
    const f = run({ id: "l", type: "LinkedList", init: [4, 8, 15] }, ["find", 8]);
    expect(f.steps.map(s => s[0].target)).toEqual(["l.slot[0]", "l.slot[1]"]);
    expect(() => run({ id: "l", type: "LinkedList", init: [1] }, ["delete", 2])).toThrow(/out of range/);
  });
});

describe("Graph traversals are real BFS / DFS", () => {
  const g = { id: "g", type: "Graph", directed: false, nodes: ["A", "B", "C", "D", "E", "F"].map(id => ({ id })),
    edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["C", "E"], ["D", "F"], ["E", "F"]].map(([from, to]) => ({ from, to })) };
  it("bfs visits level by level with a FIFO frontier", () => {
    const end = last(run(g, ["bfs", "A"]).snaps) as GraphSnap;
    expect(end.visited).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(end.tree).toEqual([["A", "B"], ["A", "C"], ["B", "D"], ["C", "E"], ["D", "F"]]);
    const mid = run(g, ["bfs", "A"]).snaps.find(s => (s as GraphSnap).current === "B" && (s as GraphSnap).frontier.length === 2) as GraphSnap;
    expect(mid.frontier).toEqual(["C", "D"]);
  });
  it("dfs goes deep first; frontier is the recursion path", () => {
    const snaps = run(g, ["dfs", "A"]).snaps as GraphSnap[];
    expect(last(snaps).visited).toEqual(["A", "B", "D", "C", "E", "F"]);
    expect(snaps.find(s => s.current === "E")!.frontier).toEqual(["A", "B", "D", "C", "E"]);
  });
  it("respects direction and rejects unknown starts", () => {
    const d = { ...g, directed: true, edges: [{ from: "B", to: "A" }, { from: "A", to: "C" }] };
    expect((last(run(d, ["bfs", "A"]).snaps) as GraphSnap).visited).toEqual(["A", "C"]);
    expect(() => run(g, ["bfs", "Z"])).toThrow(/no node/);
  });
  it("validator dry-runs ops and reports bad arguments per beat", () => {
    const errs = validateScene({ scene: "s", objects: [{ id: "s", type: "Stack", init: [] }], beats: [{ say: "pop it now", actions: [{ at: "pop", do: "create", target: "s" }, { at: "now", do: "op", target: "s", op: "pop", args: [] }] }] });
    expect(errs).toEqual([expect.objectContaining({ code: "bad-op-args", beat: 0 })]);
  });
});

describe("stats", () => {
  it("normal / uniform / binomial areas", () => {
    expect(area({ kind: "normal", mean: 0, sd: 1, min: 0, max: 1, n: 1, p: .5 }, -1, 1)).toBeCloseTo(.6827, 4);
    expect(normalCdf(1.96)).toBeCloseTo(.975, 3);
    expect(area({ kind: "uniform", mean: 0, sd: 1, min: 0, max: 10, n: 1, p: .5 }, 2, 5)).toBeCloseTo(.3);
    expect(area({ kind: "binomial", mean: 0, sd: 1, min: 0, max: 1, n: 4, p: .5 }, 1, 2)).toBeCloseTo(10 / 16);
    expect(binomialPmf(2, 4, .5)).toBeCloseTo(6 / 16);
  });
});
