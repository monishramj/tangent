import { expect, it } from 'vitest';
import { topSelected, type SectionRef } from './api';
import { paintSelection, selectionState, treeModel } from './sectionTree';

const rows: SectionRef[] = [
  { id: 'a', title: 'A', level: 1, anchors: [] },
  { id: 'a1', title: 'A1', level: 2, anchors: [] },
  { id: 'a2', title: 'A2', level: 2, anchors: [] },
  { id: 'b', title: 'B', level: 1, anchors: [] },
];

it('selects a whole subtree, keeps a partial parent out, and still reports topSelected ids', () => {
  const m = treeModel(rows);
  const all = paintSelection(new Set(), rows, m, 0, 0, true);
  expect([...all]).toEqual(['a', 'a1', 'a2']);
  expect(topSelected(rows, all)).toEqual(['a']);
  const some = paintSelection(new Set(), rows, m, 1, 1, true);
  expect(some.has('a')).toBe(false);
  expect(selectionState(0, some, rows, m)).toBe('some');
  expect(topSelected(rows, some)).toEqual(['a1']);
  expect(treeModel([{ id: 'z', level: 0 }]).parent).toEqual([-1]);
});
