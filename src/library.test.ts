import { beforeEach, expect, it, vi } from 'vitest';
import { hasCachedIr, loadIr, withFormulas } from './library';
import { enrichFormulas, repairSections } from './home/api';
import { memoryJsonStore, sourceFor } from './storage/store';
vi.mock('./home/api', () => ({ repairSections: vi.fn(), enrichFormulas: vi.fn() }));
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
