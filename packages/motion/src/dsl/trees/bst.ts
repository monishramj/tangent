import { count, key, leaf, left, numeric, right, setLeft, setRight, type Node, type Trace, type TreeOps } from "./shared";

export function edit(t: Trace, n: Node | null, value: number, remove: boolean, balance: (n: Node) => Node = n => n): Node | null {
  if (!n) {
    if (remove) return null;
    const added = leaf(value); t.emit("create", added, { value }); return added;
  }
  t.highlight(n);
  if (value < key(n)) setLeft(n, edit(t, left(n), value, remove, balance));
  else if (value > key(n)) setRight(n, edit(t, right(n), value, remove, balance));
  else if (remove) {
    if (!left(n) || !right(n)) { t.emit("fade", n); return left(n) ?? right(n); }
    let successor = right(n)!;
    while (left(successor)) successor = left(successor)!;
    const next = key(successor);
    setRight(n, edit(t, right(n), next, true, balance));
    n.keys[0] = next;
    t.change(n, "replace");
  }
  return balance(n);
}
const ops: TreeOps = {
  insert(t, args) { count(args, 1); t.root = edit(t, t.root, numeric(args[0]), false); },
  remove(t, args) { count(args, 1); t.root = edit(t, t.root, numeric(args[0]), true); },
};
for (const direction of ["left", "right"] as const) {
  ops[direction === "left" ? "rotateLeft" : "rotateRight"] = (t, args) => {
    count(args, 1);
    const target = numeric(args[0]);
    if (!Number.isInteger(target) || target < 0) throw new Error("invalid rotation slot");
    // Decode the binary slot into its root-to-node path without sparse allocation.
    const path = (target + 1).toString(2).slice(1);
    const rotate = (n: Node | null, depth: number): Node => {
      if (!n) throw new Error("rotation slot is empty");
      if (depth === path.length) return t.rotate(n, direction);
      if (path[depth] === "0") setLeft(n, rotate(left(n), depth + 1));
      else setRight(n, rotate(right(n), depth + 1));
      return n;
    };
    t.root = rotate(t.root, 0);
  };
}
export default ops;
