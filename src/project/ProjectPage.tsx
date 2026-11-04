import { useEffect, useState } from "react";
import Glass from "@/components/Glass";
import type { SectionRef } from "../home/api";
import { newId, projects, tauriJsonStore, type JsonStore, type Note, type Project, type Source } from "../storage/projects";
import { tauriVideoStore, videoDuration, type VideoBundle, type VideoStore } from "../storage/videos";

export type Progress = { fraction: number; label: string };
export type PracticeItem = { videoTitle: string; prompt: string; correct?: boolean };
export type GenerateArgs = { project: Project; source: Source; sectionId: string; title: string };
export type ProjectPageProps = {
  project: Project;
  store?: JsonStore; videoStore?: VideoStore;
  pickPdf: () => Promise<string | null>;
  loadSections: (source: Source, onProgress?: (p: Progress) => void) => Promise<SectionRef[]>;
  onGenerate: (args: GenerateArgs) => void;
  onOpenVideo: (b: VideoBundle) => void;
  onJump?: (note: Note) => void;
  onBack: () => void;
  practice?: PracticeItem[];
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pages = (a: { page: number }[]) => {
  if (!a.length) return "";
  const [lo, hi] = [Math.min(...a.map(x => x.page)), Math.max(...a.map(x => x.page))];
  return lo === hi ? `p. ${lo}` : `pp. ${lo}-${hi}`;
};
const btn = "flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-fg hover:bg-fg/10";
const field = "min-h-11 rounded-lg border border-line bg-transparent px-3 text-fg placeholder:text-subtle";
const pathOf = (f: File) => (f as File & { path?: string }).path ?? f.name;
const nameOf = (p: string) => p.split(/[\\/]/).pop() || p;

type Secs = { status: "loading"; progress?: Progress } | { status: "ready"; sections: SectionRef[] } | { status: "error"; msg: string };

export default function ProjectPage({ project: initial, store = tauriJsonStore, videoStore = tauriVideoStore, pickPdf, loadSections, onGenerate, onOpenVideo, onJump, onBack, practice = [] }: ProjectPageProps) {
  const [project, setProject] = useState(initial);
  const [videos, setVideos] = useState<VideoBundle[]>([]);
  const [secs, setSecs] = useState<Record<string, Secs>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [confirmSrc, setConfirmSrc] = useState<string | null>(null);
  const [confirmVid, setConfirmVid] = useState<string | null>(null);
  const [tab, setTab] = useState<"videos" | "practice">("videos");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);

  useEffect(() => {
    let live = true;
    videoStore.list().then(v => live && setVideos(v.filter(x => x.projectId === project.id)), () => {});
    return () => { live = false; };
  }, [videoStore, project.id]);

  const update = async (next: Project) => {
    setProject(next);
    try { await projects(store).save(next); } catch (e) { setError(`Couldn't save: ${e}`); }
  };

  const addSource = async (pdfPath: string | null) => {
    if (!pdfPath) return;
    await update({ ...project, sources: [...project.sources, { id: newId("src"), name: nameOf(pdfPath), pdfPath, addedAt: Date.now() }] });
  };
  const add = async () => { try { await addSource(await pickPdf()); } catch (e) { setError(`Couldn't add PDF: ${e}`); } };
  const drop = async (files: File[]) => {
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name));
    if (!pdfs.length) return setError("That isn't a PDF. Choose a .pdf file.");
    await update({ ...project, sources: [...project.sources, ...pdfs.map(f => ({ id: newId("src"), name: f.name, pdfPath: pathOf(f), addedAt: Date.now() }))] });
  };
  const expand = async (s: Source) => {
    const isOpen = !open[s.id];
    setOpen(o => ({ ...o, [s.id]: isOpen }));
    if (!isOpen || secs[s.id]?.status === "ready" || secs[s.id]?.status === "loading") return;
    setSecs(m => ({ ...m, [s.id]: { status: "loading" } }));
    try {
      const sections = await loadSections(s, progress => setSecs(m => ({ ...m, [s.id]: { status: "loading", progress } })));
      setSecs(m => ({ ...m, [s.id]: { status: "ready", sections } }));
    } catch (e) {
      setSecs(m => ({ ...m, [s.id]: { status: "error", msg: String(e) } }));
    }
  };
  const removeSource = (id: string) => { setConfirmSrc(null); return update({ ...project, sources: project.sources.filter(s => s.id !== id) }); };
  const removeVideo = async (id: string) => {
    setConfirmVid(null);
    try { await videoStore.remove(id); setVideos(v => v.filter(x => x.id !== id)); } catch (e) { setError(`Couldn't delete: ${e}`); }
  };
  const rename = (name: string) => { setRenaming(null); return name.trim() && name.trim() !== project.name ? update({ ...project, name: name.trim() }) : undefined; };

  const addNote = async () => {
    if (!text.trim()) return;
    const note: Note = { id: newId("n"), text: text.trim(), createdAt: Date.now() };
    setText("");
    await update({ ...project, notes: [note, ...project.notes] });
  };
  const saveEdit = async () => {
    if (!editing) return;
    const t = editing.text.trim();
    setEditing(null);
    if (t) await update({ ...project, notes: project.notes.map(n => n.id === editing.id ? { ...n, text: t } : n) });
  };
  const jump = (n: Note) => {
    if (onJump) return onJump(n);
    const b = videos.find(v => v.id === n.from?.videoId);
    if (b) onOpenVideo(b);
  };
  const saved = (s: Source, sectionId: string) => videos.find(v => v.source.pdfPath === s.pdfPath && v.source.sectionId === sectionId);

  return (
    <main className="flex h-screen flex-col gap-4 bg-bg p-4">
      <header className="flex items-center gap-3">
        <button type="button" aria-label="Back to projects" onClick={onBack} className={btn}>←</button>
        <span className="text-3xl" aria-hidden="true">{project.emoji}</span>
        {renaming !== null ? (
          <form onSubmit={e => { e.preventDefault(); rename(renaming); }}>
            <input aria-label="Project name" autoFocus className={field} value={renaming} onChange={e => setRenaming(e.target.value)} onBlur={() => rename(renaming)} onKeyDown={e => e.key === "Escape" && setRenaming(null)} />
          </form>
        ) : (
          <button type="button" aria-label="Rename project" onClick={() => setRenaming(project.name)} className="min-h-11 rounded-lg px-2 text-2xl font-bold tracking-tight hover:bg-fg/10">{project.name}</button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[18rem_1fr_20rem] lg:overflow-hidden">
        <Glass role="region" aria-label="Sources" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); drop([...e.dataTransfer.files]); }}
          className={`flex flex-col gap-3 overflow-y-auto rounded-2xl p-4 ${over ? "ring-1 ring-fg" : ""}`}>
          <h2 className="text-lg font-semibold">Sources</h2>
          {project.sources.length === 0 && <p className="text-sm text-subtle">No sources yet. Add a PDF or drop one here.</p>}
          <ul className="flex flex-col gap-1">
            {project.sources.map(s => (
              <li key={s.id} className="flex items-center gap-1">
                <button type="button" aria-expanded={!!open[s.id]} aria-label={`Sections of ${s.name}`} onClick={() => expand(s)} className="flex min-h-11 flex-1 items-center gap-2 truncate rounded-lg px-2 text-left hover:bg-fg/10">
                  <span aria-hidden="true">{open[s.id] ? "▾" : "▸"}</span><span className="truncate">{s.name}</span>
                </button>
                {confirmSrc === s.id ? (
                  <><button type="button" className={btn} onClick={() => removeSource(s.id)}>Confirm remove</button><button type="button" className={btn} onClick={() => setConfirmSrc(null)}>Keep</button></>
                ) : (
                  <button type="button" aria-label={`Remove ${s.name}`} className={btn} onClick={() => setConfirmSrc(s.id)}>✕</button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className={btn} onClick={add}>Add PDF</button>
        </Glass>

        <Glass role="region" aria-label="Videos" className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl p-4">
          <div role="tablist" className="flex gap-2">
            {(["videos", "practice"] as const).map(t => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`${btn} ${tab === t ? "bg-fg/15" : ""}`}>{t === "videos" ? "Videos" : "Practice"}</button>
            ))}
          </div>
          {tab === "practice" ? (
            practice.length === 0 ? <p className="text-sm text-subtle">No practice yet</p> : (
              <ul aria-label="Practice" className="flex flex-col gap-2">
                {practice.map((p, i) => (
                  <li key={i} className="rounded-lg border border-line p-3">
                    <p className="text-xs text-subtle">{p.videoTitle}{p.correct === undefined ? "" : p.correct ? " · Correct" : " · Incorrect"}</p>
                    <p>{p.prompt}</p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <>
              {videos.length > 0 && (
                <ul aria-label="Saved videos" className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {videos.map(v => (
                    <li key={v.id} className="flex items-center gap-1 rounded-lg border border-line p-1">
                      <button type="button" aria-label={`Open ${v.title}`} onClick={() => onOpenVideo(v)} className="flex min-h-11 flex-1 flex-col items-start rounded-lg px-2 text-left hover:bg-fg/10">
                        <span className="font-medium">{v.title}</span>
                        <span className="text-xs text-subtle">{clock(videoDuration(v))} · {new Date(v.createdAt).toLocaleDateString()} · {v.complete ? "Complete" : "Partial"}</span>
                      </button>
                      {confirmVid === v.id ? (
                        <><button type="button" className={btn} onClick={() => removeVideo(v.id)}>Confirm delete</button><button type="button" className={btn} onClick={() => setConfirmVid(null)}>Keep</button></>
                      ) : (
                        <button type="button" aria-label={`Delete ${v.title}`} className={btn} onClick={() => setConfirmVid(v.id)}>Delete</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {project.sources.filter(s => open[s.id]).map(s => {
                const st = secs[s.id];
                return (
                  <section key={s.id} aria-label={`Sections: ${s.name}`} className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-muted">{s.name}</h3>
                    {st?.status === "loading" && (st.progress
                      ? <div role="progressbar" aria-label={st.progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.progress.fraction * 100)} className="flex flex-col gap-1">
                          <div className="h-1 rounded-full bg-line"><div className="h-1 rounded-full bg-fg" style={{ width: `${st.progress.fraction * 100}%` }} /></div>
                          <span className="text-xs text-subtle">{st.progress.label}</span>
                        </div>
                      : <div role="progressbar" aria-label="Reading" className="h-1 animate-pulse rounded-full bg-fg/50" />)}
                    {st?.status === "error" && <p role="alert">Couldn't read that PDF: {st.msg}</p>}
                    {st?.status === "ready" && (
                      <ul className="flex flex-col">
                        {st.sections.map(sec => {
                          const v = saved(s, sec.id);
                          return (
                            <li key={sec.id} className="flex min-h-11 items-center gap-3">
                              <span style={{ paddingLeft: Math.max(0, sec.level - 1) * 20 }} className={`flex-1 ${sec.level <= 1 ? "text-fg" : "text-muted"}`}>{sec.title}</span>
                              <span className="text-xs tabular-nums text-subtle">{pages(sec.anchors)}</span>
                              {v
                                ? <button type="button" aria-label={`Watch ${sec.title}`} className={btn} onClick={() => onOpenVideo(v)}>Watch</button>
                                : <button type="button" aria-label={`Generate ${sec.title}`} className={btn} onClick={() => onGenerate({ project, source: s, sectionId: sec.id, title: sec.title })}>Generate</button>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
              {project.sources.length > 0 && !project.sources.some(s => open[s.id]) && <p className="text-sm text-subtle">Open a source to see its sections.</p>}
            </>
          )}
        </Glass>

        <Glass role="region" aria-label="Notes" className="flex flex-col gap-3 overflow-y-auto rounded-2xl p-4">
          <h2 className="text-lg font-semibold">Notes</h2>
          <textarea aria-label="New note" className={`${field} py-2`} rows={3} placeholder="Write a note (Ctrl+Enter to save)" value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } }} />
          <button type="button" className={btn} onClick={addNote} disabled={!text.trim()}>Add note</button>
          <ul className="flex flex-col gap-2">
            {[...project.notes].sort((a, b) => b.createdAt - a.createdAt).map(n => (
              <li key={n.id} className="flex flex-col gap-1 rounded-lg border border-line p-3">
                {editing?.id === n.id ? (
                  <>
                    <textarea aria-label="Note text" className={`${field} py-2`} rows={3} autoFocus value={editing.text} onChange={e => setEditing({ id: n.id, text: e.target.value })}
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); } }} />
                    <div className="flex gap-2"><button type="button" className={btn} onClick={saveEdit}>Save</button><button type="button" className={btn} onClick={() => setEditing(null)}>Cancel</button></div>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    {n.from && <button type="button" onClick={() => jump(n)} className="flex min-h-11 items-center self-start rounded-full border border-line px-3 text-sm hover:bg-fg/10">▶ {n.from.videoTitle} @ {clock(n.from.t)}</button>}
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-xs text-subtle">{new Date(n.createdAt).toLocaleDateString()}</span>
                      <button type="button" aria-label="Edit note" className={btn} onClick={() => setEditing({ id: n.id, text: n.text })}>Edit</button>
                      <button type="button" aria-label="Delete note" className={btn} onClick={() => update({ ...project, notes: project.notes.filter(x => x.id !== n.id) })}>Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Glass>
      </div>
    </main>
  );
}
