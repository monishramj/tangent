import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, File02Icon, PlayIcon, Upload04Icon } from '@hugeicons/core-free-icons';
import Icon from '@/components/Icon';
import SpotlightCard from '@/components/SpotlightCard';
import AnimatedList from '@/components/AnimatedList';
import Folder from './home-design-folder';
import logo from '../../assets/tangent-icon.png';
import '../index.css';
import './home-design.css';

// Visual-only sample data. Nothing is uploaded, saved, or generated here.
const courses = [
  { name: 'CS 251', emoji: '🌳', title: 'Data structures', files: ['Algorithms, chapter 4', 'Trees & graphs', 'Week 8 lecture notes'], color: '#393939' },
  { name: 'STAT 350', emoji: '🎲', title: 'Probability & statistics', files: ['Joint probability distributions', 'Introduction to statistics'], color: '#57534e' },
  { name: 'CS 334', emoji: '🪩', title: 'Computer graphics', files: [], color: '#313137' },
  { name: 'CS 250', emoji: '💻', title: 'Computer architecture', files: ['Representing instructions'], color: '#343a3d' },
  { name: 'Reading', emoji: '📚', title: 'A few things for later', files: [], color: '#403a37' },
];
const thumbnails: Record<string, string> = {
  'Joint probability distributions': '/src/dev/home-design-previews/joint-probability.png',
  'Introduction to statistics': '/src/dev/home-design-previews/statistics.png',
  'Representing instructions': '/src/dev/home-design-previews/instructions.png',
};
const videoSamples = [
  { title: 'Binary heaps, explained', course: 0, source: 'Algorithms, chapter 4', duration: '8:24' },
  { title: 'Joint probabilities, explained', course: 1, source: 'Joint probability distributions', duration: '7:18' },
  { title: 'Building a heap', course: 0, source: 'Algorithms, chapter 4', duration: '6:12' },
  { title: 'Inside an instruction', course: 3, source: 'Representing instructions', duration: '5:40' },
];
const neutral = { '--al-tile': 'transparent', '--al-tile-edge': 'transparent', '--al-tile-highlight': 'transparent', '--al-tile-shadow': 'none', '--al-ink': '#fff', '--al-muted': '#999', '--al-ring': '#333', '--al-ring-fill': 'rgba(255,255,255,0.04)', '--al-hover': 'none', '--al-active': 'none' } as CSSProperties;

function Design() {
  const [course, setCourse] = useState<number | null>(null);
  const [allFolders, setAllFolders] = useState(false);
  const [recentFolders, setRecentFolders] = useState([0, 1, 3, 2, 4]);
  const [opening, setOpening] = useState<number | null>(null);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [tab, setTab] = useState<'sections' | 'pdf'>('sections');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [detail, setDetail] = useState('Standard');
  const [notice, setNotice] = useState('');
  const drag = useRef<{ start: number; base: number[]; add: boolean } | null>(null);
  useEffect(() => () => { if (openingTimer.current) clearTimeout(openingTimer.current); }, []);
  const cancelOpening = () => { if (openingTimer.current) clearTimeout(openingTimer.current); setOpening(null); };
  const home = () => { cancelOpening(); setCourse(null); setSource(null); setAllFolders(false); setNotice(''); };
  const openCourse = (index: number) => {
    if (openingTimer.current) clearTimeout(openingTimer.current);
    setOpening(index);
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 460;
    openingTimer.current = setTimeout(() => {
      setCourse(index); setOpening(null); setNotice('');
      setRecentFolders(previous => [index, ...previous.filter(i => i !== index)]);
      document.querySelector('.design')?.scrollTo({ top: 0 });
    }, delay);
  };
  const titles = course === 1 ? ['Joint distributions', 'Marginal distributions', 'Conditional probability', 'Independence', 'Expected values', 'Worked examples']
    : course === 3 ? ['Instructions', 'Registers', 'Arithmetic operations', 'Memory operations', 'Instruction encoding', 'Worked examples']
    : ['4.1  Priority queues', '4.2  Binary heaps', '4.3  Building a heap', '4.4  Heapsort', '4.5  Analysis of heapsort', '4.6  Applications'];
  const shownVideos = videoSamples.filter(v => (course === null || v.course === course) && (!source || v.source === source));
  const openSource = (name: string) => { setSource(name); setTab('sections'); setSelecting(false); setSelected([]); setNotice(''); };
  const back = () => { cancelOpening(); if (source) setSource(null); else if (course !== null) setCourse(null); else setAllFolders(false); setNotice(''); };
  const preview = (message: string) => setNotice(`${message} — preview only.`);
  const selectRange = (end: number) => {
    const d = drag.current;
    if (!d) return;
    const range = titles.map((_, i) => i).filter(i => i >= Math.min(d.start, end) && i <= Math.max(d.start, end));
    setSelected(d.add ? [...new Set([...d.base, ...range])] : d.base.filter(i => !range.includes(i)));
  };
  const videos = (compact = false) => shownVideos.length === 0 ? <p className="empty-videos">{source ? 'No videos yet. Make your first one from this PDF.' : 'No videos yet. Open a PDF to make your first one.'}</p> : <AnimatedList ariaLabel={compact ? 'Videos from this source' : 'Recent videos'}
    items={shownVideos.map(v => ({ title: v.title, description: compact ? `${v.duration} · Standard` : `${courses[v.course].name} · ${v.duration}`, icon: <Icon icon={PlayIcon} size={18} /> }))}
    onItemSelect={(_, i) => preview(`Play ${shownVideos[i].title}`)} animation="fade" stagger={0.04} frame={false} showGradients={false} width="100%" maxHeight="none" gap={6} style={neutral} />;
  const drop = <SpotlightCard spotlightColor="#fff" intensity={0.07} borderGlow={0.3} className="design-drop" style={{ '--spotlight-card-surface': 'transparent', '--spotlight-card-border': '#292929', '--spotlight-card-shadow': 'none' } as CSSProperties}
    onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); preview('Import a PDF'); }}>
    <Icon icon={Upload04Icon} size={23} /><div><strong>Drop a PDF here</strong><span>{course === null ? 'Give your next idea a place to start.' : `Add reading material to ${courses[course].name}.`}</span></div>
    <button className="quiet-button" onClick={() => preview('Choose PDF')}>Choose PDF <Icon icon={Add01Icon} size={16} /></button>
  </SpotlightCard>;
  const fileRows = (names: string[]) => names.length === 0 ? <p className="empty-folder">No reading material yet. Drop in your first PDF below.</p> : <div className="file-list">{names.map((name, i) => <button className="file-row" key={name} onClick={() => openSource(name)}><span className="file-icon">{thumbnails[name] ? <img src={thumbnails[name]} alt="" /> : <Icon icon={File02Icon} size={21} />}</span><span className="file-title">{name}<small>PDF · {i ? '18' : '32'} pages</small></span><Icon icon={ArrowRight01Icon} size={18} /></button>)}</div>;

  return <main className="design" onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <div className={`design-wrap ${source ? 'source-wrap' : ''}`}>
      <header className="design-header"><button className="wordmark" onClick={home} aria-label="Tangent home"><img src={logo} alt="" />tangent</button><span className="preview-tag">Design preview</span></header>
      {(course !== null || source || allFolders) && <button className="back-link" onClick={back}><Icon icon={ArrowLeft01Icon} size={16} />{source && course !== null ? courses[course].name : course !== null && allFolders ? 'All folders' : 'Home'}</button>}
      <div className="design-content" key={`${course}-${source}-${allFolders}`}>
      {!source ? <>
        <div className="page-heading"><div><h1>{course === null ? allFolders ? 'All folders.' : 'Your library.' : <><span className="heading-emoji" aria-hidden="true">{courses[course].emoji}</span>{courses[course].name}</>}</h1><p>{course === null ? allFolders ? 'Everything, in its place.' : 'A little reading. A new way to see it.' : courses[course].title}</p></div>{course === null && <button className="text-button" onClick={() => preview('Create folder')}><Icon icon={Add01Icon} size={17} />New folder</button>}</div>
        {course === null ? <section aria-label="Folders" className={`bookshelf ${allFolders ? 'all-folders' : ''}`}>
          {!allFolders && <div className="shelf-heading"><h2>Recently opened</h2><button className="text-button" onClick={() => { cancelOpening(); setAllFolders(true); }}>See all <Icon icon={ArrowRight01Icon} size={16} /></button></div>}
          <div className="shelf-books">{(allFolders ? courses.map((_, i) => i) : recentFolders.slice(0, 3)).map(i => { const c = courses[i]; return <div className={`shelf-book ${opening === i ? 'opening' : ''}`} key={c.name}>
          <Folder label={c.name} cover={<span className="folder-emoji">{c.emoji}</span>} mode="book" layout="stack" variant="matte" color={c.color} paperColor="#d6d3cb" size={1.05} items={c.files.length ? c.files.map(title => ({ title, image: thumbnails[title], alt: `First page of ${title}` })) : []} open={opening === i} peek intro={false} tilt={1} bounce={0.1} draggable={false} zoomOnClick={false} closeOnOutsideClick={false} onOpenChange={open => { if (open) openCourse(i); }} />
          <button className="book-caption" onClick={() => openCourse(i)}><strong>{c.name}</strong><span>{c.title}</span><small>{c.files.length} {c.files.length === 1 ? 'PDF' : 'PDFs'}</small></button>
        </div>; })}</div>{!allFolders && <div className="shelf-edge" />}</section> : fileRows(courses[course].files)}
        {!(allFolders && course === null) && <>
          {drop}
          {course === null && <section className="library-section"><h2>Loose pages<span>Not in a folder</span></h2>{fileRows(['The art of problem solving'])}</section>}
          <section className="library-section"><h2>Recent videos</h2>{videos()}</section>
        </>}
      </> : <>
        <div className="page-heading source-heading"><div><p className="eyebrow">READING MATERIAL</p><h1>{source}</h1><p>32 pages · 6 sections</p></div></div>
        <div className="source-grid"><section className="source-main">
          <div className="source-toolbar"><div className="tabs" role="tablist" aria-label="Source view"><button role="tab" aria-selected={tab === 'sections'} onClick={() => setTab('sections')}>Sections</button><button role="tab" aria-selected={tab === 'pdf'} onClick={() => setTab('pdf')}>Original PDF</button></div>{!selecting && <button className="primary" onClick={() => { setSelecting(true); setTab('sections'); }}>Make a video <Icon icon={Add01Icon} size={16} /></button>}</div>
          {tab === 'sections' ? <div role="tabpanel" aria-label="Sections">
            {selecting && <div className="selection-head"><span>Choose sections <small>Click or drag to select</small></span><button className="text-button" onClick={() => setSelected(selected.length === titles.length ? [] : titles.map((_, i) => i))}>{selected.length === titles.length ? 'Clear' : 'Select all'}</button></div>}
            <div className={`section-list ${selecting ? 'selecting' : ''}`}>{titles.map((title, i) => <div className={`section-row ${selected.includes(i) && selecting ? 'picked' : ''}`} key={title}
              onPointerDown={e => { if (!selecting || e.button !== 0 || (e.target as HTMLElement).tagName === 'INPUT') return; e.preventDefault(); drag.current = { start: i, base: selected, add: !selected.includes(i) }; selectRange(i); }}
              onPointerEnter={e => { if (e.buttons === 1) selectRange(i); else drag.current = null; }}>
              {selecting && <input type="checkbox" aria-label={`Select ${title}`} checked={selected.includes(i)} onChange={e => setSelected(e.target.checked ? [...selected, i] : selected.filter(x => x !== i))} />}
              <span>{title}</span><small>p. {i * 5 + 1}</small>
            </div>)}</div>
            {selecting && <div className="generation"><div className="generation-top"><label htmlFor="detail">Detail level</label><select id="detail" value={detail} onChange={e => setDetail(e.target.value)}>{['Overview', 'Standard', 'Detailed', 'Complete'].map(d => <option key={d}>{d}</option>)}</select></div><div className="generation-bottom"><button className="text-button" onClick={() => { setSelecting(false); setSelected([]); }}>Cancel</button><button className="primary" disabled={!selected.length} onClick={() => preview(`Generate ${selected.length} sections · ${detail}`)}>Make video{selected.length > 0 ? ` · ${selected.length} selected` : ''}<Icon icon={ArrowRight01Icon} size={16} /></button></div></div>}
          </div> : <div className="pdf-placeholder" role="tabpanel" aria-label="Original PDF"><Icon icon={File02Icon} size={34} /><strong>Original PDF</strong><p>Your document appears here.</p><small>Viewer placeholder for this design preview</small></div>}
        </section><aside className="source-videos"><h2>Videos<span>{shownVideos.length}</span></h2>{videos(true)}<p>Every video you make from this PDF lives here.</p></aside></div>
      </>}
      </div>
      {notice && <div className="design-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Design />);
