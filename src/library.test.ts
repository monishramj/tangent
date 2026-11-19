import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from 'vitest';
import { formulaBatches, hasCachedIr, loadIr, pendingIn, withFormulas } from './library';
import { enrichFormulas, repairSections, ingestPdf, figuresDir, pdfInfo, type IR } from './home/api';
import { memoryJsonStore, sourceFor } from './storage/store';
vi.mock('./home/api', () => ({ repairSections: vi.fn(), enrichFormulas: vi.fn(), ingestPdf: vi.fn(), figuresDir: vi.fn(), pdfInfo: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const events = vi.hoisted(() => ({ receive: undefined as undefined | ((event: { payload: unknown }) => void), stop: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name, receive) => { events.receive = receive; return events.stop; }) }));
beforeEach(() => vi.clearAllMocks());
it('upgrades a cached outline once, persists the same IR used for generation, and reuses it', async () => {
  const key = `ir-${sourceFor('/book.pdf').id}`, cached = { sections: [] }, repaired = { sections: [], outline_version: 1 };
  const store = memoryJsonStore({ [key]: cached });
  vi.mocked(repairSections).mockResolvedValue(repaired);
  expect(await loadIr('/book.pdf', undefined, store)).toEqual(repaired);
  expect(store.data.get(key)).toEqual(repaired);
  expect(await loadIr('/book.pdf', undefined, store)).toEqual(repaired);
  expect(repairSections).toHaveBeenCalledExactlyOnceWith(cached, '/book.pdf');
});
it('retains the original cached IR if the running sidecar cannot repair it', async () => {
  const key = `ir-${sourceFor('/book.pdf').id}`, cached = { sections: [] }, store = memoryJsonStore({ [key]: cached });
  vi.mocked(repairSections).mockRejectedValue(new Error('old sidecar'));
  expect(await loadIr('/book.pdf', undefined, store)).toEqual(cached);
  expect(store.data.get(key)).toEqual(cached);
});

it('checks the IR cache by source path and treats read errors as a cache miss', async () => {
  const store = memoryJsonStore({ [`ir-${sourceFor('/cached.pdf').id}`]: { sections: [] } });
  expect(await hasCachedIr('/cached.pdf', store)).toBe(true);
  expect(await hasCachedIr('/missing.pdf', store)).toBe(false);
  vi.spyOn(store, 'read').mockRejectedValue(new Error('unreadable cache'));
  expect(await hasCachedIr('/cached.pdf', store)).toBe(false);
});

it('decodes formulas from the cached IR, saves the result, and falls back to the text layer', async () => {
  const key = `ir-${sourceFor('/m.pdf').id}`;
  const sec = (md: string) => ({ id: 's1', title: 'S', level: 1, anchors: [], children: [], markdown: md });
  const pending = { sections: [sec('a ⟨formula 1⟩ b')], formulas: { 1: { page: 1, bbox: [0, 0, 1, 1], orig: 'x "2"' } } };
  const decoded = { sections: [sec('a $$x^2$$ b')] };
  const store = memoryJsonStore({ [key]: pending });
  vi.mocked(enrichFormulas).mockResolvedValue(decoded);
  expect(await withFormulas('/m.pdf', { sections: [] }, ['s1'], store)).toEqual(decoded);
  expect(enrichFormulas).toHaveBeenCalledWith(pending, '/m.pdf', ['s1'], [1, 1], expect.any(AbortSignal));
  expect(store.data.get(key)).toEqual(decoded);
  expect(await withFormulas('/m.pdf', { sections: [] }, ['s1'], store)).toEqual(decoded); // nothing pending: no call
  expect(enrichFormulas).toHaveBeenCalledTimes(1);

  store.data.set(key, pending);
  vi.mocked(enrichFormulas).mockRejectedValue(new Error('sidecar down'));
  expect((await withFormulas('/m.pdf', { sections: [] }, ['s1'], store)).sections[0].markdown).toBe('a $$x "2"$$ b');
});

it('counts undecoded formulas in the chosen sections and their subsections only', () => {
  const node = (id: string, markdown: string, children: unknown[] = []) => ({ id, title: id, level: 1, anchors: [], children, markdown });
  const ir = { sections: [node('a', '⟨formula 1⟩ ⟨formula 1⟩', [node('a1', '⟨formula 2⟩ ⟨formula 9⟩')]), node('b', '⟨formula 3⟩')],
    formulas: { 1: { page: 1, bbox: [], orig: '' }, 2: { page: 1, bbox: [], orig: '' }, 3: { page: 2, bbox: [], orig: '' } } };
  expect(pendingIn(ir as never, ['a'])).toBe(2); // 9 is already decoded, 1 counted once
  expect(pendingIn(ir as never, ['b', 'a1'])).toBe(2);
});


it('reports actual page completion and thermal pauses, ignores other sources and removes the listener', async () => {
  const report = vi.fn(), ir = { sections: [] }, store = memoryJsonStore();
  vi.mocked(figuresDir).mockResolvedValue('/figures');
  vi.mocked(ingestPdf).mockImplementation(async () => {
    events.receive?.({ payload: { path: '/other.pdf', progress: { completed: 1, total: 1, paused: false } } });
    events.receive?.({ payload: { path: '/new.pdf', progress: { completed: 20, total: 41, paused: false } } });
    events.receive?.({ payload: { path: '/new.pdf', progress: { completed: 20, total: 41, paused: true } } });
    return ir;
  });
  expect(await loadIr('/new.pdf', report, store)).toEqual(ir);
  expect(report.mock.calls.map(([value]) => value)).toEqual([
    { label: 'Reading PDF' },
    { fraction: 20 / 41, label: 'Read 20 of 41 pages' },
    { fraction: 20 / 41, label: 'Paused to cool down · 20 of 41 pages' },
    { fraction: 1, label: 'Done' },
  ]);
  expect(events.stop).toHaveBeenCalledOnce();
  expect(ingestPdf).toHaveBeenCalledWith('/new.pdf', '/figures');
});

it('removes the progress listener on ingest failure without caching a partial IR', async () => {
  const store = memoryJsonStore();
  vi.mocked(ingestPdf).mockRejectedValue(new Error('conversion failed'));
  await expect(loadIr('/failed.pdf', undefined, store)).rejects.toThrow('conversion failed');
  expect(events.stop).toHaveBeenCalledOnce();
  expect(store.data.size).toBe(0);
});

it('transcribes a photo once through Claude and caches faithful unverified passages', async () => {
  vi.mocked(invoke).mockResolvedValue('["Value: [illegible]", "$x = 12.5$"]');
  const store = memoryJsonStore(), report = vi.fn();
  const ir = await loadIr('/notes.jpg', report, store);
  expect(invoke).toHaveBeenCalledWith('llm_complete', expect.objectContaining({ provider: 'claude', photoPath: '/notes.jpg' }));
  expect(ir.sections[0].provenance).toBe('unverified-source');
  expect(ir.sections[0].markdown).toContain('[illegible]');
  expect(await loadIr('/notes.jpg', report, store)).toEqual(ir);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(ingestPdf).not.toHaveBeenCalled();
});

it('decodes a big selection in page batches, saving after each, and keeps finished batches if a later one fails', async () => {
  const key = `ir-${sourceFor('/m.pdf').id}`;
  const f = (page: number) => ({ page, bbox: [0, 0, 1, 1], orig: `o${page}` });
  const ir = { sections: [{ id: 's1', title: 'S', level: 1, anchors: [], children: [], markdown: '⟨formula 1⟩ ⟨formula 2⟩ ⟨formula 3⟩' }],
    formulas: { 1: f(1), 2: f(20), 3: f(90) } };
  expect(formulaBatches(ir, ['1', '2', '3'])).toEqual([[1, 20], [90, 90]]);
  const store = memoryJsonStore({ [key]: ir });
  const first = { ...ir, sections: [{ ...ir.sections[0], markdown: 'A B ⟨formula 3⟩' }], formulas: { 3: f(90) } };
  vi.mocked(enrichFormulas).mockReset().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('timed out'));
  const out = await withFormulas('/m.pdf', { sections: [] }, ['s1'], store);
  expect(vi.mocked(enrichFormulas).mock.calls.map(c => c[3])).toEqual([[1, 20], [90, 90]]);
  expect(store.data.get(key)).toEqual(first);
  expect(out.sections[0].markdown).toBe('A B $$o90$$');
});

it('a whole-book selection skips the formula model and starts with the text layer', async () => {
  const key = `ir-${sourceFor('/m.pdf').id}`;
  const f = (page: number) => ({ page, bbox: [0, 0, 1, 1], orig: `o${page}` });
  const formulas = Object.fromEntries([1, 40, 80, 120].map((p, i) => [String(i + 1), f(p)]));
  const ir = { sections: [{ id: 's1', title: 'S', level: 1, anchors: [], children: [], markdown: '⟨formula 1⟩ ⟨formula 4⟩' + ' ⟨formula 2⟩ ⟨formula 3⟩' }], formulas };
  vi.mocked(enrichFormulas).mockReset();
  const out = await withFormulas('/m.pdf', { sections: [] }, ['s1'], memoryJsonStore({ [key]: ir }));
  expect(enrichFormulas).not.toHaveBeenCalled();
  expect(out.sections[0].markdown).toBe('$$o1$$ $$o120$$ $$o40$$ $$o80$$');
});

const formula = (page: number) => ({ page, bbox: [], orig: "fallback" });
const section = (id: string, markdown: string) => ({ id, markdown, title: id, level: 1, anchors: [], children: [] });

it('shares one formula decode and keeps it running for the remaining caller', async () => {
  const ir = { sections: [section("a", "⟨formula 1⟩")], formulas: { 1: formula(1) } };
  const decoded = { sections: [section("a", "decoded")] };
  const store = memoryJsonStore();
  const abort = new AbortController();
  let finish!: (ir: IR) => void;
  vi.mocked(enrichFormulas).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const leaving = withFormulas("/m.pdf", ir, ["a"], store, undefined, abort.signal);
  const staying = withFormulas("/m.pdf", ir, ["a"], store);
  expect(withFormulas("/m.pdf", ir, ["a"], store)).toBe(staying);
  await vi.waitFor(() => expect(enrichFormulas).toHaveBeenCalledTimes(1));
  const rejected = expect(leaving).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  await rejected;
  expect(vi.mocked(enrichFormulas).mock.calls[0][4]?.aborted).toBe(false);
  finish(decoded);
  await expect(staying).resolves.toEqual(decoded);
  expect(store.data.get(`ir-${sourceFor("/m.pdf").id}`)).toEqual(decoded);
});

it('serializes different section selections against the same cached IR', async () => {
  const ir = { sections: [section("a", "⟨formula 1⟩"), section("b", "⟨formula 2⟩")], formulas: { 1: formula(1), 2: formula(2) } };
  const first = { sections: [section("a", "first"), ir.sections[1]], formulas: { 2: formula(2) } };
  const both = { sections: [first.sections[0], section("b", "second")] };
  const store = memoryJsonStore();
  vi.mocked(enrichFormulas).mockResolvedValueOnce(first).mockResolvedValueOnce(both);
  await Promise.all([withFormulas("/m.pdf", ir, ["a"], store), withFormulas("/m.pdf", ir, ["b"], store)]);
  expect(vi.mocked(enrichFormulas).mock.calls[1][0]).toEqual(first);
  expect(store.data.get(`ir-${sourceFor("/m.pdf").id}`)).toEqual(both);
});

it('keeps a running formula batch on abort and skips the remaining batch', async () => {
  const ir = { sections: [section("a", "⟨formula 1⟩ ⟨formula 2⟩")], formulas: { 1: formula(1), 2: formula(40) } };
  const first = { sections: [section("a", "first ⟨formula 2⟩")], formulas: { 2: formula(40) } };
  const store = memoryJsonStore();
  const abort = new AbortController();
  let finish!: (ir: IR) => void;
  vi.mocked(enrichFormulas).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = withFormulas("/m.pdf", ir, ["a"], store, undefined, abort.signal);
  await vi.waitFor(() => expect(enrichFormulas).toHaveBeenCalledTimes(1));
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  await rejected;
  expect(vi.mocked(enrichFormulas).mock.calls[0][4]?.aborted).toBe(true);
  finish(first);
  // Wait behind the abandoned batch using a selection with no formulas.
  await withFormulas("/m.pdf", ir, [], store);
  expect(store.data.get(`ir-${sourceFor("/m.pdf").id}`)).toEqual(first);
  expect(enrichFormulas).toHaveBeenCalledTimes(1);
});

it('after "Read with Claude", a scanned PDF is transcribed page by page instead of re-running Docling', async () => {
  const { chooseTranscription } = await import('./library');
  const store = memoryJsonStore({ [`ir-${sourceFor('/scan.pdf').id}`]: { sections: [], outline_version: 1 } });
  await chooseTranscription('/scan.pdf', store);
  expect(store.data.has(`ir-${sourceFor('/scan.pdf').id}`)).toBe(false);
  vi.mocked(pdfInfo).mockResolvedValue({ pages: 2 });
  vi.mocked(invoke).mockReset().mockResolvedValue('["Handwritten line"]');
  const ir = await loadIr('/scan.pdf', undefined, store);
  expect(ingestPdf).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith('llm_complete', expect.objectContaining({ photoPath: '/scan.pdf', pdfPage: 2 }));
  expect(ir.transcribed && ir.sections.map(s => s.title)).toEqual(['Page 1', 'Page 2']);
});
