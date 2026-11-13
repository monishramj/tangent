import useKeybinds from '@/hooks/useKeybinds';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, File02Icon, MoreHorizontalIcon, PlayIcon, Upload04Icon } from '@hugeicons/core-free-icons';
import Icon from '@/components/Icon';
import Folder from '@/components/Folder';
import SpotlightCard from '@/components/SpotlightCard';
import AnimatedList from '@/components/AnimatedList';
import ShinyText from '@/components/ShinyText';
import { Settings01Icon } from '@hugeicons/core-free-icons';
import TextField from '@/components/ui/TextField';
import Select from '@/components/ui/Select';
import Menu from '@/components/ui/Menu';
import { videoDuration, type VideoBundle } from '../storage/videos';
import type { LoadProgress } from '../library';
import type { IngestItem } from './ingestQueue';
import logo from '../../assets/tangent-icon.png';
import './views.css';

export type SourceSummary = {
  id: string; name: string; pdfPath: string; folderId?: string | null;
  thumbnailUrl?: string; pageCount?: number;
};
export type FolderSummary = {
  id: string; name: string; emoji?: string; sourceCount: number;
  sources?: { name: string; thumbnailUrl?: string }[];
};
type Mutation = void | Promise<void>;
export type LibraryViewProps = {
  shortcutsActive?: boolean;
  folders: FolderSummary[]; sources: SourceSummary[]; videos: VideoBundle[]; folder?: FolderSummary;
  onOpenFolder: (id: string) => void; onBack: () => void; onHome?: () => void; onSettings?: () => void;
  onOpenSource: (id: string) => void; onOpenVideo: (video: VideoBundle) => void;
  onChoosePdf: () => void; onDropFiles: (files: File[]) => void;
  uploads?: IngestItem<unknown>[]; onRetryUpload?: (path: string) => void;
  onCreateFolder: (name: string, emoji?: string) => Mutation;
  onRenameFolder: (id: string, name: string) => Mutation;
  onDeleteFolder: (id: string) => Mutation;
  onMoveSource: (id: string, folderId: string | null) => Mutation;
  onDeleteVideo?: (id: string) => Mutation;
  over?: boolean; loading?: string; progress?: LoadProgress; error?: string; onRetry?: () => void;
};

export function LibraryShell({ children, onHome, onSettings, wide = false }: { children: ReactNode; onHome: () => void; onSettings?: () => void; wide?: boolean }) {
  return <main className="tl-library"><div className={`tl-wrap ${wide ? 'tl-wide' : ''}`}>
    <header className="tl-header"><button className="tl-wordmark" onClick={onHome} aria-label="Tangent home"><img src={logo} alt="" />tangent</button>{onSettings && <button type="button" aria-label="Settings" onClick={onSettings} className="tl-icon-button"><Icon icon={Settings01Icon} size={20} /></button>}</header>
    {children}
  </div></main>;
}

const videoStyle = {
  '--al-tile': 'transparent', '--al-tile-edge': 'transparent', '--al-tile-highlight': 'transparent',
  '--al-tile-shadow': 'none', '--al-ink': 'var(--fg)', '--al-muted': 'var(--fg-subtle)',
  '--al-ring': 'var(--line)', '--al-ring-fill': 'rgba(255,255,255,0.04)', '--al-hover': 'none', '--al-active': 'none',
} as CSSProperties;
const duration = (v: VideoBundle) => { const seconds = Math.floor(videoDuration(v)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const videoMeta = (v: VideoBundle) => `${duration(v)} · ${new Date(v.createdAt).toLocaleDateString()}${v.complete ? '' : ' · Partial'}`;

export function VideoList({ videos, onOpen, onDelete, label = 'Recent videos' }: {
  videos: VideoBundle[]; onOpen: (video: VideoBundle) => void; onDelete?: (id: string) => Mutation; label?: string;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const remove = async (id: string) => {
    setDeleting(true); setError('');
    try { await onDelete?.(id); setConfirm(null); } catch (e) { setError(`Couldn't delete the video: ${String(e)}`); }
    finally { setDeleting(false); }
  };
  if (!videos.length) return <p className="tl-empty">{label === 'Recent videos' ? 'No recent videos yet.' : 'No videos from this PDF yet.'}</p>;
  if (!onDelete) return <AnimatedList ariaLabel={label} items={videos.map(v => ({ id: v.id, title: v.title, description: videoMeta(v), icon: <Icon icon={PlayIcon} size={18} /> }))}
    onItemSelect={(_, i) => onOpen(videos[i])} animation="fade" stagger={0.04} frame={false} showGradients={false} width="100%" maxHeight="none" gap={6} style={videoStyle} />;
  return <><ul className="tl-video-list" aria-label={label}>{videos.map(v => <li key={v.id}>
    <div className="tl-video-row"><button className="tl-video-open" onClick={() => onOpen(v)}><span className="tl-play"><Icon icon={PlayIcon} size={18} /></span><span><strong>{v.title}</strong><small>{videoMeta(v)}</small></span></button>
      <button className="tl-icon-button" aria-label={`Delete ${v.title}`} onClick={() => { setConfirm(v.id); setError(''); }}><Icon icon={MoreHorizontalIcon} size={18} /></button></div>
    {confirm === v.id && <div className="tl-confirm"><span>Delete this saved video?</span><button className="tl-text-button" disabled={deleting} onClick={() => void remove(v.id)}>Confirm delete</button><button className="tl-text-button" disabled={deleting} onClick={() => setConfirm(null)}>Keep</button></div>}
  </li>)}</ul>{error && <p className="tl-error" role="alert">{error}</p>}</>;
}

export default function LibraryView(props: LibraryViewProps) {
  const { folders, sources, videos, folder, onBack, onOpenFolder, onOpenSource, onOpenVideo } = props;
  const [allFolders, setAllFolders] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📚');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setForm(null); setError(''); setOpening(null); setClosing(false); }, [folder?.id]);
  const cancelOpening = () => { if (timer.current) clearTimeout(timer.current); setOpening(null); };
  const closeFolder = (done: () => void) => {
    cancelOpening();
    if (!folder || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    setClosing(true);
    timer.current = setTimeout(done, 180 + Math.min(Math.max(0, sources.length - 1) * 60, 300));
  };
  const home = () => closeFolder(() => { setAllFolders(false); setForm(null); (props.onHome ?? onBack)(); });
  const openFolder = (id: string) => {
    cancelOpening(); setOpening(id);
    timer.current = setTimeout(() => {
      setOpening(null); onOpenFolder(id);
      document.querySelector('.tl-library')?.scrollTo?.({ top: 0 });
    }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 320);
  };
  const mutate = async (action: () => Mutation) => {
    setBusy(true); setError('');
    try { await action(); setForm(null); } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const startForm = (kind: 'create' | 'rename' | 'delete') => { setForm(kind); setName(kind === 'rename' ? folder?.name ?? '' : ''); setEmoji('📚'); setError(''); };
  useKeybinds({
    newFolder: folder ? undefined : () => startForm('create'),
    choosePdfs: () => { if ('__TAURI_INTERNALS__' in window) props.onChoosePdf(); else input.current?.click(); },
  }, props.shortcutsActive ?? true);
  const shownFolders = allFolders ? folders : folders.slice(0, 3);
  const isAllFolders = allFolders && !folder;
  return <LibraryShell onHome={home} onSettings={props.onSettings}>
    {(folder || allFolders) && <button className="tl-back" onClick={() => { if (folder) closeFolder(onBack); else { cancelOpening(); setAllFolders(false); } }}><Icon icon={ArrowLeft01Icon} size={16} />{folder && allFolders ? 'All folders' : 'Home'}</button>}
    <div className={`tl-content ${folder ? 'tl-folder-view' : ''} ${closing ? 'tl-closing' : ''}`} inert={closing || undefined} style={folder ? { '--folder-exit-delay': `${Math.min(Math.max(0, sources.length - 1) * 60, 300)}ms` } as CSSProperties : undefined} key={folder?.id ?? (allFolders ? 'all' : 'home')}>
      <div className="tl-heading"><div><h1>{folder ? <><span className="tl-heading-emoji" aria-hidden>{folder.emoji || '📚'}</span>{folder.name}</> : isAllFolders ? 'All folders.' : 'library'}</h1>{(folder || isAllFolders) && <p>{folder ? `${folder.sourceCount} ${folder.sourceCount === 1 ? 'PDF' : 'PDFs'}` : 'Everything, in its place.'}</p>}</div>
        {folder ? <Menu label="Folder actions" trigger={<Icon icon={MoreHorizontalIcon} size={20} />}><button role="menuitem" tabIndex={-1} onClick={() => startForm('rename')}>Rename folder</button><button role="menuitem" tabIndex={-1} onClick={() => startForm('delete')}>Delete folder</button></Menu>
          : <button className="tl-text-button" onClick={() => startForm('create')}><Icon icon={Add01Icon} size={17} />New folder</button>}
      </div>
      {form && <section className="tl-form" aria-label={form === 'create' ? 'Create folder' : form === 'rename' ? 'Rename folder' : 'Delete folder'}>
        {form === 'delete' && folder ? <><p>Delete “{folder.name}”? Its PDFs will stay in your library.</p><div className="tl-form-actions"><button className="tl-primary" disabled={busy} onClick={() => void mutate(() => props.onDeleteFolder(folder.id))}>Delete folder</button><button className="tl-text-button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div></>
          : <form onSubmit={e => { e.preventDefault(); if (!name.trim()) return; void mutate(() => form === 'create' ? props.onCreateFolder(name.trim(), emoji.trim() || '📚') : props.onRenameFolder(folder!.id, name.trim())); }}>
            <label>Folder name<TextField autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. CS 251" /></label>
            {form === 'create' && <label className="tl-emoji-input">Emoji<TextField aria-label="Folder emoji" maxLength={16} value={emoji} onChange={e => setEmoji(e.target.value)} /></label>}
            <div className="tl-form-actions"><button className="tl-primary" disabled={busy || !name.trim()}>{form === 'create' ? 'Create folder' : 'Save name'}</button><button type="button" className="tl-text-button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div>
          </form>}
      </section>}
      {(error || props.error) && <div className="tl-error" role="alert">{error || props.error}{props.onRetry && <button className="tl-text-button" onClick={props.onRetry}>Try again</button>}</div>}
      {!folder && <section className={`tl-bookshelf ${allFolders ? 'tl-all-folders' : ''}`} aria-label="Folders">
        {!allFolders && <div className="tl-shelf-heading"><h2>Recently opened</h2>{folders.length > 3 && <button className="tl-text-button" onClick={() => setAllFolders(true)}>See all <Icon icon={ArrowRight01Icon} size={16} /></button>}</div>}
        {shownFolders.length ? <><div className="tl-shelf-books">{shownFolders.map(f => <div className={`tl-shelf-book ${opening === f.id ? 'tl-opening' : ''}`} key={f.id}>
          <Folder label={f.name} cover={<span className="tl-folder-emoji">{f.emoji || '📚'}</span>} mode="book" layout="stack" variant="matte" color="#393939" paperColor="#d6d3cb" size={1.05}
            items={(f.sources ?? []).slice(0, 3).map(s => ({ title: s.name, image: s.thumbnailUrl, alt: `First page of ${s.name}` }))}
            open={opening === f.id} peek intro={false} tilt={1} bounce={0.1} draggable={false} zoomOnClick={false} closeOnOutsideClick={false} onOpenChange={open => { if (open) openFolder(f.id); }} />
          <button className="tl-book-caption" onClick={() => openFolder(f.id)}><strong>{f.name}</strong><small>{f.sourceCount} {f.sourceCount === 1 ? 'PDF' : 'PDFs'}</small></button>
        </div>)}</div>{!allFolders && <div className="tl-shelf-edge" />}</> : <p className="tl-empty">Folders are optional. Add one for a class, or keep your PDFs below.</p>}
      </section>}
      {!isAllFolders && <>
        {folder && sourceList()}
        <SpotlightCard data-testid="dropzone" spotlightColor="#fff" intensity={0.07} borderGlow={0.3} className="tl-drop"
          style={{ '--spotlight-card-surface': dragOver || props.over ? 'rgba(255,255,255,0.05)' : 'transparent', '--spotlight-card-border': dragOver || props.over ? 'var(--line-hover)' : 'var(--line)', '--spotlight-card-shadow': 'none' } as CSSProperties}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); if (!props.loading) props.onDropFiles(Array.from(e.dataTransfer.files ?? [])); }}>
          {props.loading ? <div className="tl-loading" role="status"><ShinyText text={props.loading} color="#999" shineColor="#fff" />{props.progress && <><progress aria-label="Reading PDF" value={props.progress.fraction} max={1} /><small>{props.progress.label}</small></>}</div>
            : <><Icon icon={Upload04Icon} size={23} /><div><strong>Drop PDFs here</strong>{folder && <span>Add reading material to {folder.name}.</span>}</div><button className="tl-quiet" onClick={() => { if ('__TAURI_INTERNALS__' in window) props.onChoosePdf(); else input.current?.click(); }}>Choose PDFs <Icon icon={Add01Icon} size={16} /></button></>}
          <input ref={input} type="file" multiple accept="application/pdf,.pdf" hidden onChange={e => { props.onDropFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </SpotlightCard>
        <div className={folder ? undefined : 'tl-library-columns'}>
          {!folder && <section className="tl-section"><h2>Loose pages</h2>{sourceList()}</section>}
          <section className="tl-section"><h2>Recent videos</h2><VideoList videos={videos} onOpen={onOpenVideo} onDelete={props.onDeleteVideo} /></section>
        </div>
      </>}
    </div>
  </LibraryShell>;

  function sourceList() {
    if (!sources.length) return <p className="tl-empty">{folder ? 'No reading material yet. Drop in your first PDF below.' : 'No PDFs outside folders yet.'}</p>;
    return <ul className="tl-files" aria-label="Reading material">{sources.map((s, index) => { const upload = props.uploads?.find(item => item.path === s.pdfPath); return <li key={s.id} style={folder ? { '--row-delay': `${Math.min(index * 60, 300)}ms`, '--close-delay': `${Math.min((sources.length - 1 - index) * 60, 300)}ms` } as CSSProperties : undefined}>
      <button className="tl-file-open" onClick={() => onOpenSource(s.id)}><span className="tl-file-icon">{s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" /> : <Icon icon={File02Icon} size={21} />}</span><span><strong>{s.name}</strong><small>PDF{s.pageCount ? ` · ${s.pageCount} pages` : ''}{upload && ` · ${upload.status === 'reading' ? `Reading ${Math.round((upload.progress?.fraction ?? 0) * 100)}%` : upload.status === 'queued' ? 'Queued' : upload.status === 'done' ? 'Done' : 'Failed'}`}</small>{upload?.status === 'reading' && <span className="tl-loading" role="status"><progress aria-label={`Reading ${s.name}`} value={upload.progress?.fraction ?? 0} max={1} /><small>{upload.progress?.label}</small></span>}</span><Icon icon={ArrowRight01Icon} size={18} /></button>
      {upload?.status === 'failed' && <button className="tl-text-button" aria-label={`Retry ${s.name}`} title={upload.error} onClick={() => props.onRetryUpload?.(s.pdfPath)}>Retry</button>}
      <Menu form label={`Move ${s.name}`} trigger={<Icon icon={MoreHorizontalIcon} size={18} />}><label>Move to folder<Select aria-label={`Folder for ${s.name}`} value={s.folderId ?? ''} disabled={busy} onChange={e => void mutate(() => props.onMoveSource(s.id, e.target.value || null))}><option value="">No folder</option>{folders.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</Select></label></Menu>
    </li>; })}</ul>;
  }
}
