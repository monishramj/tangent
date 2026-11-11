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
  expect(renderPage).toHaveBeenCalledExactlyOnceWith('/book.pdf', 1, expect.any(Number));
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
