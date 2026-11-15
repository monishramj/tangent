import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from 'vitest';
import { hasCachedIr, loadIr, pendingIn, withFormulas } from './library';
import { enrichFormulas, repairSections, ingestPdf, figuresDir } from './home/api';
import { memoryJsonStore, sourceFor } from './storage/store';
vi.mock('./home/api', () => ({ repairSections: vi.fn(), enrichFormulas: vi.fn(), ingestPdf: vi.fn(), figuresDir: vi.fn() }));
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
  expect(enrichFormulas).toHaveBeenCalledWith(pending, '/m.pdf', ['s1']);
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
