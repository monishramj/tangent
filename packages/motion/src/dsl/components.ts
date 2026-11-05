// Computed components beyond Array/Tree: Stack, Queue, LinkedList (linear, keyed items) and Graph (BFS/DFS).
// Ops run the real data-structure code and emit steps: a `transform` carrying the new snapshot (`snap`), or a
// highlight on `id.slot[i]` (i = position in the snapshot at that moment). The renderer animates between snapshots.
import type { Action, SceneObject } from "./schema";
import type { OpSteps } from "./ops";

type Val = number | string;
export type Item = { k: string; v: Val };
export type SeqSnap = { items: Item[] };
export type GraphSnap = { visited: string[]; frontier: string[]; current?: string; tree: [string, string][]; mode?: "bfs" | "dfs" };
type Seq = Extract<SceneObject, { type: "Stack" | "Queue" | "LinkedList" }> & { _items?: Item[]; _n?: number };
type GraphObj = Extract<SceneObject, { type: "Graph" }>;
export type Component = Seq | GraphObj;

export const COMPONENT_OPS: Record<string, string[]> = {
  Stack: ["push", "pop", "peek"], Queue: ["enqueue", "dequeue", "peek"], LinkedList: ["insert", "delete", "traverse", "find"], Graph: ["bfs", "dfs"],
};
export const SEQ_MAX = 10;
export const seqItems = (o: { init: Val[]; _items?: Item[] }): Item[] => o._items ?? o.init.map((v, i) => ({ k: `i${i}`, v }));

function value(x: unknown): Val {
  if (typeof x === "string" && x.length > 0 && x.length <= 12) return x;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  throw new Error("value must be a number or a short string");
}
function count(op: string, args: unknown[], n: number) { if (args.length !== n) throw new Error(`${op} expects ${n} argument${n === 1 ? "" : "s"}`); }

export function expandComponent(object: Component, action: Extract<Action, { do: "op" }>): { object: Component; steps: OpSteps } {
  const { op, args, at } = action, id = object.id, steps: OpSteps = [];
  const snap = (s: SeqSnap | GraphSnap) => steps.push([{ at, do: "transform", target: id, snap: structuredClone(s) }]);
  const hl = (...slots: number[]) => steps.push(slots.map(i => ({ at, do: "highlight", target: `${id}.slot[${i}]` })));
  if (!COMPONENT_OPS[object.type].includes(op)) throw new Error(`${object.type} has no op "${op}" (has: ${COMPONENT_OPS[object.type].join(", ")})`);

  if (object.type === "Graph") {
    count(op, args, 1);
    const start = String(args[0]), ids = object.nodes.map(n => n.id);
    if (!ids.includes(start)) throw new Error(`${op}: no node "${start}"`);
    // Neighbours in node order, so the traversal (and the picture) is deterministic.
    const nbrs = (u: string) => ids.filter(v => object.edges.some(e => (e.from === u && e.to === v) || (!object.directed && e.to === u && e.from === v)));
    const s: GraphSnap = { visited: [], frontier: [start], tree: [], mode: op as "bfs" | "dfs" };
    snap(s);
    if (op === "bfs") {
      const seen = new Set([start]);
      while (s.frontier.length) {
        const u = s.frontier.shift()!;
        s.visited.push(u); s.current = u; snap(s);
        for (const v of nbrs(u)) if (!seen.has(v)) { seen.add(v); s.frontier.push(v); s.tree.push([u, v]); }
        snap(s);
      }
    } else {
      const visit = (u: string) => {
        s.visited.push(u); s.current = u; s.frontier = [...s.frontier.filter(x => x !== u), u]; snap(s);
        for (const v of nbrs(u)) if (!s.visited.includes(v)) { s.tree.push([u, v]); visit(v); s.current = u; }
        s.frontier = s.frontier.filter(x => x !== u);
      };
      s.frontier = [];
      visit(start);
    }
    s.current = undefined; s.frontier = []; snap(s);
    return { object, steps };
  }

  const items = seqItems(object).map(x => ({ ...x }));
  let n = object._n ?? object.init.length;
  const add = (i: number, v: Val) => {
    if (items.length >= SEQ_MAX) throw new Error(`${op}: ${object.type} is full (max ${SEQ_MAX})`);
    items.splice(i, 0, { k: `n${n++}`, v });
  };
  const need = () => { if (!items.length) throw new Error(`${op}: ${object.type} is empty`); };
  const index = (x: unknown, max: number) => {
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > max) throw new Error(`${op}: index ${String(x)} out of range 0..${max}`);
    return x;
  };
  const walk = (to: number) => { for (let i = 0; i < to; i++) hl(i); };
  const top = () => items.length - 1;
  switch (`${object.type}.${op}`) {
    case "Stack.push": case "Queue.enqueue": count(op, args, 1); add(items.length, value(args[0])); snap({ items }); hl(top()); break;
    case "Stack.pop": count(op, args, 0); need(); hl(top()); items.pop(); snap({ items }); break;
    case "Stack.peek": count(op, args, 0); need(); hl(top()); break;
    case "Queue.dequeue": count(op, args, 0); need(); hl(0); items.shift(); snap({ items }); break;
    case "Queue.peek": count(op, args, 0); need(); hl(0); break;
    case "LinkedList.insert": { count(op, args, 2); const i = index(args[0], items.length); walk(i); add(i, value(args[1])); snap({ items }); hl(i); break; }
    case "LinkedList.delete": { count(op, args, 1); need(); const i = index(args[0], items.length - 1); walk(i); hl(i); items.splice(i, 1); snap({ items }); break; }
    case "LinkedList.traverse": { count(op, args, 1); need(); walk(index(args[0], items.length - 1) + 1); break; }
    case "LinkedList.find": { // linear search: visit until the value matches (or the list ends)
      count(op, args, 1); const v = value(args[0]);
      for (let i = 0; i < items.length; i++) { hl(i); if (items[i].v === v) break; }
      break;
    }
  }
  return { object: { ...object, _items: items, _n: n } as Seq, steps };
}
