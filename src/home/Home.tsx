import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { File02Icon, PlayIcon, Upload04Icon } from "@hugeicons/core-free-icons";
import AnimatedList from "@/components/AnimatedList";
import Icon from "@/components/Icon";
import ShinyText from "@/components/ShinyText";
import { ingestPdf, listSections, type IR, type SectionRef } from "./api";
import { tauriVideoStore, videoDuration, type VideoBundle, type VideoStore } from "../storage/videos";

export type StartMeta = { pdfPath: string; title: string };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const KEY = "tangent.recent";
type Recent = { path: string; sectionId: string; title: string };
type State =
  | { s: "idle" }
  | { s: "loading"; name: string }
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

export default function Home({ onStart = () => {}, onDemo = () => {}, onOpenVideo = () => {}, store = tauriVideoStore }: { onStart?: (sectionId: string, ir: IR, meta: StartMeta) => void; onDemo?: () => void; onOpenVideo?: (b: VideoBundle) => void; store?: VideoStore }) {
  const [videos, setVideos] = useState<VideoBundle[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ saved: VideoBundle; title: string; regenerate: () => void } | null>(null);
  useEffect(() => { let live = true; store.list().then(v => live && setVideos(v), () => {}); return () => { live = false; }; }, [store]);
  const remove = async (id: string) => {
    setConfirm(null);
    try { await store.remove(id); setVideos(v => v.filter(x => x.id !== id)); } catch (e) { setState({ s: "error", msg: `Couldn't delete: ${e}` }); }
  };
  const savedFor = (path: string, sectionId: string) => videos.find(v => v.source.pdfPath === path && v.source.sectionId === sectionId);
  const [state, setState] = useState<State>({ s: "idle" });
  const [recent, setRecent] = useState(readRecent);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (path: string, name = path) => {
    setState({ s: "loading", name });
    try {
      const ir = await ingestPdf(path);
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
  const start = (path: string, ir: IR, sectionId: string, title: string) => {
    const next = [{ path, sectionId, title }, ...recent.filter((r) => !(r.path === path && r.sectionId === sectionId))].slice(0, 8);
    localStorage.setItem(KEY, JSON.stringify(next));
    setRecent(next);
    const go = () => onStart(sectionId, ir, { pdfPath: path, title });
    const saved = savedFor(path, sectionId);
    if (saved) setChoice({ saved, title, regenerate: go }); else go();
  };
  const reopen = async (r: Recent) => {
    const regenerate = async () => {
      setChoice(null);
      setState({ s: "loading", name: r.title });
      try { onStart(r.sectionId, await ingestPdf(r.path), { pdfPath: r.path, title: r.title }); }
      catch (e) { setState({ s: "error", msg: String(e) }); }
    };
    const saved = savedFor(r.path, r.sectionId);
    if (saved) return setChoice({ saved, title: r.title, regenerate });
    setState({ s: "loading", name: r.title });
    try {
      const ir = await ingestPdf(r.path);
      onStart(r.sectionId, ir, { pdfPath: r.path, title: r.title });
    } catch (e) {
      setState({ s: "error", msg: String(e) });
    }
  };

  return (
    <main className="h-screen overflow-y-auto bg-bg px-8 py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <header>
          <h1 className="text-5xl font-semibold tracking-tight">Tangent</h1>
          <p className="mt-2 text-base text-muted">Drop in a chapter. Pick a section. Watch, and interrupt whenever you like.</p>
        </header>

        {state.s === "pick" ? (
          <section aria-label="Choose a section" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pick a section</h2>
              <button type="button" className={btn} onClick={() => setState({ s: "idle" })}>Choose another PDF</button>
            </div>
            <AnimatedList
              items={state.sections.map((x) => ({ id: x.id, title: x.title, meta: pages(x.anchors) }))}
              ariaLabel="Sections"
              onItemSelect={(_, i) => { const x = state.sections[i]; start(state.path, state.ir, x.id, x.title); }}
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
                    <span style={{ paddingLeft: Math.max(0, x.level - 1) * 20 }} className={`flex-1 ${x.level <= 1 ? "text-fg" : "text-muted"}`}>{x.title}</span>
                    <span className="text-xs text-subtle tabular-nums">{pages(x.anchors)}</span>
                  </>
                );
              }}
            />
          </section>
        ) : (
          <div
            data-testid="dropzone"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
            className={`flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center ${over ? "border-fg bg-fg/5" : "border-line"}`}
          >
            {state.s === "loading" ? (
              <p role="status" className="text-base text-muted">
                <ShinyText text={`Reading ${state.name}...`} color={css("--fg-subtle")} shineColor={css("--fg")} />
              </p>
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
          </div>
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
          {recent.length === 0 ? (
            <p className="text-sm text-subtle">No recent videos yet.</p>
          ) : (
            <ul aria-label="Recent videos" className="flex flex-col gap-1">
              {recent.map((r) => (
                <li key={r.path + r.sectionId}>
                  <button type="button" onClick={() => reopen(r)} className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-fg/10">
                    <span className="text-fg">{r.title}</span>
                    <span className="text-xs text-subtle">{r.path.split("/").pop()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onDemo} className={`${btn} self-start`}>
            <Icon icon={PlayIcon} size={20} className="fill-current" />
            Heapify demo
          </button>
        </section>
      </div>
    </main>
  );
}
