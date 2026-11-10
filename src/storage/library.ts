import { newId, sourceFor, type JsonStore, type Source } from './store';
import type { VideoBundle } from './videos';

export type LibrarySource = Source & { folderId?: string | null; thumbnailUrl?: string; pageCount?: number };
export type LibraryFolder = { id: string; name: string; emoji: string; openedAt: number };
export type Library = { folders: LibraryFolder[]; sources: LibrarySource[] };
export const emptyLibrary = (): Library => ({ folders: [], sources: [] });
export const readLibrary = async (store: JsonStore): Promise<Library> => (await store.read<Library>('library')) ?? emptyLibrary();
export const saveLibrary = (store: JsonStore, library: Library) => store.write('library', library);
export function addFolder(library: Library, name: string, emoji = '📚'): Library {
  if (!name.trim()) throw new Error('Give the folder a name.');
  return { ...library, folders: [...library.folders, { id: newId('f'), name: name.trim(), emoji, openedAt: Date.now() }] };
}
export function deleteFolder(library: Library, id: string): Library {
  return { folders: library.folders.filter(f => f.id !== id), sources: library.sources.map(s => s.folderId === id ? { ...s, folderId: null } : s) };
}
export function moveSource(library: Library, id: string, folderId: string | null): Library {
  if (folderId && !library.folders.some(f => f.id === folderId)) throw new Error('Folder no longer exists.');
  return { ...library, sources: library.sources.map(s => s.id === id ? { ...s, folderId } : s) };
}
export function addSource(library: Library, path: string, folderId?: string | null): Library {
  const source = sourceFor(path), existing = library.sources.find(s => s.id === source.id);
  if (existing) return folderId === undefined ? library : moveSource(library, source.id, folderId);
  if (folderId && !library.folders.some(f => f.id === folderId)) throw new Error('Folder no longer exists.');
  return { ...library, sources: [...library.sources, { ...source, folderId }] };
}
/** Only the bundle store can supply playable recents; a started generation is never a video. */
export const recentVideos = (videos: VideoBundle[], paths?: Set<string>) => videos.filter(v => v.scenes.length && (!paths || paths.has(v.source.pdfPath))).sort((a, b) => b.createdAt - a.createdAt);
