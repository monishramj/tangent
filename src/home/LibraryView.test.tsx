import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LibraryView, { type LibraryViewProps } from './LibraryView';

vi.mock('@/components/Folder', () => ({ default: ({ label, onOpenChange }: { label: string; onOpenChange: (open: boolean) => void }) => <button onClick={() => onOpenChange(true)}>{label} folder</button> }));
vi.mock('@/components/SpotlightCard', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const folder = { id: 'cs', name: 'CS 251', sourceCount: 3 };
const props = (): LibraryViewProps => ({
  folders: [folder], sources: [0, 1, 2].map(i => ({ id: `${i}`, name: `Chapter ${i}`, pdfPath: `/${i}.pdf` })), videos: [],
  onBack: vi.fn(), onOpenFolder: vi.fn(), onOpenSource: vi.fn(), onOpenVideo: vi.fn(), onChoosePdf: vi.fn(), onDropFiles: vi.fn(),
  onCreateFolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMoveSource: vi.fn(),
});
function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
  vi.useFakeTimers();
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('opens after the shelf entrance and cancels pending navigation when unmounted', () => {
  motion(false);
  const p = props();
  const view = render(<LibraryView {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'CS 251 folder' }));
  expect(view.container.querySelector('.tl-opening')).toBeTruthy();
  act(() => vi.advanceTimersByTime(319));
  expect(p.onOpenFolder).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(p.onOpenFolder).toHaveBeenCalledWith('cs');
  fireEvent.click(screen.getByRole('button', { name: 'CS 251 folder' }));
  view.unmount();
  act(() => vi.runAllTimers());
  expect(p.onOpenFolder).toHaveBeenCalledOnce();
});
it('staggers folder rows and finishes reverse motion before navigating back', () => {
  motion(false);
  const p = props();
  const view = render(<LibraryView {...p} folder={folder} />);
  const rows = view.container.querySelectorAll<HTMLElement>('.tl-files>li');
  expect(Array.from(rows, row => row.style.getPropertyValue('--row-delay'))).toEqual(['0ms', '60ms', '120ms']);
  expect(Array.from(rows, row => row.style.getPropertyValue('--close-delay'))).toEqual(['120ms', '60ms', '0ms']);
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  expect(view.container.querySelector('.tl-closing')?.hasAttribute('inert')).toBe(true);
  act(() => vi.advanceTimersByTime(299));
  expect(p.onBack).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(p.onBack).toHaveBeenCalledOnce();
});
it('skips the closing delay for reduced motion', () => {
  motion(true);
  const p = props();
  render(<LibraryView {...p} folder={folder} />);
  fireEvent.click(screen.getByRole('button', { name: 'Home' }));
  expect(p.onBack).toHaveBeenCalledOnce();
});
