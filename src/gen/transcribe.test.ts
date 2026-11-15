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
