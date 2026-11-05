// Generic operations address unique node keys: add(parent,value), remove(value), move(value,parent).
import { count, key, leaf, numeric, type Node, type Trace, type TreeOps } from "./shared";
function find(n: Node | null, value: number, parent: Node | null = null): { node: Node; parent: Node | null } | null {
  if (!n) return null;
  if (key(n) === value) return { node: n, parent };
  for (const c of n.children) { const found = find(c, value, n); if (found) return found; }
  return null;
}
function requireNode(t: Trace, value: unknown) {
  const found = find(t.root, numeric(value));
  if (!found) throw new Error("generic node does not exist");
  return found;
}
const ops: TreeOps = {
  add(t, args) {
    count(args, 2); const value = numeric(args[1]);
    if (find(t.root, value)) throw new Error("generic keys must be unique");
    const n = leaf(value);
    if (!t.root && args[0] === null) t.root = n;
    else requireNode(t, args[0]).node.children.push(n);
    t.emit("create", n, { value, parent: args[0] });
  },
  remove(t, args) {
    count(args, 1); const { node, parent } = requireNode(t, args[0]);
    t.emit("fade", node, { node: structuredClone(node) });
    if (!parent) t.root = null;
    else parent.children.splice(parent.children.indexOf(node), 1);
  },
  move(t, args) {
    count(args, 2);
    const { node, parent } = requireNode(t, args[0]), target = requireNode(t, args[1]).node;
    if (find(node, key(target))) throw new Error("cannot move a node into its own subtree");
    if (!parent) throw new Error("cannot move root");
    parent.children.splice(parent.children.indexOf(node), 1); target.children.push(node);
    t.emit("move", node, { parent: key(target), to: t.target(target) });
  },
};
export default ops;
