import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { File02Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import AnimatedList from "@/components/AnimatedList";
import Icon from "@/components/Icon";
import ShinyText from "@/components/ShinyText";
import SpotlightCard from "@/components/SpotlightCard";
import { listSections, multiTitle, topSelected, type IR, type SectionRef } from "./api";
import GiphyKey from "./GiphyKey";
import { loadIr, type LoadProgress } from "../library";
import { tauriJsonStore, type JsonStore } from "../storage/store";
import { tauriVideoStore, videoDuration, type VideoBundle, type VideoStore } from "../storage/videos";

import { DETAIL_LEVELS, isDetailLevel, type DetailLevel } from "../gen/script";

export type StartMeta = { pdfPath: string; title: string; detail: DetailLevel };
const DETAIL_KEY = "tangent.detail";
const DETAIL_LABEL: Record<DetailLevel, string> = { overview: "Overview", standard: "Standard", detailed: "Detailed", complete: "Complete" };
const DETAIL_HINT: Record<DetailLevel, string> = {
  overview: "Key ideas only. Shortest video.",
  standard: "Key ideas, main definitions and examples.",
  detailed: "Every idea, example and important caveat.",
  complete: "Covers everything in the section. Longest video.",
};
const readDetail = (): DetailLevel => {
  try { const v = localStorage.getItem(DETAIL_KEY); return isDetailLevel(v) ? v : "standard"; } catch { return "standard"; }
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const KEY = "tangent.recent";
type Recent = { path: string; sectionId: string; title: string };
type State =
  | { s: "idle" }
  | { s: "loading"; name: string; progress?: LoadProgress }
  | { s: "error"; msg: string }
  | { s: "pick"; path: string; ir: IR; sections: SectionRef[] };

const readRecent = (): Recent[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};
const pages = (a: { page: number }[]) => {
  if (!a.length) return "";
  const [lo, hi] = [Math.min(...a.map((x) => x.page)), Math.max(...a.map((x) => x.page))];
  return lo === hi ? `p. ${lo}` : `pp. ${lo}-${hi}`;
};
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const btn = "flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-fg hover:bg-fg/10";

// Tauri webviews give no File.path, so there the dialog plugin / drag-drop event supply absolute paths;
// the file input and DOM drop remain the browser/jsdom fallback.
const isTauri = () => "__TAURI_INTERNALS__" in window;
const pathOf = (f: File) => (f as File & { path?: string }).path ?? f.name;
const notPdf = "That isn't a PDF. Choose a .pdf file.";

export default function Home({ onStart = () => {}, onOpenVideo = () => {}, store = tauriVideoStore, jsonStore = tauriJsonStore }: {
  onStart?: (sectionIds: string[], ir: IR, meta: StartMeta) => void; onOpenVideo?: (b: VideoBundle) => void; store?: VideoStore; jsonStore?: JsonStore;
}) {
  const [videos, setVideos] = useState<VideoBundle[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ saved: VideoBundle; title: string; regenerate: () => void } | null>(null);
  const [listed, setListed] = useState(false); // recents are shown (and pruned) only once the saved videos are known
  useEffect(() => { let live = true; store.list().then(v => { if (live) { setVideos(v); setListed(true); } }, () => {}); return () => { live = false; }; }, [store]);
  const remove = async (id: string) => {
    setConfirm(null);
    try { await store.remove(id); setVideos(v => v.filter(x => x.id !== id)); } catch (e) { setState({ s: "error", msg: `Couldn't delete: ${e}` }); }
  };
  const savedFor = (path: string, sectionId: string) => videos.find(v => v.source.pdfPath === path && v.source.sectionId === sectionId);
  const [state, setState] = useState<State>({ s: "idle" });
  const [recent, setRecent] = useState(readRecent);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [detail, setDetailState] = useState<DetailLevel>(readDetail);
  const setDetail = (d: DetailLevel) => { setDetailState(d); try { localStorage.setItem(DETAIL_KEY, d); } catch { /* per-viewer convenience only */ } };
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Parsed once per file: the IR is cached in the app store and figures land in app data (see library.ts).
  const ingest = (path: string, name: string) => {
    setState({ s: "loading", name });
    return loadIr(path, progress => setState(s => s.s === "loading" ? { ...s, progress } : s), jsonStore);
  };
  const load = async (path: string, name = path) => {
    try {
      const ir = await ingest(path, name);
      setState({ s: "pick", path, ir, sections: await listSections(ir) });
    } catch (e) {
      setState({ s: "error", msg: String(e) });
    }
  };
  const take = (f?: File) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) return setState({ s: "error", msg: notPdf });
    load(pathOf(f), f.name);
  };
  const takePath = (p: string) => load(p, p.split(/[\\/]/).pop());
  const choose = async () => {
    if (!isTauri()) return input.current?.click();
    const p = await open({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof p === "string") takePath(p);
  };
  const dropped = useRef(takePath);
  dropped.current = takePath;
  useEffect(() => {
    if (!isTauri()) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") return setOver(true);
      setOver(false);
      if (p.type !== "drop" || !p.paths.length) return;
      const pdf = p.paths.find((x) => /\.pdf$/i.test(x));
      pdf ? dropped.current(pdf) : setState({ s: "error", msg: notPdf });
    });
    return () => { un.then((f) => f()); };
  }, []);
  const start = (path: string, ir: IR, ids: string[], title: string) => {
    const sectionId = ids.join("+");
    setPicked(new Set());
    const next = [{ path, sectionId, title }, ...recent.filter((r) => !(r.path === path && r.sectionId === sectionId))].slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(next));
    setRecent(next);
    const go = () => onStart(ids, ir, { pdfPath: path, title, detail });
    const saved = savedFor(path, sectionId);
    if (saved) setChoice({ saved, title, regenerate: go }); else go();
  };
  // A recent entry is only a shortcut to a saved video: entries without one are dropped, and clicking never regenerates.
  const shownRecent = listed ? recent.filter(r => savedFor(r.path, r.sectionId)) : [];
  useEffect(() => {
    if (!listed || shownRecent.length === recent.length) return;
    setRecent(shownRecent);
    try { localStorage.setItem(KEY, JSON.stringify(shownRecent)); } catch { /* per-viewer convenience only */ }
  }, [listed, videos]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="h-screen overflow-y-auto bg-bg px-8 py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-5xl font-semibold tracking-tight">Tangent</h1>
            <p className="mt-2 text-base text-muted">Drop in a chapter. Pick a section. Watch, and interrupt whenever you like.</p>
          </div>
          <GiphyKey />
        </header>

        {state.s === "pick" ? (
          <section aria-label="Choose a section" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pick a section</h2>
              <button type="button" className={btn} onClick={() => setState({ s: "idle" })}>Choose another PDF</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label="Detail level" className="inline-flex rounded-lg border border-line p-0.5">
                {DETAIL_LEVELS.map(d => (
                  <button key={d} type="button" role="radio" aria-checked={detail === d} onClick={() => setDetail(d)}
                    className={`h-9 rounded-md px-3 text-sm transition-colors ${detail === d ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}>
                    {DETAIL_LABEL[d]}
                  </button>
                ))}
              </div>
              <span className="text-xs text-subtle">{DETAIL_HINT[detail]}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {(() => {
                const all = picked.size === state.sections.length;
                return <button type="button" className={btn} onClick={() => setPicked(all ? new Set() : new Set(state.sections.map((x) => x.id)))}>{all ? "Clear selection" : "Select all"}</button>;
              })()}
              {picked.size > 0 && (() => {
                const ids = topSelected(state.sections, picked);
                return (
                  <button type="button" className={`${btn} bg-fg text-bg hover:bg-fg/85`}
                    onClick={() => start(state.path, state.ir, ids, multiTitle(ids.map((id) => state.sections.find((x) => x.id === id)!.title)))}>
                    Make video ({ids.length} {ids.length === 1 ? "section" : "sections"})
                  </button>
                );
              })()}
            </div>
            <AnimatedList
              items={state.sections.map((x) => ({ id: x.id, title: x.title, meta: pages(x.anchors) }))}
              ariaLabel="Sections"
              onItemSelect={(_, i) => { const x = state.sections[i]; start(state.path, state.ir, [x.id], x.title); }}
              frame={false}
              showGradients={false}
              width="100%"
              maxHeight="none"
              gap={4}
              radius={8}
              itemClassName="min-h-11"
              style={{ "--al-tile": "transparent", "--al-tile-edge": "transparent", "--al-tile-highlight": "transparent", "--al-tile-shadow": "none", "--al-ink": "var(--fg)", "--al-muted": "var(--fg-muted)", "--al-ring": "rgba(255,255,255,0.5)", "--al-ring-fill": "rgba(255,255,255,0.04)", "--al-hover": "none", "--al-active": "none" } as React.CSSProperties}
              renderItem={(_, i) => {
                const x = state.sections[i];
                return (
                  <>
                    <span className="relative mr-3 grid size-6 shrink-0 place-items-center">
                      <input type="checkbox" aria-label={`Select ${x.title}`} checked={picked.has(x.id)}
                        className="peer size-6 cursor-pointer appearance-none rounded-md border border-line bg-transparent transition-colors hover:border-fg/60 checked:border-fg checked:bg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg/60"
                        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                        onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(x.id) : n.delete(x.id); return n; })} />
                      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute size-4 text-bg opacity-0 transition-opacity peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </span>
                    <span style={{ paddingLeft: Math.max(0, x.level - 1) * 20 }} className={`flex-1 ${x.level <= 1 ? "text-fg" : "text-muted"}`}>{x.title}</span>
                    <span className="text-xs text-subtle tabular-nums">{pages(x.anchors)}</span>
                  </>
                );
              }}
            />
          </section>
        ) : (
          // React Bits SpotlightCard: a soft white light follows the pointer (and keyboard focus) across the drop zone.
          <SpotlightCard
            data-testid="dropzone"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
            spotlightColor="#ffffff" intensity={0.08} spotlightSize={320} borderGlow={0.5}
            style={{ "--spotlight-card-surface": over ? "rgba(255,255,255,0.05)" : "transparent", "--spotlight-card-border": over ? "rgba(255,255,255,0.7)" : "var(--line)", "--spotlight-card-shadow": "none" } as React.CSSProperties}
            className="flex flex-col items-center gap-4 !rounded-2xl !px-6 !py-14 text-center transition-[background-color] duration-200"
          >
            {state.s === "loading" ? (
              <div role="status" className="flex w-full max-w-sm flex-col items-center gap-3 text-base text-muted">
                <ShinyText text={`Reading ${state.name}...`} color={css("--fg-subtle")} shineColor={css("--fg")} />
                {state.progress && <>
                  <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-fg/10">
                    <div className="h-full origin-left rounded-full bg-fg transition-transform duration-500 ease-out" style={{ transform: `scaleX(${state.progress.fraction})` }} />
                  </div>
                  <span className="text-xs text-subtle tabular-nums">{state.progress.label}</span>
                </>}
              </div>
            ) : state.s === "error" ? (
              <>
                <p role="alert" className="text-base text-fg">Couldn't read that PDF: {state.msg}</p>
                <button type="button" className={btn} onClick={() => setState({ s: "idle" })}>Try again</button>
              </>
            ) : (
              <>
                <Icon icon={Upload04Icon} size={32} className="text-subtle" />
                <p className="text-base text-muted">Drop a PDF here</p>
                <button type="button" className={btn} onClick={choose}>
                  <Icon icon={File02Icon} size={20} />
                  Choose PDF
                </button>
              </>
            )}
            <input ref={input} type="file" accept="application/pdf,.pdf" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
          </SpotlightCard>
        )}

        {choice && (
          <section role="dialog" aria-label="Saved video found" className="flex flex-col gap-3 rounded-2xl border border-line p-4">
            <p className="text-base text-fg">You already have a video for “{choice.title}”.</p>
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => { onOpenVideo(choice.saved); setChoice(null); }}>Open saved</button>
              <button type="button" className={btn} onClick={() => { const r = choice.regenerate; setChoice(null); r(); }}>Regenerate</button>
              <button type="button" className={btn} onClick={() => setChoice(null)}>Cancel</button>
            </div>
          </section>
        )}

        <section aria-labelledby="videos" className="flex flex-col gap-3">
          <h2 id="videos" className="text-lg font-semibold">Your videos</h2>
          {videos.length === 0 ? (
            <p className="text-sm text-subtle">No saved videos yet.</p>
          ) : (
            <ul aria-label="Your videos" className="flex flex-col gap-1">
              {videos.map((v) => (
                <li key={v.id} className="flex items-center gap-2">
                  <button type="button" onClick={() => onOpenVideo(v)} className="flex min-h-11 flex-1 flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-fg/10">
                    <span className="text-fg">{v.title}</span>
                    <span className="text-xs text-subtle">
                      {clock(videoDuration(v))} · {new Date(v.createdAt).toLocaleDateString()} · {v.complete ? "Complete" : "Partial"}
                    </span>
                  </button>
                  {confirm === v.id ? (
                    <>
                      <button type="button" className={btn} onClick={() => remove(v.id)}>Confirm delete</button>
                      <button type="button" className={btn} onClick={() => setConfirm(null)}>Keep</button>
                    </>
                  ) : (
                    <button type="button" aria-label={`Delete ${v.title}`} className={btn} onClick={() => setConfirm(v.id)}>Delete</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <h2 id="recent" className="text-lg font-semibold">Recent videos</h2>
          {shownRecent.length === 0 ? (
            <p className="text-sm text-subtle">No recent videos yet.</p>
          ) : (
            <ul aria-label="Recent videos" className="flex flex-col gap-1">
              {shownRecent.map((r) => (
                <li key={r.path + r.sectionId}>
                  <button type="button" onClick={() => onOpenVideo(savedFor(r.path, r.sectionId)!)} className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-fg/10">
                    <span className="text-fg">{r.title}</span>
                    <span className="text-xs text-subtle">{r.path.split("/").pop()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
