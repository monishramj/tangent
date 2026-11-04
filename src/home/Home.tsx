import { memo, useEffect, useState } from "react";
import Glass from "@/components/Glass";
import { newId, projects, tauriJsonStore, type JsonStore, type Project } from "../storage/projects";
import { tauriVideoStore, videoDuration, type VideoBundle, type VideoStore } from "../storage/videos";

export const EMOJIS = ["📘", "🧮", "💻", "🧠", "📊", "⚙️", "🧪", "🎨", "🔬", "📐"];
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const updated = (p: Project) => Math.max(p.createdAt, ...p.sources.map(s => s.addedAt), ...p.notes.map(n => n.createdAt));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const btn = "flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-fg hover:bg-fg/10";
const input = "min-h-11 rounded-lg border border-line bg-transparent px-3 text-fg placeholder:text-subtle";

export type HomeProps = {
  store?: JsonStore; videoStore?: VideoStore;
  onOpenProject: (p: Project) => void; onDemo?: () => void; onOpenVideo?: (b: VideoBundle) => void;
};

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Emoji" className="flex flex-wrap gap-1">
      {EMOJIS.map(e => (
        <button key={e} type="button" role="radio" aria-checked={value === e} aria-label={`Emoji ${e}`} onClick={() => onChange(e)}
          className={`flex size-11 items-center justify-center rounded-lg text-xl ${value === e ? "bg-fg/20 ring-1 ring-fg" : "hover:bg-fg/10"}`}>{e}</button>
      ))}
    </div>
  );
}

function Home({ store = tauriJsonStore, videoStore = tauriVideoStore, onOpenProject, onDemo, onOpenVideo }: HomeProps) {
  const [list, setList] = useState<Project[] | null>(null);
  const [videos, setVideos] = useState<VideoBundle[]>([]);
  const [draft, setDraft] = useState<{ name: string; emoji: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const db = projects(store);

  useEffect(() => {
    let live = true;
    db.list().then(l => live && setList(l), e => live && (setList([]), setError(`Couldn't load projects: ${e}`)));
    videoStore.list().then(v => live && setVideos(v), () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, videoStore]);

  const create = async () => {
    if (!draft?.name.trim()) return;
    const p: Project = { id: newId("p"), name: draft.name.trim(), emoji: draft.emoji, createdAt: Date.now(), sources: [], notes: [] };
    try { await db.save(p); setList(l => [p, ...(l ?? [])]); setDraft(null); } catch (e) { setError(`Couldn't create project: ${e}`); }
  };
  const rename = async (p: Project) => {
    const name = renaming?.name.trim();
    setRenaming(null);
    if (!name || name === p.name) return;
    const next = { ...p, name };
    try { await db.save(next); setList(l => l!.map(x => x.id === p.id ? next : x)); } catch (e) { setError(`Couldn't rename: ${e}`); }
  };
  const remove = async (id: string) => {
    setConfirm(null);
    try { await db.remove(id); setList(l => l!.filter(x => x.id !== id)); } catch (e) { setError(`Couldn't delete: ${e}`); }
  };

  const unsorted = list && list.length === 0 && onOpenVideo ? videos.filter(v => v.projectId === undefined) : [];

  return (
    <main className="h-screen overflow-y-auto bg-bg px-6 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header>
          <h1 className="text-5xl font-bold tracking-tight">Tangent</h1>
          <p className="mt-2 text-base text-muted">Turn your textbooks into videos you can interrupt.</p>
        </header>
        {error && <p role="alert" className="text-fg">{error}</p>}

        <section aria-label="Projects" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(list ?? []).map(p => {
            const nv = videos.filter(v => v.projectId === p.id).length;
            return (
              <Glass key={p.id} className="relative flex min-h-36 flex-col rounded-2xl p-4">
                {renaming?.id === p.id ? (
                  <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); rename(p); }}>
                    <input aria-label="Project name" autoFocus className={input} value={renaming.name} onChange={e => setRenaming({ id: p.id, name: e.target.value })} onKeyDown={e => e.key === "Escape" && setRenaming(null)} />
                    <div className="flex gap-2"><button type="submit" className={btn}>Save</button><button type="button" className={btn} onClick={() => setRenaming(null)}>Cancel</button></div>
                  </form>
                ) : confirm === p.id ? (
                  <div className="flex flex-col gap-2">
                    <p>Delete “{p.name}”? Its videos stay saved.</p>
                    <div className="flex gap-2"><button type="button" className={btn} onClick={() => remove(p.id)}>Confirm delete</button><button type="button" className={btn} onClick={() => setConfirm(null)}>Keep</button></div>
                  </div>
                ) : (
                  <>
                    <button type="button" aria-label={`Open ${p.name}`} onClick={() => onOpenProject(p)} className="flex flex-1 flex-col items-start gap-1 rounded-lg text-left">
                      <span className="text-3xl" aria-hidden="true">{p.emoji}</span>
                      <span className="mt-2 text-xl font-semibold tracking-tight">{p.name}</span>
                      <span className="text-sm text-muted">{plural(p.sources.length, "source")} · {plural(nv, "video")}</span>
                      <span className="text-xs text-subtle">Updated {new Date(updated(p)).toLocaleDateString()}</span>
                    </button>
                    <button type="button" aria-label={`Options for ${p.name}`} aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)} className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-lg hover:bg-fg/10">⋯</button>
                    {menu === p.id && (
                      <div className="absolute right-2 top-12 z-10 flex flex-col rounded-lg border border-line bg-surface p-1">
                        <button type="button" className={btn + " border-0"} onClick={() => { setMenu(null); setRenaming({ id: p.id, name: p.name }); }}>Rename</button>
                        <button type="button" className={btn + " border-0"} onClick={() => { setMenu(null); setConfirm(p.id); }}>Delete</button>
                      </div>
                    )}
                  </>
                )}
              </Glass>
            );
          })}

          {draft ? (
            <Glass className="rounded-2xl p-4">
              <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); create(); }}>
                <input aria-label="Project name" autoFocus className={input} placeholder="e.g. CS 251" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} onKeyDown={e => e.key === "Escape" && setDraft(null)} />
                <EmojiPicker value={draft.emoji} onChange={emoji => setDraft({ ...draft, emoji })} />
                <div className="flex gap-2"><button type="submit" className={btn} disabled={!draft.name.trim()}>Create</button><button type="button" className={btn} onClick={() => setDraft(null)}>Cancel</button></div>
              </form>
            </Glass>
          ) : (
            <button type="button" aria-label="New project" onClick={() => setDraft({ name: "", emoji: EMOJIS[0] })} className="flex min-h-36 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line text-muted hover:bg-fg/5 hover:text-fg">
              <span className="text-3xl" aria-hidden="true">+</span>
              <span>New project</span>
            </button>
          )}
        </section>

        {unsorted.length > 0 && (
          <section aria-label="Unsorted videos" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Unsorted videos</h2>
            <ul className="flex flex-wrap gap-2">
              {unsorted.map(v => (
                <li key={v.id}>
                  <button type="button" onClick={() => onOpenVideo!(v)} className="flex min-h-11 flex-col items-start rounded-lg border border-line px-3 py-2 text-left hover:bg-fg/10">
                    <span>{v.title}</span>
                    <span className="text-xs text-subtle">{clock(videoDuration(v))} · {new Date(v.createdAt).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {onDemo && <button type="button" onClick={onDemo} className="self-start text-sm text-subtle underline hover:text-fg min-h-11">Heapify demo</button>}
      </div>
    </main>
  );
}
export default memo(Home);
