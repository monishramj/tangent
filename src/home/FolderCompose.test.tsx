import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
afterEach(cleanup);
import FolderCompose from './FolderCompose';

const heaps = [{ id: 'h1', title: 'Heaps', level: 1, anchors: [{ page: 2 }] }];
const week = [{ id: 'w1', title: 'Lecture', level: 1, anchors: [] }, { id: 'w2', title: 'Lab', level: 1, anchors: [] }];

it('picks sections across collapsed PDFs and sends them in folder order', () => {
  const onGenerate = vi.fn();
  render(<FolderCompose sources={[{ id: 'book', name: 'Book.pdf', sections: heaps }, { id: 'week', name: 'Week.pptx', sections: week }, { id: 'big', name: 'Big.pdf', status: 'Reading' }]}
    detail="standard" onDetailChange={() => {}} sectionMarkdown={() => ''} onGenerate={onGenerate} onCancel={() => {}} />);
  expect(screen.queryByRole('tree')).toBeNull(); // collapsed: a huge outline never floods the page
  expect((screen.getByRole('button', { name: /Big\.pdf/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Week\.pptx/ }));
  fireEvent.click(screen.getByRole('treeitem', { name: /Lab/ }));
  fireEvent.click(screen.getByRole('button', { name: /Book\.pdf/ }));
  fireEvent.click(screen.getByRole('treeitem', { name: /Heaps/ }));
  expect(screen.getByText('2 sections from 2 PDFs')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Make video · 2 selected/ }));
  expect(onGenerate).toHaveBeenCalledWith([{ sourceId: 'book', sectionIds: ['h1'] }, { sourceId: 'week', sectionIds: ['w2'] }], 'standard');
});

it('opens the only ready PDF right away', () => {
  render(<FolderCompose sources={[{ id: 'book', name: 'Book.pdf', sections: heaps }]} detail="standard" onDetailChange={() => {}} sectionMarkdown={() => ''} onGenerate={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('tree', { name: 'Book.pdf' })).toBeTruthy();
});
