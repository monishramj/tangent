import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Home from './Home';
import { listSections, originalPdf, pdfPreview } from './api';
import { loadIr } from '../library';
import { memoryJsonStore, sourceFor } from '../storage/store';
import { fakeVideoStore, type VideoBundle } from '../storage/videos';

vi.mock('./api', async orig => ({ ...(await orig<typeof import('./api')>()), listSections: vi.fn(), pdfPreview: vi.fn(), originalPdf: vi.fn() }));
vi.mock('../library', () => ({ loadIr: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@/components/ShinyText', () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
const ir = { sections: [] };
const flat = [{ id: 's1', title: 'Heaps', level: 1, anchors: [{ page: 3 }, { page: 5 }] }, { id: 's2', title: 'Heapify', level: 2, anchors: [{ page: 4 }] }];
const video = { id: 'v1', title: 'Saved heaps', createdAt: 5, complete: false, source: { pdfPath: '/book.pdf', sectionId: 's1', sectionTitle: 'Heaps' }, scenes: [{ durationSec: 75 }] } as VideoBundle;
const provider = { complete: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(loadIr).mockResolvedValue(ir);
  vi.mocked(listSections).mockResolvedValue(flat);
  vi.mocked(pdfPreview).mockResolvedValue({ pages: 8, thumbnailUrl: 'data:image/png;base64,abc' });
  provider.complete.mockResolvedValue('{"s1":"Heaps", "s2":"Heapify"}');
});
afterEach(cleanup);
function setup(options: Partial<Parameters<typeof Home>[0]> = {}) {
  const store = memoryJsonStore(), onStart = vi.fn(), onOpenVideo = vi.fn();
  const result = render(<Home jsonStore={store} store={fakeVideoStore()} provider={provider} onStart={onStart} onOpenVideo={onOpenVideo} {...options} />);
  return { ...result, jsonStore: store, onStart, onOpenVideo };
}
async function upload(container: HTMLElement, path = '/book.pdf') {
  await waitFor(() => expect(screen.queryByText('Opening your library…')).toBeNull());
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [{ name: 'book.pdf', path }] } });
  await screen.findByText('Heaps');
  await waitFor(() => expect(screen.queryByText('Tidying section titles…')).toBeNull());
}
it('has folders, a dropzone, empty recents and no demo', async () => {
  setup();
  expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();
  expect(screen.getByTestId('dropzone')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /demo/i })).toBeNull();
  await screen.findByText('No recent videos yet.');
});
it('imports once into durable sources and displays sections without generating on click', async () => {
  const { container, jsonStore, onStart } = setup();
  await upload(container);
  expect(await screen.findByText('pp. 3-5')).toBeTruthy();
  fireEvent.click(screen.getByText('Heapify'));
  expect(onStart).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(vi.mocked(loadIr)).toHaveBeenCalledWith('/book.pdf', expect.any(Function), jsonStore);
  expect((jsonStore.data.get('library') as { sources: unknown[] }).sources).toHaveLength(1);
});
it('selection mode deduplicates selected descendants and passes detail through onStart', async () => {
  const { container, onStart, jsonStore } = setup();
  await upload(container);
  fireEvent.click(screen.getByRole('button', { name: 'Make a video' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Heapify' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Heaps' }));
  fireEvent.change(screen.getByLabelText('Detail level'), { target: { value: 'complete' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make video · 1 selected' }));
  expect(onStart).toHaveBeenCalledWith(['s1'], ir, { pdfPath: '/book.pdf', title: 'Heaps', detail: 'complete' });
  await waitFor(() => expect(jsonStore.data.get('video-detail')).toBe('complete'));
});
it('Select all and cancel clear selection without starting generation', async () => {
  const { container, onStart } = setup(); await upload(container);
  fireEvent.click(screen.getByRole('button', { name: 'Make a video' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
  expect(screen.getAllByRole('checkbox').every(c => (c as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getAllByRole('checkbox').some(c => (c as HTMLInputElement).checked)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(onStart).not.toHaveBeenCalled();
});
it('drag selects a contiguous range and pointerup ends it', async () => {
  const { container } = setup(); await upload(container);
  fireEvent.click(screen.getByRole('button', { name: 'Make a video' }));
  const rows = container.querySelectorAll('.tl-section-row');
  fireEvent.pointerDown(rows[0], { button: 0, buttons: 1 });
  fireEvent.pointerEnter(rows[1], { buttons: 1 });
  expect(screen.getAllByRole('checkbox').every(c => (c as HTMLInputElement).checked)).toBe(true);
  fireEvent.pointerUp(window); fireEvent.pointerEnter(rows[0], { buttons: 1 });
  expect(screen.getAllByRole('checkbox').every(c => (c as HTMLInputElement).checked)).toBe(true);
});
it('lists saved bundles only and opens the full saved bundle without generating', async () => {
  localStorage.setItem('tangent.recent', JSON.stringify([{ title: 'Ghost' }]));
  const { onOpenVideo, onStart } = setup({ store: fakeVideoStore([video]) });
  const list = await screen.findByRole('list', { name: 'Recent videos' });
  fireEvent.click(within(list).getByText('Saved heaps'));
  await waitFor(() => expect(onOpenVideo).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' })));
  expect(onStart).not.toHaveBeenCalled(); expect(screen.queryByText('Ghost')).toBeNull();
});
it('delete requires confirmation and removes the stored bundle', async () => {
  const store = fakeVideoStore([video]); setup({ store });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Saved heaps' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep' })); expect(store.bundles.size).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Saved heaps' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  await waitFor(() => expect(store.bundles.size).toBe(0));
});
it('creates, imports inside, renames and deletes a folder without deleting its PDF', async () => {
  const { container, jsonStore } = setup();
  await waitFor(() => expect(screen.queryByText('Opening your library…')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'CS 251' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  fireEvent.click(await screen.findByRole('button', { name: 'CS 251 folder' }));
  await screen.findByRole('heading', { name: /CS 251/ });
  await upload(container);
  const library = jsonStore.data.get('library') as { sources: { folderId: string }[]; folders: { id: string }[] };
  expect(library.sources[0].folderId).toBe(library.folders[0].id);
  fireEvent.click(screen.getByRole('button', { name: 'CS 251' }));
  await screen.findByRole('heading', { name: /CS 251/ });
  fireEvent.click(screen.getByText('Rename folder'));
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Algorithms' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await screen.findByRole('heading', { name: /Algorithms/ });
  fireEvent.click(screen.getByText('Delete folder', { selector: 'button' }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Delete folder' })).getByRole('button', { name: 'Delete folder' }));
  await screen.findByRole('heading', { name: 'Library' });
  expect((jsonStore.data.get('library') as { sources: unknown[] }).sources).toHaveLength(1);
});
it('falls back to parser titles after cleanup failure and offers retry', async () => {
  provider.complete.mockRejectedValueOnce(new Error('offline'));
  const { container } = setup(); await upload(container);
  expect(screen.getByText('Heaps')).toBeTruthy();
  provider.complete.mockResolvedValue('{"s1":"Clean heaps", "s2":"Clean heapify"}');
  fireEvent.click(screen.getByRole('button', { name: 'Retry section titles' }));
  expect(await screen.findByText('Clean heaps')).toBeTruthy();
});
it('rejects non PDFs, reports ingest errors and retries the source', async () => {
  const { container } = setup();
  await waitFor(() => expect(screen.queryByText('Opening your library…')).toBeNull());
  fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [{ name: 'a.txt' }] } });
  expect((await screen.findByRole('alert')).textContent).toContain("isn't a PDF");
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  vi.mocked(loadIr).mockRejectedValueOnce(new Error('missing file'));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [{ name: 'book.pdf', path: '/book.pdf' }] } });
  expect((await screen.findByRole('alert')).textContent).toContain('missing file');
  fireEvent.click(screen.getByRole('button', { name: 'Retry section titles' }));
  expect(await screen.findByText('Heaps')).toBeTruthy();
});
it('original PDF tab loads a local PDF blob on demand', async () => {
  const create = vi.fn().mockReturnValue('blob:pdf'), revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.mocked(originalPdf).mockResolvedValue(btoa('%PDF-1.7'));
  const { container, unmount } = setup(); await upload(container);
  expect(originalPdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Original PDF' }));
  await waitFor(() => expect(container.querySelector('iframe')?.src).toBe('blob:pdf'));
  unmount(); expect(revoke).toHaveBeenCalledWith('blob:pdf');
});
it('move-to-folder persists the chosen folder', async () => {
  const source = sourceFor('/book.pdf');
  const store = memoryJsonStore({ library: { folders: [{ id: 'f1', name: 'Course', emoji: '📚', openedAt: 1 }], sources: [source] } });
  setup({ jsonStore: store });
  const select = await screen.findByLabelText('Folder for book.pdf');
  fireEvent.change(select, { target: { value: 'f1' } });
  await waitFor(() => expect((store.data.get('library') as { sources: { folderId: string }[] }).sources[0].folderId).toBe('f1'));
});
it('does not overwrite durable sources when the library read fails', async () => {
  const store = memoryJsonStore();
  vi.spyOn(store, 'read').mockRejectedValue(new Error('unreadable store'));
  const write = vi.spyOn(store, 'write');
  setup({ jsonStore: store });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'New' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  await screen.findByText(/The library has not loaded/);
  expect(write).not.toHaveBeenCalled();
});

it("the settings panel saves a GIPHY key", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  render(<Home />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dlg = screen.getByRole("dialog", { name: "Settings" });
  expect(within(dlg).getByText(/reaction gifs · off/i)).toBeTruthy();
  fireEvent.change(within(dlg).getByLabelText("GIPHY API key"), { target: { value: " abc " } });
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Save" })); });
  expect(invoke).toHaveBeenCalledWith("set_secret", { name: "giphy", value: "abc" });
  expect(within(dlg).getByText(/reaction gifs · on/i)).toBeTruthy();
  expect(localStorage.getItem("tangent.giphy.set")).toBe("1");
  expect(invoke).not.toHaveBeenCalledWith("get_secret", expect.anything());
});

it("shows gif on/off from the local flag without reading the secret", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  localStorage.setItem("tangent.giphy.set", "1");
  render(<Home />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByText(/reaction gifs · on/i)).toBeTruthy();
  expect(invoke).not.toHaveBeenCalledWith("get_secret", expect.anything());
});

it('shows honest progress while ingest is pending', async () => {
  vi.mocked(loadIr).mockImplementation((_path, report) => { report?.({ fraction: .4, label: 'Reading 12 pages · ~8 s' }); return new Promise(() => {}); });
  const { container } = setup();
  await waitFor(() => expect(screen.queryByText('Opening your library…')).toBeNull());
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [{ name: 'book.pdf', path: '/book.pdf' }] } });
  expect((await screen.findByRole('status')).textContent).toContain('Reading 12 pages · ~8 s');
  expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(.4);
});

it('shows parser titles while tidying, retains partial success and retries only missing titles', async () => {
  let finish!: (value: string) => void;
  provider.complete.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const { container, jsonStore } = setup();
  await waitFor(() => expect(screen.queryByText('Opening your library…')).toBeNull());
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [{ name: 'book.pdf', path: '/book.pdf' }] } });
  expect(await screen.findByText('Tidying section titles…')).toBeTruthy();
  expect(screen.getByText('Heaps')).toBeTruthy();
  expect(screen.getByText('Heapify')).toBeTruthy();
  await act(async () => { finish('{"s1":"Binary heaps", "s2":null}'); });
  expect(await screen.findByText('Binary heaps')).toBeTruthy();
  expect(screen.getByText('Heapify')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry section titles' })).toBeTruthy();
  expect(jsonStore.data.has(`titles-${sourceFor('/book.pdf').id}`)).toBe(true);
  provider.complete.mockResolvedValue('{"s2":"Restoring heap order"}');
  fireEvent.click(screen.getByRole('button', { name: 'Retry section titles' }));
  expect(await screen.findByText('Restoring heap order')).toBeTruthy();
  expect(screen.getByText('Binary heaps')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry section titles' })).toBeNull();
});
