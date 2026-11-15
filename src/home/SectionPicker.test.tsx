import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import SectionPicker, { type PickerRow } from './SectionPicker';

afterEach(cleanup);
const rows: PickerRow[] = [
  { id: 'a', title: 'Heaps', level: 1, pages: 'pp. 3-5' },
  { id: 'a1', title: 'Heapify', level: 2, pages: 'p. 4' },
  { id: 'a2', title: 'Build', level: 2, pages: 'p. 5' },
];

function Harness() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return <SectionPicker rows={rows} selected={selected} onChange={setSelected} />;
}

it('selects a section from its title or brace, shows partial, and moves by keyboard', () => {
  const { container } = render(<Harness />);
  fireEvent.click(screen.getByRole('treeitem', { name: /Heapify/ }));
  expect(screen.getByRole('treeitem', { name: /Heapify/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('treeitem', { name: /Heaps/ }).getAttribute('aria-description')).toBe('Partly selected');
  fireEvent.click(container.querySelector('.pk-brace')!);
  expect(screen.getAllByRole('treeitem').every(el => el.getAttribute('aria-selected') === 'true')).toBe(true);
  fireEvent.click(screen.getByRole('treeitem', { name: /Heaps/ }));
  expect(screen.getAllByRole('treeitem').every(el => el.getAttribute('aria-selected') === 'false')).toBe(true);
  const first = screen.getByRole('treeitem', { name: /Heaps/ });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement?.textContent).toContain('Heapify');
  fireEvent.keyDown(document.activeElement!, { key: ' ' });
  expect(screen.getByRole('treeitem', { name: /Heapify/ }).getAttribute('aria-selected')).toBe('true');
});
