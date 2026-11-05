import { count, leaf, numeric, type Node, type Trace, type TreeOps } from "./shared";
const position = (n: Node, value: number) => { let i = 0; while (i < n.keys.length && n.keys[i] < value) i++; return i; };
function split(t: Trace, n: Node): { value: number; sibling: Node } {
  const mid = Math.floor(n.keys.length / 2);
  const sibling: Node = { keys: n.keys.splice(mid + 1), children: n.children.splice(mid + 1) };
  const value = n.keys.pop()!;
  t.emit("create", sibling, { node: structuredClone(sibling), operation: "split" });
  t.change(n, "split");
  return { value, sibling };
}
function insert(t: Trace, n: Node, value: number) {
  t.highlight(n);
  const i = position(n, value);
  if (n.keys[i] === value) return;
  if (!n.children.length) { n.keys.splice(i, 0, value); t.change(n, "insert"); return; }
  const child = n.children[i]!;
  insert(t, child, value);
  if (child.keys.length >= t.object.order) {
    const { value: promoted, sibling } = split(t, child);
    n.keys.splice(i, 0, promoted); n.children.splice(i + 1, 0, sibling); t.change(n, "split");
  }
}
function repair(t: Trace, n: Node, i: number) {
  const child = n.children[i]!;
  const min = Math.ceil(t.object.order / 2) - 1;
  if (child.keys.length >= min) return;
  const prev = n.children[i - 1], next = n.children[i + 1];
  if (prev && prev.keys.length > min) {
    child.keys.unshift(n.keys[i - 1]); n.keys[i - 1] = prev.keys.pop()!;
    if (prev.children.length) child.children.unshift(prev.children.pop()!);
    t.change(n, "borrow");
  } else if (next && next.keys.length > min) {
    child.keys.push(n.keys[i]); n.keys[i] = next.keys.shift()!;
    if (next.children.length) child.children.push(next.children.shift()!);
    t.change(n, "borrow");
  } else {
    const at = prev ? i - 1 : i;
    const a = n.children[at]!, b = n.children[at + 1]!;
    t.emit("fade", b, { operation: "merge" });
    a.keys.push(n.keys.splice(at, 1)[0], ...b.keys); a.children.push(...b.children);
    n.children.splice(at + 1, 1); t.change(n, "merge");
  }
}
function remove(t: Trace, n: Node, value: number) {
  t.highlight(n);
  const i = position(n, value);
  if (n.keys[i] === value) {
    if (!n.children.length) { n.keys.splice(i, 1); t.change(n, "remove"); return; }
    let predecessor = n.children[i]!;
    while (predecessor.children.length) predecessor = predecessor.children[predecessor.children.length - 1]!;
    const replacement = predecessor.keys[predecessor.keys.length - 1];
    n.keys[i] = replacement;
    remove(t, n.children[i]!, replacement); repair(t, n, i);
  } else if (n.children.length) { remove(t, n.children[i]!, value); repair(t, n, i); }
}
const ops: TreeOps = {
  insert(t, args) {
    count(args, 1); const value = numeric(args[0]);
    if (!t.root) { t.root = leaf(value); t.emit("create", t.root, { value }); return; }
    insert(t, t.root, value);
    if (t.root.keys.length >= t.object.order) {
      const old = t.root, { value: promoted, sibling } = split(t, old);
      t.root = { keys: [promoted], children: [old, sibling] };
      t.emit("create", t.root, { node: structuredClone(t.root), operation: "split" });
    }
  },
  remove(t, args) {
    count(args, 1); const value = numeric(args[0]);
    if (!t.root) return;
    remove(t, t.root, value);
    if (!t.root.keys.length) {
      t.emit("fade", t.root, { operation: "merge" }); t.root = t.root.children[0] ?? null;
    }
  },
};
export default ops;
