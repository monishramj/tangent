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

it('browses the same hierarchy without selection state or selection gestures', () => {
  const selected = new Set(rows.map(row => row.id));
  const changes: Set<string>[] = [];
  const onChange = (next: Set<string>) => changes.push(next);
  const view = render(<SectionPicker rows={rows} selected={selected} onChange={onChange} browse />);
  const tree = screen.getByRole('tree');
  const items = screen.getAllByRole('treeitem');
  const brace = view.container.querySelector('.pk-brace') as HTMLButtonElement;
  expect(brace.disabled).toBe(true);
  expect(tree.hasAttribute('aria-multiselectable')).toBe(false);
  expect(items.every(item => !item.hasAttribute('aria-selected') && !item.hasAttribute('data-state'))).toBe(true);
  fireEvent.click(items[0]);
  fireEvent.pointerDown(items[0], { button: 0, buttons: 1 });
  fireEvent.pointerEnter(items[1], { buttons: 1 });
  fireEvent.keyDown(items[0], { key: 'ArrowRight', shiftKey: true });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(items[1], { key: ' ' });
  fireEvent.keyDown(items[1], { key: 'Enter' });
  fireEvent.keyDown(items[1], { key: 'End' });
  expect(document.activeElement).toBe(items[2]);
  fireEvent.keyDown(items[2], { key: 'Home' });
  expect(document.activeElement).toBe(items[0]);
  expect(changes).toHaveLength(0);
  view.rerender(<SectionPicker rows={rows} selected={selected} onChange={onChange} />);
  expect(screen.getByRole('tree')).toBe(tree);
  expect(view.container.querySelector('.pk-brace')).toBe(brace);
  expect(brace.disabled).toBe(false);
  expect(items.every(item => item.getAttribute('aria-selected') === 'true')).toBe(true);
  fireEvent.click(items[0]);
  expect(changes).toHaveLength(1);
});
