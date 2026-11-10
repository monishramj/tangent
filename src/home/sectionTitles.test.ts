import { expect, it, vi } from 'vitest';
import { sectionTitles } from './sectionTitles';
import { memoryJsonStore } from '../storage/store';
const sections = [{ id: 's1', title: 'garbled footer', level: 2, anchors: [{ page: 4 }] }];
const ir = { sections: [{ ...sections[0], children: [], markdown: 'A heap is a tree.' }] };
it('cleans and caches headings without changing ids, order, levels or boundaries', async () => {
  const provider = { complete: vi.fn().mockResolvedValue('["Binary heaps"]') }, store = memoryJsonStore();
  const cleaned = await sectionTitles('src1', sections, ir, store, provider);
  expect(cleaned).toEqual([{ ...sections[0], title: 'Binary heaps' }]);
  expect(sections[0].title).toBe('garbled footer');
  expect(await sectionTitles('src1', sections, ir, store, provider)).toEqual(cleaned);
  expect(provider.complete).toHaveBeenCalledTimes(1);
});
it('rejects malformed or missing titles, leaving the parser titles usable for retry', async () => {
  const store = memoryJsonStore(), provider = { complete: vi.fn().mockResolvedValue('[]') };
  await expect(sectionTitles('src1', sections, ir, store, provider)).rejects.toThrow();
  expect(store.data.size).toBe(0);
  provider.complete.mockResolvedValue('["Heaps"]');
  expect((await sectionTitles('src1', sections, ir, store, provider))[0].title).toBe('Heaps');
});
it('replaces an invalid cached response on retry', async () => {
  const store = memoryJsonStore({ 'titles-src1': { signature: JSON.stringify([['s1', 'garbled footer']]), titles: [] } });
  const provider = { complete: vi.fn().mockResolvedValue('["Heaps"]') };
  expect((await sectionTitles('src1', sections, ir, store, provider))[0].title).toBe('Heaps');
  expect(provider.complete).toHaveBeenCalledTimes(1);
});
