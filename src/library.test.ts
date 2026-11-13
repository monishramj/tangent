import { beforeEach, expect, it, vi } from 'vitest';
import { hasCachedIr, loadIr } from './library';
import { repairSections } from './home/api';
import { memoryJsonStore, sourceFor } from './storage/store';
vi.mock('./home/api', () => ({ repairSections: vi.fn() }));
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
