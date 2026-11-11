import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LibraryView, { type FolderSummary, type SourceSummary } from '../home/LibraryView';
import SourceView from '../home/SourceView';
import type { VideoBundle } from '../storage/videos';
import '../index.css';
const sections = [
  { id: 'parent', title: 'Foundations', level: 1, anchors: [{ page: 1 }] },
  { id: 'child', title: 'Arrays', level: 2, anchors: [{ page: 2 }] },
  { id: 'other', title: 'Trees', level: 1, anchors: [{ page: 4 }] },
];
function Check() {
  const [folders, setFolders] = useState<FolderSummary[]>(Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Class ${i + 1}`, emoji: '📚', sourceCount: i === 0 ? 1 : 0 })));
  const [sources, setSources] = useState<SourceSummary[]>([{ id: 'source', name: 'Algorithms.pdf', pdfPath: '/test.pdf', folderId: '0' }]);
  const [videos, setVideos] = useState<VideoBundle[]>([{ id: 'video', title: 'Arrays explained', createdAt: Date.now(), complete: true, source: { pdfPath: '/test.pdf', sectionId: 'child', sectionTitle: 'Arrays' }, scenes: [] }]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [generated, setGenerated] = useState('');
  const home = () => { setFolderId(null); setSourceId(null); };
  const source = sources.find(s => s.id === sourceId);
  const deleteVideo = (id: string) => setVideos(v => v.filter(item => item.id !== id));
  return <>{source ? <SourceView source={source} folderName={folders.find(f => f.id === folderId)?.name} sections={sections} videos={videos} onBack={() => setSourceId(null)} onHome={home} onOpenVideo={() => {}} onDeleteVideo={deleteVideo}
    onGenerate={(ids, detail) => setGenerated(`${ids.join(',')}|${detail}`)} onOpenOriginal={() => {}} />
    : <LibraryView folders={folders} sources={sources.filter(s => (s.folderId ?? null) === folderId)} videos={videos} folder={folders.find(f => f.id === folderId)} onOpenFolder={setFolderId} onBack={() => setFolderId(null)} onHome={home} onOpenSource={setSourceId} onOpenVideo={() => {}} onChoosePdf={() => {}} onDropFile={() => {}}
      onCreateFolder={(name, emoji) => setFolders(f => [...f, { id: name, name, emoji, sourceCount: 0 }])}
      onRenameFolder={(id, name) => setFolders(f => f.map(item => item.id === id ? { ...item, name } : item))}
      onDeleteFolder={id => { setFolders(f => f.filter(item => item.id !== id)); setSources(s => s.map(item => item.folderId === id ? { ...item, folderId: null } : item)); setFolderId(null); }}
      onMoveSource={(id, folderId) => setSources(s => s.map(item => item.id === id ? { ...item, folderId } : item))} onDeleteVideo={deleteVideo} />}
    <output id="check-result" hidden>{generated}</output></>;
}
createRoot(document.getElementById('root')!).render(<Check />);
