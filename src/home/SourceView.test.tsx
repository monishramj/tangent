import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RenderPage } from '@/follow/types';
import SourceView, { type SourceViewProps } from './SourceView';
import { pdfInfo } from './api';

vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()), pdfInfo: vi.fn() }));
const renderPage = vi.fn<RenderPage>(async (_path, page) => ({ url: `asset://localhost/${page}.png`, width: 600, height: 800 }));
const observed = new Map<Element, IntersectionObserverCallback>();
let resize: () => void;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); observed.clear();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(node: Element) { observed.set(node, this.callback); }
    disconnect() {}
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(props: Partial<SourceViewProps> = {}) {
  return render(<SourceView source={{ id: 'book', name: 'Book.pdf', pdfPath: '/book.pdf', pageCount: 3 }} sections={[]} videos={[]}
    onBack={() => {}} onOpenVideo={() => {}} onGenerate={() => {}} renderPage={renderPage} {...props} />);
}
const openPdf = () => fireEvent.click(screen.getByRole('tab', { name: 'Original PDF' }));

it('creates every page slot and renders only the first until another page approaches the viewport', async () => {
  const { container } = setup();
  expect(renderPage).not.toHaveBeenCalled();
  openPdf();
  await screen.findByAltText('Page 1');
  expect(container.querySelectorAll('[data-page]')).toHaveLength(3);
  expect(renderPage).toHaveBeenCalledExactlyOnceWith('/book.pdf', 1, expect.any(Number), expect.any(AbortSignal));
  expect(pdfInfo).not.toHaveBeenCalled();
  const second = container.querySelector('[data-page="2"]')!;
  act(() => observed.get(second)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  await screen.findByAltText('Page 2');
  expect(renderPage).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll('[data-testid="passage-highlight"]')).toHaveLength(0);
});

it('defaults to dark pages, toggles the scroller class, and remembers original colors on remount', async () => {
  const view = setup(); openPdf();
  const scroller = screen.getByLabelText('Original PDF pages');
  const toggle = screen.getByRole('button', { name: 'Dark pages' });
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(scroller.classList.contains('tl-pdf-dark')).toBe(true);
  fireEvent.click(toggle);
  expect(scroller.classList.contains('tl-pdf-dark')).toBe(false);
  expect(screen.getByRole('button', { name: 'Dark pages' }).getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem('tangent.pdfDark')).toBe('false');
  view.unmount();
  setup(); openPdf();
  expect(screen.getByLabelText('Original PDF pages').classList.contains('tl-pdf-dark')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Dark pages' }));
  expect(localStorage.getItem('tangent.pdfDark')).toBe('true');
  await screen.findByAltText('Page 1');
});

it('loads an unknown count on demand and retries the existing unavailable state after failure', async () => {
  vi.mocked(pdfInfo).mockRejectedValueOnce(new Error('moved')).mockResolvedValueOnce({ pages: 2 });
  const { container } = setup({ source: { id: 'book', name: 'Book.pdf', pdfPath: '/book.pdf' } });
  expect(pdfInfo).not.toHaveBeenCalled();
  openPdf();
  expect(await screen.findByText('PDF preview unavailable')).toBeTruthy();
  expect(pdfInfo).toHaveBeenCalledWith('/book.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByAltText('Page 1');
  expect(container.querySelectorAll('[data-page]')).toHaveLength(2);
  expect(pdfInfo).toHaveBeenCalledTimes(2);
});

it('sizes pages immediately from the scroller, caps width, and settles only sharper renders', async () => {
  vi.useFakeTimers();
  setup(); openPdf();
  await act(async () => {});
  const scroller = screen.getByLabelText('Original PDF pages');
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 1200 });
  act(() => resize());
  expect(scroller.style.getPropertyValue('--page-w')).toBe('900px');
  expect(renderPage).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(250); });
  expect(renderPage).toHaveBeenCalledTimes(2);
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 500 });
  act(() => resize());
  expect(scroller.style.getPropertyValue('--page-w')).toBe('476px');
  await act(async () => { vi.advanceTimersByTime(250); });
  expect(renderPage).toHaveBeenCalledTimes(2);
});

it('shows about-minutes for every detail level and updates them as sections are picked', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  const sections = [
    { id: 'a', title: 'Alpha', level: 1, anchors: [{ page: 1 }] },
    { id: 'b', title: 'Beta', level: 1, anchors: [{ page: 2 }] },
  ];
  const text: Record<string, string> = { a: words(3000), b: words(3000) };
  setup({ sections, seedSelection: ['a'], sectionMarkdown: id => text[id] ?? '' });
  expect((screen.getByRole('radio', { name: /Standard/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole('radio', { name: 'Overview, about 1 min' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Standard, about 3 min' })).toBeTruthy();
  fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ }));
  expect(screen.getByRole('radio', { name: 'Overview, about 3 min' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Standard, about 6 min' })).toBeTruthy();
  expect(screen.getByText(/Sections and detail set the length/)).toBeTruthy();
});

it('shows the source text for a Word doc instead of PDF pages', () => {
  setup({ source: { id: 'notes', name: 'notes.docx', pdfPath: '/notes.docx' },
    passages: [{ id: 'p1', markdown: 'A heap is a tree.', boxes: [] }] });
  expect(screen.queryByRole('tab', { name: 'Original PDF' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
  expect(screen.getByLabelText('Source text').textContent).toContain('A heap is a tree.');
  expect(renderPage).not.toHaveBeenCalled();
  expect(pdfInfo).not.toHaveBeenCalled();
});

it('adds sections from a second source and names the source on each pick', () => {
  const onGenerate = vi.fn();
  const sections = [{ id: 's1', title: 'Heaps', level: 1, anchors: [{ page: 2 }] }];
  const slides = [{ id: 's2', title: 'Lecture', level: 1, anchors: [] }];
  setup({ sections, onGenerate, otherSources: [{ id: 'slides', name: 'Week.pptx', sections: slides }] });
  expect(screen.queryByRole('button', { name: 'Add another source' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Make a video' }));
  fireEvent.click(screen.getByRole('treeitem', { name: /Heaps/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add another source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Week.pptx' }));
  fireEvent.click(screen.getByRole('treeitem', { name: /Lecture/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add sections' }));
  const picked = screen.getByRole('list', { name: 'Selected sections' });
  expect(picked.textContent).toContain('Book.pdf');
  expect(picked.textContent).toContain('Heaps');
  expect(picked.textContent).toContain('Week.pptx');
  expect(picked.textContent).toContain('Lecture');
  fireEvent.click(screen.getByRole('button', { name: /Make video/ }));
  expect(onGenerate).toHaveBeenCalledWith(['s1'], 'standard', [{ sourceId: 'slides', sectionIds: ['s2'] }]);
});

it('labels the photo source and its text panel as transcription', () => {
  setup({ source: { id: 'photo', name: 'notes.jpg', pdfPath: '/notes.jpg' },
    passages: [{ id: 'photo-p1', markdown: 'Value: [illegible]', boxes: [] }] });
  expect(screen.getByText('transcribed, check against your notes')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
  expect(screen.getAllByText('transcribed, check against your notes')).toHaveLength(2);
  expect(screen.getByLabelText('Source text').textContent).toContain('[illegible]');
  expect(pdfInfo).not.toHaveBeenCalled();
});

it('keeps the same brace hierarchy when switching from browsing to selection and back', async () => {
  const onGenerate = vi.fn();
  const { container } = setup({ onGenerate, sections: [
    { id: 'root', title: 'Foundations', level: 1, anchors: [{ page: 1 }, { page: 3 }] },
    { id: 'child', title: 'Arrays', level: 2, anchors: [{ page: 2 }] },
  ] });
  const tree = screen.getByRole('tree', { name: 'Sections' });
  const brace = container.querySelector('.pk-brace');
  fireEvent.click(screen.getByText('Arrays'));
  expect(onGenerate).not.toHaveBeenCalled();
  expect(screen.getAllByRole('treeitem').every(row => !row.hasAttribute('aria-selected'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Make a video' }));
  expect(screen.getByRole('tree')).toBe(tree);
  expect(container.querySelector('.pk-brace')).toBe(brace);
  fireEvent.click(brace!);
  fireEvent.click(screen.getByRole('button', { name: 'Make video · 1 selected' }));
  expect(onGenerate).toHaveBeenCalledWith(['root'], 'standard');
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('tree')).toBe(tree);
  expect(screen.getAllByRole('treeitem').every(row => !row.hasAttribute('aria-selected'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Make a video' }));
  expect(screen.getAllByRole('treeitem').every(row => row.getAttribute('aria-selected') === 'false')).toBe(true);
});
