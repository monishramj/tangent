import { expect, it, vi } from 'vitest';
import { isPhotoSource, transcribePhoto, TRANSCRIPTION_PROMPT } from './transcribe';
import { sectionsPassages } from '../home/api';

it('makes citeable IR paragraphs from a fake vision reader and preserves illegible text', async () => {
  const read = vi.fn().mockResolvedValue(JSON.stringify(['Mass = [illegible] g', '$x = 12.5$']));
  const ir = await transcribePhoto('/notes.JPG', read);
  expect(read).toHaveBeenCalledWith('/notes.JPG', TRANSCRIPTION_PROMPT);
  expect(TRANSCRIPTION_PROMPT).toContain('Never invent numbers');
  expect(sectionsPassages(ir, ['photo'])).toEqual([
    { id: 'photo-p1', markdown: 'Mass = [illegible] g', boxes: [], provenance: 'unverified-source' },
    { id: 'photo-p2', markdown: '$x = 12.5$', boxes: [], provenance: 'unverified-source' },
  ]);
  expect(ir.sections[0].markdown).toBe('Mass = [illegible] g\n\n$x = 12.5$');
});
it('accepts only the requested photo extensions', () => {
  for (const path of ['a.jpg', 'b.JPEG', 'c.png', 'd.HEIC', 'e.webp']) expect(isPhotoSource(path)).toBe(true);
  for (const path of ['x.svg', 'x.gif', 'x.png.exe', 'x.txt']) expect(isPhotoSource(path)).toBe(false);
});
it('rejects malformed or empty transcription before it can enter the cache', async () => {
  for (const raw of ['{}', '[]', '[1]', '[""]', 'not json']) {
    await expect(transcribePhoto('x.png', async () => raw)).rejects.toThrow();
  }
  const read = vi.fn();
  await expect(transcribePhoto('secret.txt', read)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it('reads a scanned PDF page by page into one anchored section per page, skipping blank pages', async () => {
  const { transcribePdf } = await import('./transcribe');
  const pages: Record<number, string> = { 1: '["Bayes: $P(A|B)$", "[illegible]"]', 2: '[]', 3: '```json\n["Prior times likelihood"]\n```' };
  const seen: number[] = [], progress = vi.fn();
  const ir = await transcribePdf('/notes.pdf', 3, progress, async (_path, page, prompt) => { expect(prompt).toBe(TRANSCRIPTION_PROMPT); seen.push(page); return pages[page]; });
  expect(seen).toEqual([1, 2, 3]);
  expect(ir.transcribed).toBe(true);
  expect(ir.sections.map(s => [s.id, s.title, s.anchors])).toEqual([['page-1', 'Page 1', [{ page: 1 }]], ['page-3', 'Page 3', [{ page: 3 }]]]);
  expect(ir.sections[0].markdown).toContain('[illegible]');
  expect(progress).toHaveBeenLastCalledWith(3, 3);
  await expect(transcribePdf('/big.pdf', 61, undefined, async () => '[]')).rejects.toThrow(/up to 60 pages/);
  await expect(transcribePdf('/blank.pdf', 1, undefined, async () => '[]')).rejects.toThrow(/No text found/);
});
