import { count, key, leaf, left, right, setLeft, setRight, numeric, type Node, type Trace, type TreeOps } from "./shared";
const red = (n: Node | null) => n?.color === "red";

function edit(t: Trace, args: unknown[], remove: boolean) {
  count(args, 1); const value = numeric(args[0]);
  const parents = new Map<Node, Node | null>();
  const visit = (n: Node | null, p: Node | null) => {
    if (!n) return;
    parents.set(n, p); visit(left(n), n); visit(right(n), n);
  };
  visit(t.root, null);
  const parent = (n: Node) => parents.get(n) ?? null;
  const replace = (n: Node, replacement: Node | null) => {
    const p = parent(n);
    if (!p) t.root = replacement;
    else if (left(p) === n) setLeft(p, replacement);
    else setRight(p, replacement);
    if (replacement) parents.set(replacement, p);
  };
  const rotate = (n: Node, direction: "left" | "right") => {
    const pivot = t.rotate(n, direction);
    replace(n, pivot); parents.set(n, pivot);
    const moved = direction === "left" ? right(n) : left(n);
    if (moved) parents.set(moved, n);
  };
  let n = t.root, p: Node | null = null;
  while (n && key(n) !== value) {
    t.highlight(n); p = n; n = value < key(n) ? left(n) : right(n);
  }
  if (!remove) {
    if (n) return;
    let added: Node = leaf(value); parents.set(added, p);
    if (!p) t.root = added;
    else if (value < key(p)) setLeft(p, added); else setRight(p, added);
    t.emit("create", added, { value }); t.color(added, "red");
    while (parent(added) && red(parent(added))) {
      p = parent(added)!;
      const g: Node = parent(p)!;
      const isLeft: boolean = left(g) === p;
      const uncle = isLeft ? right(g) : left(g);
      if (red(uncle)) {
        t.color(p, "black"); t.color(uncle, "black"); t.color(g, "red"); added = g;
      } else {
        if ((isLeft ? right(p) : left(p)) === added) {
          added = p; rotate(added, isLeft ? "left" : "right"); p = parent(added)!;
        }
        t.color(p, "black"); t.color(g, "red"); rotate(g, isLeft ? "right" : "left");
      }
    }
    t.color(t.root, "black");
    return;
  }
  if (!n) return;
  t.highlight(n);
  let deleted = n;
  if (left(n) && right(n)) {
    deleted = right(n)!;
    while (left(deleted)) { t.highlight(deleted); deleted = left(deleted)!; }
    n.keys[0] = key(deleted); t.change(n, "replace");
  }
  const wasRed = red(deleted);
  let x = left(deleted) ?? right(deleted);
  p = parent(deleted);
  t.emit("fade", deleted); replace(deleted, x);
  if (wasRed) return;
  while (x !== t.root && !red(x)) {
    if (!p) break;
    const isLeft = left(p) === x;
    let sibling = isLeft ? right(p) : left(p);
    if (red(sibling)) {
      t.color(sibling, "black"); t.color(p, "red"); rotate(p, isLeft ? "left" : "right");
      sibling = isLeft ? right(p) : left(p);
    }
    const near = sibling ? (isLeft ? left(sibling) : right(sibling)) : null;
    let far = sibling ? (isLeft ? right(sibling) : left(sibling)) : null;
    if (!red(near) && !red(far)) {
      t.color(sibling, "red"); x = p; p = parent(x);
    } else {
      if (!red(far)) {
        t.color(near, "black"); t.color(sibling, "red"); rotate(sibling!, isLeft ? "right" : "left");
        sibling = isLeft ? right(p) : left(p);
        far = sibling ? (isLeft ? right(sibling) : left(sibling)) : null;
      }
      t.color(sibling, p.color ?? "black"); t.color(p, "black"); t.color(far, "black");
      rotate(p, isLeft ? "left" : "right"); x = t.root; p = null;
    }
  }
  t.color(x, "black");
}
const ops: TreeOps = {
  insert: (t, args) => edit(t, args, false),
  remove: (t, args) => edit(t, args, true),
};
export default ops;
