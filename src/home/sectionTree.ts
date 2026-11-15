/** Flat pre-order outline. A subtree is the slice [i, end[i]]. */
export type TreeRow = { id: string; level: number };
export type TreeModel = { end: number[]; parent: number[]; kids: number[][] };
export type SelectState = 'none' | 'some' | 'full';

export function treeModel(rows: TreeRow[]): TreeModel {
  const end = rows.map((_, i) => { let j = i; while (j + 1 < rows.length && rows[j + 1].level > rows[i].level) j++; return j; });
  const parent = rows.map((_, i) => { for (let j = i - 1; j >= 0; j--) if (rows[j].level < rows[i].level) return j; return -1; });
  const kids = rows.map((_, i) => rows.flatMap((_c, j) => j > i && j <= end[i] && parent[j] === i ? [j] : []));
  return { end, parent, kids };
}

/** Parent is in the set iff every direct child is, so partial state is derivable from the set. */
export function normalizeSelection(sel: Set<string>, rows: TreeRow[], m: TreeModel) {
  for (let i = rows.length - 1; i >= 0; i--) if (m.kids[i].length) {
    if (m.kids[i].every(k => sel.has(rows[k].id))) sel.add(rows[i].id); else sel.delete(rows[i].id);
  }
  return sel;
}

/** Select or clear [a, b], expanding through the end of any subtree the range touches. */
export function paintSelection(base: Set<string>, rows: TreeRow[], m: TreeModel, a: number, b: number, add: boolean) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let top = hi;
  for (let i = lo; i <= hi; i++) top = Math.max(top, m.end[i]);
  const next = new Set(base);
  for (let i = lo; i <= top; i++) add ? next.add(rows[i].id) : next.delete(rows[i].id);
  return normalizeSelection(next, rows, m);
}

export function selectionState(i: number, sel: Set<string>, rows: TreeRow[], m: TreeModel): SelectState {
  if (sel.has(rows[i].id)) return 'full';
  for (let j = i + 1; j <= m.end[i]; j++) if (sel.has(rows[j].id)) return 'some';
  return 'none';
}
