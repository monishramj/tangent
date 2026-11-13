import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import useKeybinds from '@/hooks/useKeybinds';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import LibraryView from './LibraryView';
import Settings from './Settings';
import SourceView from './SourceView';
import { multiTitle, type IR } from './api';
import { tauriJsonStore, type JsonStore } from '../storage/store';
import { addFolder, addSource, deleteFolder, emptyLibrary, moveSource, readLibrary, recentVideos, saveLibrary, type Library } from '../storage/library';
import { tauriVideoStore, type VideoBundle, type VideoStore } from '../storage/videos';
import { providers } from '../llm/registry';
import type { LLMProvider } from '../llm/provider';
import { sourceQueue, preparationLabel, isPreparing } from './ingestQueue';
import { isDetailLevel, type DetailLevel } from '../gen/script';

export type StartMeta = { pdfPath: string; title: string; detail: DetailLevel };
export type LibraryRoute = { s: 'settings' } | { s: 'home' } | { s: 'folder'; folderId: string } | { s: 'source'; sourceId: string; folderId?: string };
const isTauri = () => '__TAURI_INTERNALS__' in window;

export default function Home({ onStart = () => {}, onOpenVideo = () => {}, store = tauriVideoStore, jsonStore = tauriJsonStore, provider = providers.claude, route: controlledRoute, onNavigate, active = true }: {
  onStart?: (ids: string[], ir: IR, meta: StartMeta) => void; onOpenVideo?: (video: VideoBundle) => void;
  store?: VideoStore; jsonStore?: JsonStore; provider?: LLMProvider; route?: LibraryRoute; onNavigate?: (route: LibraryRoute) => void; active?: boolean;
}) {
  const [localRoute, setLocalRoute] = useState<LibraryRoute>({ s: 'home' });
  const route = controlledRoute ?? localRoute;
  const navigate = onNavigate ?? setLocalRoute;
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [detail, setDetail] = useState<DetailLevel>('standard');
  const [videos, setVideos] = useState<VideoBundle[]>([]);
  const [error, setError] = useState('');
  const savePreview = useRef<(path: string, preview: { pages: number; thumbnailUrl?: string }) => Promise<void>>(async () => {});
  const [queue] = useState(() => sourceQueue(jsonStore, provider, (path, preview) => savePreview.current(path, preview)));
  const uploads = useSyncExternalStore(queue.subscribe, queue.snapshot);
  const reserved = useRef(new Set<string>());
  const [over, setOver] = useState(false);
  const sourceId = route.s === 'source' ? route.sourceId : undefined;
  const source = library.sources.find(s => s.id === sourceId);
  const job = uploads.find(item => item.path === source?.pdfPath);
  const content = job?.value;
  const loading = !content && source && isPreparing(job) ? preparationLabel(job!) : '';
  const progress = job?.status === 'reading' ? job.progress : undefined;
  const folderId = route.s === 'folder' || route.s === 'source' ? route.folderId : undefined;
  const folder = library.folders.find(f => f.id === folderId);
  // Serialize read/modify/write operations, including background thumbnail updates.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const update = (change: (current: Library) => Library) => {
    if (!ready) return Promise.reject(new Error("The library has not loaded. Try opening it again first."));
    const write = writes.current.catch(() => {}).then(async () => {
      const next = change(libraryRef.current);
      await saveLibrary(jsonStore, next);
      libraryRef.current = next; setLibrary(next);
    });
    writes.current = write;
    return write;
  };
  savePreview.current = (path, preview) => update(current => ({ ...current, sources: current.sources.map(s => s.pdfPath === path ? { ...s, pageCount: preview.pages, thumbnailUrl: preview.thumbnailUrl } : s) }));
  useEffect(() => {
    let live = true;
    void Promise.all([readLibrary(jsonStore), store.list(), jsonStore.read<string>('video-detail')]).then(async ([saved, bundles, preference]) => {
      // Recover PDFs referenced by existing saved videos without relying on old localStorage recents.
      const next = bundles.reduce((all, video) => addSource(all, video.source.pdfPath), saved);
      if (next !== saved) await saveLibrary(jsonStore, next);
      for (const source of next.sources) await queue.restore(source).catch(() => {});
      if (live) { libraryRef.current = next; setLibrary(next); setVideos(recentVideos(bundles)); if (isDetailLevel(preference)) setDetail(preference); setReady(true); }
    }).catch(e => { if (live) setError(`Couldn't open the library: ${String(e)}`); });
    return () => { live = false; };
  }, [jsonStore, store, loadAttempt]);
  useEffect(() => {
    if (ready) library.sources.forEach(source => queue.enqueue(source.pdfPath));
  }, [ready, library.sources, queue]);
  const importPaths = async (paths: string[]) => {
    if (!ready) return;
    const accepted: string[] = [];
    const invalid = paths.some(path => !/\.pdf$/i.test(path));
    for (const path of paths) {
      if (!/\.pdf$/i.test(path) || reserved.current.has(path) || libraryRef.current.sources.some(s => s.pdfPath === path)) continue;
      reserved.current.add(path); accepted.push(path);
    }
    setError(invalid ? "That isn't a PDF. Choose .pdf files." : '');
    if (!accepted.length) return;
    const target = folderId ?? null;
    try {
      await update(current => accepted.reduce((all, path) => addSource(all, path, target && current.folders.some(f => f.id === target) ? target : null), current));
    } catch (e) { setError(`Couldn't add the PDFs: ${String(e)}`); }
    finally { accepted.forEach(path => reserved.current.delete(path)); }
  };
  const dropped = useRef(importPaths); dropped.current = active ? importPaths : async () => {};
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWebview().onDragDropEvent(event => {
      const value = event.payload;
      setOver(value.type === 'enter' || value.type === 'over');
      if (value.type === 'drop' && value.paths.length) void dropped.current(value.paths);
    });
    void unlisten.catch(e => setError(`Couldn't listen for dropped files: ${String(e)}`));
    return () => { void unlisten.then(fn => fn(), () => {}); };
  }, []);
  useEffect(() => {
    if (active && ready) void store.list().then(bundles => setVideos(recentVideos(bundles))).catch(e => setError(String(e)));
  }, [active, ready, store]);
  const home = () => { setError(''); navigate({ s: 'home' }); };
  useKeybinds({
    home: () => { setError(''); navigate(folder && route.s === 'source' ? { s: 'folder', folderId: folder.id } : { s: 'home' }); },
    settings: () => navigate({ s: 'settings' }),
  }, active);
  const openVideo = async (video: VideoBundle) => {
    try { onOpenVideo(await store.load(video.id)); } catch (e) { setError(`Couldn't open the saved video: ${String(e)}`); }
  };
  const removeVideo = async (id: string) => { await store.remove(id); setVideos(current => current.filter(v => v.id !== id)); };
  const folders = [...library.folders].sort((a, b) => b.openedAt - a.openedAt).map(f => {
    const sources = library.sources.filter(s => s.folderId === f.id);
    return { ...f, sourceCount: sources.length, sources };
  });
  if (route.s === 'settings') return <Settings onBack={home} />;
  if (route.s === 'source' && source) return <SourceView key={source.id} source={source} folderName={folder?.name}
    sections={content?.sections ?? []} videos={recentVideos(videos, new Set([source.pdfPath]))}
    initialDetail={detail} onDetailChange={value => { setDetail(value); void jsonStore.write('video-detail', value).catch(e => setError(String(e))); }}
    loading={loading} progress={progress} error={error || (job?.status === 'failed' ? job.error : '')} cleanupPending={job?.status === 'tidying'} onRetryCleanup={job?.status === 'failed' ? () => { queue.enqueue(source.pdfPath, true); } : undefined} preparation={job}
    onBack={() => { setError(''); navigate(folder ? { s: 'folder', folderId: folder.id } : { s: 'home' }); }} onHome={home} onSettings={() => navigate({ s: 'settings' })}
    onOpenVideo={v => void openVideo(v)} onDeleteVideo={removeVideo}
    onGenerate={(ids, detail) => { if (!content) return; onStart(ids, content.ir, { pdfPath: source.pdfPath, title: multiTitle(ids.map(id => content.sections.find(s => s.id === id)!.title)), detail }); }} />;
  return <LibraryView shortcutsActive={active} folders={folders} folder={folder ? folders.find(f => f.id === folder.id) : undefined}
    sources={library.sources.filter(s => folder ? s.folderId === folder.id : !s.folderId)}
    videos={recentVideos(videos, folder ? new Set(library.sources.filter(s => s.folderId === folder.id).map(s => s.pdfPath)) : undefined)}
    onBack={home} onHome={home} onSettings={() => navigate({ s: 'settings' })} onOpenFolder={id => { void update(current => ({ ...current, folders: current.folders.map(f => f.id === id ? { ...f, openedAt: Date.now() } : f) })).then(() => navigate({ s: 'folder', folderId: id })).catch(e => setError(String(e))); }}
    onOpenSource={id => { setError(''); navigate({ s: 'source', sourceId: id, folderId: folder?.id }); }} onOpenVideo={v => void openVideo(v)} onDeleteVideo={removeVideo}
    onChoosePdf={() => { void open({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] }).then(path => { if (path) return importPaths(typeof path === 'string' ? [path] : path); }).catch(e => setError(String(e))); }}
    onDropFiles={files => { void importPaths(files.map(file => (file as File & { path?: string }).path ?? file.name)); }}
    uploads={uploads} onRetryUpload={path => { queue.enqueue(path, true); }}
    onCreateFolder={(name, emoji) => update(current => addFolder(current, name, emoji))}
    onRenameFolder={(id, name) => update(current => ({ ...current, folders: current.folders.map(f => f.id === id ? { ...f, name } : f) }))}
    onDeleteFolder={async id => { await update(current => deleteFolder(current, id)); home(); }}
    onMoveSource={(id, target) => update(current => moveSource(current, id, target))}
    over={over} loading={!ready && !error ? 'Opening your library…' : ''} error={error} onRetry={error ? () => { setError(''); if (!ready) setLoadAttempt(n => n + 1); } : undefined} />;
}
