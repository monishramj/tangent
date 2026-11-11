import { expect, it } from 'vitest';
import { addFolder, addSource, deleteFolder, emptyLibrary, moveSource, readLibrary, recentVideos, saveLibrary } from './library';
import { memoryJsonStore, sourceFor } from './store';
import type { VideoBundle } from './videos';

it('persists folders, stable sources and moves; deleting a folder keeps sources', async () => {
  const store = memoryJsonStore();
  let library = addFolder(emptyLibrary(), ' CS 251 ', '🌳');
  const id = library.folders[0].id;
  library = addSource(library, '/book.pdf', id);
  library = addSource(library, '/book.pdf');
  expect(library.sources).toHaveLength(1);
  expect(library.sources[0].folderId).toBe(id);
  library = moveSource(library, sourceFor('/book.pdf').id, null);
  expect(library.sources[0].folderId).toBeNull();
  library = moveSource(library, library.sources[0].id, id);
  await saveLibrary(store, deleteFolder(library, id));
  expect(await readLibrary(store)).toEqual({ folders: [], sources: [{ ...sourceFor('/book.pdf'), folderId: null }] });
  expect(() => moveSource(library, library.sources[0].id, 'missing')).toThrow();
  expect(() => addFolder(library, ' ')).toThrow();
});
it('recents contain saved scenes only, newest first, scoped to source paths', () => {
  const video = (id: string, time: number, path: string, scenes: unknown[] = [{}]) => ({ id, createdAt: time, source: { pdfPath: path }, scenes }) as VideoBundle;
  const videos = [video('old', 1, '/a.pdf'), video('new', 3, '/b.pdf'), video('empty', 4, '/a.pdf', [])];
  expect(recentVideos(videos).map(v => v.id)).toEqual(['new', 'old']);
  expect(recentVideos(videos, new Set(['/a.pdf'])).map(v => v.id)).toEqual(['old']);
});
