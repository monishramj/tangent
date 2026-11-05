import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft01Icon, ArrowLeft02Icon, ArrowRight01Icon, BubbleChatIcon, FullScreenIcon, GoBackward10SecIcon, GoForward10SecIcon, PauseIcon, PlayIcon, TextAlignLeftIcon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import GlassSurface from "@/components/GlassSurface";
import Stage from "@/Stage";
import type { LLMProvider } from "@/llm/provider";
import { providers } from "@/llm/registry";
import type { PipelineEvent, Progress } from "@/pipeline/streamVideo";
import type { Checkpoint } from "@/gen/checkpoints";
import { tauriJsonStore, threads as threadStore, newId, type JsonStore, type Thread } from "@/storage/projects";
import type { Annotation } from "@/tutor/annotations";
import { ask, buildTutorContext, resumeTime } from "@/tutor/tutor";
import { narrationLines, transcriptUntil } from "@/tutor/narration";
import { devlog } from "@/devlog";
import { SceneQueue } from "./queue";
import SidePanel, { type Tab } from "./SidePanel";
import Loading from "./Loading";

type StreamedScene = Extract<PipelineEvent, { type: "scene" }>;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const iconBtn = "grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent";
const pillBtn = "flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm text-muted transition-colors hover:bg-fg/10 hover:text-fg aria-pressed:bg-fg/15 aria-pressed:text-fg";
// Absolute filesystem paths (sidecar WAVs, saved bundles) go through the asset protocol; URLs pass through.
const audioSrc = (p: string) => p.startsWith("/") && "__TAURI_INTERNALS__" in window ? convertFileSrc(p) : p;

export type PlayerProps = {
  stream: AsyncIterable<PipelineEvent>;
  title: string;
  kicker?: string;
  videoId?: string; // threads + checkpoint results persist under this id
  section?: string; // source markdown for the tutor
  provider?: LLMProvider;
  store?: JsonStore;
  progress?: Progress;
  onRetry?: () => void;
  onBack?: () => void;
  onPinNote?: (text: string, t: number) => void;
  autoPlay?: boolean;
  initialError?: string;
};

export default function PlayerScreen({ stream, title, kicker = "Tangent", videoId, section = "", provider = providers.claude, store = tauriJsonStore, progress, onRetry, onBack, onPinNote, autoPlay = false, initialError }: PlayerProps) {
  const [scenes, setScenes] = useState<StreamedScene[]>([]);
  const [current, setCurrent] = useState<StreamedScene | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [done, setDone] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [activeCp, setActiveCp] = useState<Checkpoint | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const localTime = useRef(0);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const annotateRef = useRef<((a: Annotation[]) => void) | null>(null);
  const shownCps = useRef(new Set<string>());
  const sceneIds = useRef<string[]>([]);
  const cpsRef = useRef<Checkpoint[]>([]);
  const scrubResume = useRef(false);
  const [hover, setHover] = useState<{ x: number; t: number; label: string } | null>(null);

  const showCheckpointAfter = useCallback((sceneIndex: number) => {
    const cp = cpsRef.current.find(c => c.afterScene === sceneIndex && !shownCps.current.has(c.id));
    if (!cp) return false;
    shownCps.current.add(cp.id);
    queue.pause();
    setActiveCp(cp); setTab("check");
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [queue] = useState(() => new SceneQueue<StreamedScene>({
    createAudio: path => new Audio(audioSrc(path)),
    render: (data, t) => {
      localTime.current = t;
      if (sceneIds.current[sceneIds.current.length - 1] !== data.sceneId && !sceneIds.current.includes(data.sceneId)) sceneIds.current.push(data.sceneId);
      setCurrent(prev => {
        if (prev?.sceneId === data.sceneId) return prev;
        const prevIndex = prev ? sceneIds.current.indexOf(prev.sceneId) : -1;
        if (prev && prevIndex >= 0) queueMicrotask(() => showCheckpointAfter(prevIndex));
        devlog(`render scene ${data.sceneId}`);
        return data;
      });
      drawRef.current?.(t);
    },
    onChange: () => {
      setTime(p => Math.abs(p - queue.time) < 0.1 ? p : queue.time);
      setDuration(queue.duration);
      setPlaying(queue.playing);
      setBuffering(queue.buffering);
    },
    onError: e => { devlog(`queue error ${String(e)}`); setError(String(e)); },
  }));

  // Consume the stream: scenes go to the queue, checkpoints to state.
  useEffect(() => {
    let live = true;
    let it: AsyncIterator<PipelineEvent> | undefined;
    let played = false;
    void Promise.resolve().then(async () => { // deferred so StrictMode's discarded effect can't abort the live stream
      if (!live) return;
      it = stream[Symbol.asyncIterator]();
      if (autoPlay) queue.play();
      try {
        while (live) {
          const next = await it.next();
          if (!live) return;
          if (next.done) break;
          const ev = next.value;
          if (ev.type === "scene") { queue.enqueue(ev); setScenes(s => [...s, ev]); played = true; }
          else if (ev.type === "checkpoints") { cpsRef.current = ev.items; setCheckpoints(ev.items); }
          else if (!played) setError(`Scene ${ev.sceneId}: ${ev.error.message}`); // later failures are skipped, not overlaid
        }
      } catch (e) { if (live) setError(String(e)); }
      finally { if (live) { queue.finish(); setDone(true); } }
    });
    return () => { live = false; queue.dispose(); void it?.return?.().catch(() => {}); };
  }, [stream, queue, autoPlay]);

  // End of the whole video: the last checkpoints.
  useEffect(() => {
    if (done && !playing && !buffering && duration > 0 && time >= duration - 0.15) showCheckpointAfter(sceneIds.current.length - 1);
  }, [done, playing, buffering, time, duration, showCheckpointAfter]);

  useEffect(() => { if (videoId) threadStore(store).list(videoId).then(setThreads, () => {}); }, [videoId, store]);
  const saveThreads = (next: Thread[]) => { setThreads(next); if (videoId) void threadStore(store).save(videoId, next).catch(() => {}); };

  const lines = useMemo(() => narrationLines(scenes), [scenes]);
  const seek = (s: number) => { const t = Math.min(duration, Math.max(0, s)); queue.seek(t); setTime(t); };
  const pause = () => { queue.pause(); setPlaying(false); };
  const play = () => {
    annotateRef.current?.([]);
    if (duration > 0 && queue.time >= duration - 0.05 && !buffering) queue.seek(0);
    queue.play(); setPlaying(true);
  };
  const resume = (t: number) => { annotateRef.current?.([]); queue.seek(resumeTime(queue.beatStarts, t)); setTime(queue.time); queue.play(); setPlaying(true); };

  const send = async (question: string, threadId: string | null) => {
    pause();
    const t = threadId ? threads.find(x => x.id === threadId)?.t ?? queue.time : queue.time;
    const now = Date.now();
    let thread = threads.find(x => x.id === threadId);
    const base = thread ?? { id: newId("t"), videoId: videoId ?? "", t, sceneId: queue.current?.sceneId, title: question, messages: [] };
    thread = { ...base, messages: [...base.messages, { role: "user", text: question, at: now }] };
    let next = [thread, ...threads.filter(x => x.id !== thread!.id)];
    saveThreads(next); setActiveThread(thread.id); setThinking(true);
    try {
      const live = queue.current?.scene;
      const context = buildTutorContext({ objects: live?.objects.map(o => ({ id: o.id, type: o.type })) ?? [], transcript: transcriptUntil(lines, t), section, priorQuestions: threads.map(x => x.title) });
      const r = await ask({ question, context, provider, history: base.messages });
      annotateRef.current?.(r.annotations);
      thread = { ...thread, messages: [...thread.messages, { role: "tutor", text: r.answer, at: Date.now() }] };
    } catch {
      thread = { ...thread, messages: [...thread.messages, { role: "tutor", text: "I couldn't answer that just now. Try asking again.", at: Date.now() }] };
    }
    next = [thread, ...next.filter(x => x.id !== thread!.id)];
    saveThreads(next); setThinking(false);
  };

  // Hover preview on the seek bar: time under the cursor, its scene, or the question marker it is near. Never seeks.
  const hoverMove = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.pointerType === "touch" || !duration || !r.width) return;
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left)), t = x / r.width * duration;
    const near = threads.find(th => Math.abs(th.t / duration * r.width - x) < 8);
    const scene = queue.sceneBeats.reduce((k, s, i) => s.offset <= t ? i : k, 0) + 1;
    setHover({ x, t, label: near ? near.title : `Scene ${scene}` });
  };
  const openTab = (t: Tab) => { if (t === "ask") pause(); setTab(p => p === t ? null : t); };
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  const waiting = !current && !error;
  const beats = queue.sceneBeats;
  const sceneIdx = Math.max(0, beats.reduce((k, b, i) => b.offset <= time ? i : k, 0));
  const p = duration ? time / duration * 100 : 0;
  const toggle = playing ? pause : play;
  const canPlay = !!current && !error;
  const keys = useRef({ toggle, seek, time });
  keys.current = { toggle, seek, time };

  // Space / K play-pause, arrows ±10 s. Typing in the panel never triggers them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const k = keys.current;
      if ((e.key === " " && el.tagName !== "BUTTON") || e.key === "k") { e.preventDefault(); k.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); k.seek(k.time - 10); }
      else if (e.key === "ArrowRight") { e.preventDefault(); k.seek(k.time + 10); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="relative flex h-screen bg-bg">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-3 py-2 sm:px-4">
          <button type="button" aria-label="Back" onClick={onBack} className={iconBtn}><Icon icon={ArrowLeft02Icon} /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-subtle">{kicker}</p>
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
          </div>
          <button type="button" aria-label="Transcript" aria-pressed={tab === "transcript"} onClick={() => openTab("transcript")} className={pillBtn}>
            <Icon icon={TextAlignLeftIcon} size={18} /><span className="hidden md:inline">Transcript</span></button>
          <button type="button" aria-label="Ask" aria-pressed={tab === "ask"} onClick={() => openTab("ask")} className={pillBtn}>
            <Icon icon={BubbleChatIcon} size={18} /><span className="hidden md:inline">Ask a question</span></button>
          <button type="button" aria-label="Toggle fullscreen" onClick={fullscreen} className={iconBtn}><Icon icon={FullScreenIcon} /></button>
        </header>

        {/* The video is a 16:9 box, letterboxed in whatever space is left. Controls live outside it. */}
        <div className="grid min-h-0 flex-1 place-items-center px-3 sm:px-4 [container-type:size]">
          <div data-testid="video" onClick={canPlay ? toggle : undefined}
            className={`relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden rounded-xl border border-line bg-bg ${canPlay ? "cursor-pointer" : ""}`}>
            {current && <Stage scene={current.scene} timeline={current.timeline} drawRef={drawRef} annotateRef={annotateRef} timeRef={localTime} />}
            {waiting && <Loading progress={progress} />}
            {buffering && current && <Loading progress={progress} compact />}
            {error && <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div><p role="alert" className="text-muted">{error}</p>
                {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line px-4 py-2 hover:bg-fg/10">Try again</button>}</div>
            </div>}
            {canPlay && !playing && !buffering && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <GlassSurface width={72} height={72} borderRadius={36}>
                <button type="button" aria-label="Play video" onClick={e => { e.stopPropagation(); play(); }}
                  className="grid size-full place-items-center rounded-full text-fg transition-transform duration-150 ease-out hover:scale-105 active:scale-95">
                  <Icon icon={PlayIcon} size={30} className="translate-x-0.5 fill-current" /></button>
              </GlassSurface>
            </div>}
          </div>
        </div>

        <footer className="px-3 pt-1 pb-3 sm:px-4">
          <div className="group relative" onPointerMove={hoverMove} onPointerLeave={() => setHover(null)}>
            {hover && <span role="tooltip" data-testid="scrub-preview" className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-fg"
              style={{ transform: `translateX(${hover.x}px) translateX(-50%)` }}>{clock(hover.t)} · {hover.label}</span>}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-fg/20 transition-transform duration-150 ease-out group-hover:scale-y-150">
              <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${p / 100})` }} />
            </div>
            {/* Scene boundaries as gaps in the bar. */}
            {duration > 0 && beats.slice(1).map(b => <span key={b.sceneId} aria-hidden className="pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-bg" style={{ left: `${b.offset / duration * 100}%` }} />)}
            <span aria-hidden className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100" style={{ left: `${p}%` }} />
            <input type="range" aria-label="Seek" aria-valuetext={`${clock(time)} of ${clock(duration)}`} min={0} max={duration || 0} step="any" value={time}
              // Drag = pause once, seek silently, play once on release. play/pause/seek per input event deadlocks WebKit's AVFoundation media stack.
              onPointerDown={() => { scrubResume.current = queue.playing; queue.pause(); }}
              onPointerUp={() => { if (scrubResume.current) { scrubResume.current = false; queue.play(); } }}
              onChange={e => seek(Number(e.target.value))} className="scrubber relative block h-6 w-full" />
            {duration > 0 && threads.map(th => <button key={th.id} type="button" aria-label={`Question at ${clock(th.t)}: ${th.title}`} title={th.title}
              onClick={() => { setActiveThread(th.id); setTab("ask"); seek(th.t); }}
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-fg" style={{ left: `${Math.min(100, th.t / duration * 100)}%` }} />)}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted tabular-nums">
            <button type="button" aria-label={playing ? "Pause" : "Play"} disabled={!canPlay} onClick={toggle} className={iconBtn}>
              <Icon icon={playing ? PauseIcon : PlayIcon} className="fill-current" /></button>
            <button type="button" aria-label="Back 10 seconds" disabled={!canPlay} onClick={() => seek(time - 10)} className={iconBtn}><Icon icon={GoBackward10SecIcon} /></button>
            <button type="button" aria-label="Forward 10 seconds" disabled={!canPlay} onClick={() => seek(time + 10)} className={iconBtn}><Icon icon={GoForward10SecIcon} /></button>
            <span className="ml-1">{clock(time)} <span className="text-subtle">/ {clock(duration)}</span></span>
            {beats.length > 1 && <div className="ml-auto flex items-center gap-1">
              <button type="button" aria-label="Previous scene" disabled={sceneIdx === 0} onClick={() => seek(beats[sceneIdx - 1].offset)} className={iconBtn}><Icon icon={ArrowLeft01Icon} /></button>
              <span className="whitespace-nowrap">Scene {sceneIdx + 1} <span className="text-subtle">of {beats.length}</span></span>
              <button type="button" aria-label="Next scene" disabled={sceneIdx >= beats.length - 1} onClick={() => seek(beats[sceneIdx + 1].offset)} className={iconBtn}><Icon icon={ArrowRight01Icon} /></button>
            </div>}
          </div>
        </footer>
      </div>

      {tab && <SidePanel tab={tab} onTab={setTab} onClose={() => setTab(null)} time={time} lines={lines} threads={threads} activeThread={activeThread}
        onSelectThread={setActiveThread} onSend={send} thinking={thinking} onSeek={seek} onResume={resume} onPinNote={onPinNote}
        checkpoint={activeCp} checkpoints={checkpoints} provider={provider} store={store} videoId={videoId}
        onCheckpointDone={() => { setActiveCp(null); setTab(null); play(); }}
        onAskAbout={q => { setActiveCp(null); setTab("ask"); setActiveThread(null); void send(q, null); }} />}
    </main>
  );
}
