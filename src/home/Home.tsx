import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import LibraryView from './LibraryView';
import SourceView from './SourceView';
import { listSections, multiTitle, originalPdf, pdfPreview, type IR, type SectionRef } from './api';
import { loadIr, type LoadProgress } from '../library';
import { sourceFor, tauriJsonStore, type JsonStore } from '../storage/store';
import { addFolder, addSource, deleteFolder, emptyLibrary, moveSource, readLibrary, recentVideos, saveLibrary, type Library } from '../storage/library';
import { tauriVideoStore, type VideoBundle, type VideoStore } from '../storage/videos';
import { sectionTitles } from './sectionTitles';
import { providers } from '../llm/registry';
import type { LLMProvider } from '../llm/provider';
import { isDetailLevel, type DetailLevel } from '../gen/script';

export type StartMeta = { pdfPath: string; title: string; detail: DetailLevel };
export type LibraryRoute = { s: 'home' } | { s: 'folder'; folderId: string } | { s: 'source'; sourceId: string; folderId?: string };
const isTauri = () => '__TAURI_INTERNALS__' in window;

export default function Home({ onStart = () => {}, onOpenVideo = () => {}, store = tauriVideoStore, jsonStore = tauriJsonStore, provider = providers.claude, route: controlledRoute, onNavigate }: {
  onStart?: (ids: string[], ir: IR, meta: StartMeta) => void; onOpenVideo?: (video: VideoBundle) => void;
  store?: VideoStore; jsonStore?: JsonStore; provider?: LLMProvider; route?: LibraryRoute; onNavigate?: (route: LibraryRoute) => void;
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
  const [loading, setLoading] = useState('');
  const [progress, setProgress] = useState<LoadProgress>();
  const [over, setOver] = useState(false);
  const [content, setContent] = useState<{ id: string; ir: IR; sections: SectionRef[] }>();
  const [cleanup, setCleanup] = useState<'pending' | 'failed' | 'done'>('done');
  const [cleanupAttempt, setCleanupAttempt] = useState(0);
  const lastCleanupAttempt = useRef(0);
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [pdfAttempt, setPdfAttempt] = useState(0);
  const [pdfRequested, setPdfRequested] = useState(false);
  const sourceId = route.s === 'source' ? route.sourceId : undefined;
  const source = library.sources.find(s => s.id === sourceId);
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
  useEffect(() => {
    let live = true;
    void Promise.all([readLibrary(jsonStore), store.list(), jsonStore.read<string>('video-detail')]).then(async ([saved, bundles, preference]) => {
      // Recover PDFs referenced by existing saved videos without relying on old localStorage recents.
      const next = bundles.reduce((all, video) => addSource(all, video.source.pdfPath), saved);
      if (next !== saved) await saveLibrary(jsonStore, next);
      if (live) { libraryRef.current = next; setLibrary(next); setVideos(recentVideos(bundles)); if (isDetailLevel(preference)) setDetail(preference); setReady(true); }
    }).catch(e => { if (live) setError(`Couldn't open the library: ${String(e)}`); });
    return () => { live = false; };
  }, [jsonStore, store, loadAttempt]);
  useEffect(() => {
    if (!source) { setLoading(''); setProgress(undefined); return; }
    const retry = cleanupAttempt !== lastCleanupAttempt.current;
    lastCleanupAttempt.current = cleanupAttempt;
    let live = true;
    setContent(undefined); setError(''); setLoading(`Reading ${source.name}…`); setProgress(undefined); setCleanup('pending');
    void (async () => {
      try {
        const ir = await loadIr(source.pdfPath, p => { if (live) setProgress(p); }, jsonStore);
        const sections = await listSections(ir);
        if (!live) return;
        setContent({ id: source.id, ir, sections }); setLoading('');
        try {
          const cleaned = await sectionTitles(source.id, sections, ir, jsonStore, provider, retry);
          if (live) { setContent({ id: source.id, ir, sections: cleaned.sections }); setCleanup(cleaned.incomplete ? 'failed' : 'done'); }
        } catch { if (live) setCleanup('failed'); }
      } catch (e) { if (live) { setLoading(''); setError(`Couldn't read that PDF: ${String(e)}`); setCleanup('failed'); } }
    })();
    return () => { live = false; };
  }, [source?.id, source?.pdfPath, jsonStore, provider, cleanupAttempt]);
  useEffect(() => {
    setPdfRequested(false); setPdfUrl(undefined);
  }, [sourceId]);
  useEffect(() => {
    if (!source || !pdfRequested) return;
    let live = true;
    void originalPdf(source.pdfPath).then(url => {
      if (live) setPdfUrl(url);
    }).catch(e => { if (live) setError(`Couldn't open the original PDF: ${String(e)}`); });
    return () => { live = false; };
  }, [source?.id, source?.pdfPath, pdfRequested, pdfAttempt]);
  const importPath = async (path: string) => {
    if (!ready || loading) return;
    if (!/\.pdf$/i.test(path)) { setError("That isn't a PDF. Choose a .pdf file."); return; }
    try {
      const target = folderId ?? null;
      await update(current => addSource(current, path, target));
      const id = sourceFor(path).id;
      navigate({ s: 'source', sourceId: id, folderId: target ?? undefined });
      void pdfPreview(path).then(preview => update(current => ({ ...current, sources: current.sources.map(s => s.id === id ? { ...s, pageCount: preview.pages, thumbnailUrl: preview.thumbnailUrl } : s) }))).catch(() => {});
    } catch (e) { setError(`Couldn't add the PDF: ${String(e)}`); }
  };
  const dropped = useRef(importPath); dropped.current = importPath;
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWebview().onDragDropEvent(event => {
      const value = event.payload;
      setOver(value.type === 'enter' || value.type === 'over');
      if (value.type === 'drop' && value.paths.length) void dropped.current(value.paths.find(p => /\.pdf$/i.test(p)) ?? value.paths[0]);
    });
    void unlisten.catch(e => setError(`Couldn't listen for dropped files: ${String(e)}`));
    return () => { void unlisten.then(fn => fn(), () => {}); };
  }, []);
  const home = () => { setError(''); navigate({ s: 'home' }); };
  const openVideo = async (video: VideoBundle) => {
    try { onOpenVideo(await store.load(video.id)); } catch (e) { setError(`Couldn't open the saved video: ${String(e)}`); }
  };
  const removeVideo = async (id: string) => { await store.remove(id); setVideos(current => current.filter(v => v.id !== id)); };
  const folders = [...library.folders].sort((a, b) => b.openedAt - a.openedAt).map(f => {
    const sources = library.sources.filter(s => s.folderId === f.id);
    return { ...f, sourceCount: sources.length, sources };
  });
  if (route.s === 'source' && source) return <SourceView key={source.id} source={source} folderName={folder?.name}
    sections={content?.id === source.id ? content.sections : []} videos={recentVideos(videos, new Set([source.pdfPath]))}
    initialDetail={detail} onDetailChange={value => { setDetail(value); void jsonStore.write('video-detail', value).catch(e => setError(String(e))); }}
    loading={loading} progress={loading ? progress : undefined} error={error} cleanupPending={cleanup === 'pending'} onRetryCleanup={cleanup === 'failed' ? () => setCleanupAttempt(n => n + 1) : undefined}
    onBack={() => { setError(''); navigate(folder ? { s: 'folder', folderId: folder.id } : { s: 'home' }); }} onHome={home}
    onOpenVideo={v => void openVideo(v)} onDeleteVideo={removeVideo} pdfUrl={pdfUrl} onOpenOriginal={() => { setPdfRequested(true); setPdfAttempt(n => n + 1); }}
    onGenerate={(ids, detail) => { if (content?.id !== source.id) return; onStart(ids, content.ir, { pdfPath: source.pdfPath, title: multiTitle(ids.map(id => content.sections.find(s => s.id === id)!.title)), detail }); }} />;
  return <LibraryView folders={folders} folder={folder ? folders.find(f => f.id === folder.id) : undefined}
    sources={library.sources.filter(s => folder ? s.folderId === folder.id : !s.folderId)}
    videos={recentVideos(videos, folder ? new Set(library.sources.filter(s => s.folderId === folder.id).map(s => s.pdfPath)) : undefined)}
    onBack={home} onHome={home} onOpenFolder={id => { void update(current => ({ ...current, folders: current.folders.map(f => f.id === id ? { ...f, openedAt: Date.now() } : f) })).then(() => navigate({ s: 'folder', folderId: id })).catch(e => setError(String(e))); }}
    onOpenSource={id => navigate({ s: 'source', sourceId: id, folderId: folder?.id })} onOpenVideo={v => void openVideo(v)} onDeleteVideo={removeVideo}
    onChoosePdf={() => { void open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] }).then(path => { if (typeof path === 'string') return importPath(path); }).catch(e => setError(String(e))); }}
    onDropFile={file => { void importPath((file as File & { path?: string }).path ?? file.name); }}
    onCreateFolder={(name, emoji) => update(current => addFolder(current, name, emoji))}
    onRenameFolder={(id, name) => update(current => ({ ...current, folders: current.folders.map(f => f.id === id ? { ...f, name } : f) }))}
    onDeleteFolder={async id => { await update(current => deleteFolder(current, id)); home(); }}
    onMoveSource={(id, target) => update(current => moveSource(current, id, target))}
    over={over} loading={!ready && !error ? 'Opening your library…' : loading} progress={progress} error={error} onRetry={error ? () => { setError(''); if (!ready) setLoadAttempt(n => n + 1); } : undefined} />;
}
