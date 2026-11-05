import { edit } from "./bst";
import { count, left, right, setLeft, setRight, numeric, type Node, type Trace, type TreeOps } from "./shared";

const height = (n: Node | null): number => n ? 1 + Math.max(height(left(n)), height(right(n))) : 0;
const skew = (n: Node) => height(left(n)) - height(right(n));
function balance(t: Trace, n: Node): Node {
  if (skew(n) > 1) {
    if (skew(left(n)!) < 0) setLeft(n, t.rotate(left(n)!, "left"));
    return t.rotate(n, "right");
  }
  if (skew(n) < -1) {
    if (skew(right(n)!) > 0) setRight(n, t.rotate(right(n)!, "right"));
    return t.rotate(n, "left");
  }
  return n;
}
const ops: TreeOps = {};
for (const op of ["insert", "remove"]) ops[op] = (t, args) => {
  count(args, 1);
  t.root = edit(t, t.root, numeric(args[0]), op === "remove", n => balance(t, n));
};
export default ops;
