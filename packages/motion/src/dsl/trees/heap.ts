import { count, key, leaf, left, right, setLeft, setRight, numeric, type Node, type Trace, type TreeOps } from "./shared";
function edit(t: Trace, args: unknown[], remove: boolean) {
  count(args, 1); const value = numeric(args[0]);
  const nodes: Node[] = [];
  const queue: (Node | null)[] = [t.root];
  let gap = false;
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (!n) { gap = true; continue; }
    if (gap) throw new Error("heap needs a complete binary tree");
    nodes.push(n); queue.push(left(n), right(n));
  }
  const slot = (i: number) => `${t.object.id}.slot[${i}]`;
  const swap = (i: number, j: number) => {
    t.steps.push([
      { at: t.at, do: "move", target: slot(i), to: slot(j), value: key(nodes[i]), operation: "sift" },
      { at: t.at, do: "move", target: slot(j), to: slot(i), value: key(nodes[j]), operation: "sift" },
    ]);
    [nodes[i].keys, nodes[j].keys] = [nodes[j].keys, nodes[i].keys];
  };
  const better = (a: number, b: number) => t.object.heap === "min" ? key(nodes[a]) < key(nodes[b]) : key(nodes[a]) > key(nodes[b]);
  let i: number;
  if (!remove) {
    i = nodes.length;
    const added = leaf(value); nodes.push(added);
    if (!i) t.root = added;
    else if (i % 2) setLeft(nodes[Math.floor((i - 1) / 2)], added);
    else setRight(nodes[Math.floor((i - 1) / 2)], added);
    t.emit("create", added, { value, to: slot(i) });
  } else {
    i = nodes.findIndex(n => key(n) === value);
    if (i < 0) return;
    const last = nodes.length - 1;
    if (i !== last) swap(i, last);
    t.emit("fade", nodes[last], { slot: last });
    nodes.pop();
    if (!last) t.root = null;
    else if (last % 2) setLeft(nodes[Math.floor((last - 1) / 2)], null);
    else setRight(nodes[Math.floor((last - 1) / 2)], null);
    if (i === last) return;
  }
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    t.highlight(nodes[parent]); t.highlight(nodes[i]);
    if (!better(i, parent)) break;
    swap(i, parent); i = parent;
  }
  while (2 * i + 1 < nodes.length) {
    const l = 2 * i + 1, r = l + 1;
    const child = r < nodes.length && better(r, l) ? r : l;
    t.highlight(nodes[i]); t.highlight(nodes[child]);
    if (!better(child, i)) break;
    swap(i, child); i = child;
  }
}
const ops: TreeOps = {
  insert: (t, args) => edit(t, args, false),
  remove: (t, args) => edit(t, args, true),
};
export default ops;
