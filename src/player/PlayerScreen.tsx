import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft02Icon, BubbleChatIcon, FullScreenIcon, GoBackward10SecIcon, GoForward10SecIcon, LayersLogoIcon, PauseIcon, PlayIcon, TextAlignLeftIcon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
import type { IconSvgElement } from "@hugeicons/react";
import AnimatedList from "@/components/AnimatedList";
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
const IDLE_MS = 3000;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Frosted round control (React Bits GlassSurface). Module-level so the overlay never remounts on time updates.
function GlassBtn({ label, icon, size = 40, iconSize = 22, pressed, fill, onClick, ring }: { label: string; icon: IconSvgElement; size?: number; iconSize?: number; pressed?: boolean; fill?: boolean; ring?: boolean; onClick?: () => void }) {
  return (
    <GlassSurface width={size} height={size} borderRadius={size / 2} className="shrink-0">
      <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}
        className={`grid size-full place-items-center rounded-full text-fg transition-[transform,background-color] duration-150 ease-out hover:bg-fg/15 active:scale-95 aria-pressed:bg-fg/25 ${ring ? "border-2 border-white/80" : ""}`}>
        <Icon icon={icon} size={iconSize} className={fill ? "fill-current" : ""} />
      </button>
    </GlassSurface>
  );
}
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
  const [idle, setIdle] = useState(false);
  const [showScenes, setShowScenes] = useState(false);
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

  // Controls fade while playing; any activity brings them back.
  useEffect(() => {
    setIdle(false);
    if (!playing || tab) return;
    let h = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => { setIdle(false); clearTimeout(h); h = setTimeout(() => setIdle(true), IDLE_MS); };
    const evs = ["pointermove", "pointerdown", "keydown"] as const;
    evs.forEach(e => window.addEventListener(e, wake));
    return () => { clearTimeout(h); evs.forEach(e => window.removeEventListener(e, wake)); };
  }, [playing, tab]);

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
  const hide = idle ? "pointer-events-none opacity-0" : "opacity-100";
  const fade = "transition-opacity duration-200 ease-out";
  const p = duration ? time / duration * 100 : 0;
  const toggle = playing ? pause : play;

  return (
    <main className={`flex h-screen bg-bg ${idle ? "cursor-none" : ""}`}>
      {/* The video is always a 16:9 box, letterboxed in whatever space the side panel leaves. */}
      <div className="grid min-h-0 min-w-0 flex-1 place-items-center [container-type:size]">
        <div data-testid="video" className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden bg-bg">
          {current && <Stage scene={current.scene} timeline={current.timeline} drawRef={drawRef} annotateRef={annotateRef} timeRef={localTime} />}
          {waiting && <Loading progress={progress} />}
          {buffering && current && <Loading progress={progress} compact />}
          {error && <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div><p role="alert" className="text-muted">{error}</p>
              {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line px-4 py-2 hover:bg-fg/10">Try again</button>}</div>
          </div>}

          <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/70 to-transparent ${fade} ${idle ? "opacity-0" : ""}`} />
          <div aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent ${fade} ${idle ? "opacity-0" : ""}`} />

          <div className={`absolute inset-x-0 top-0 flex items-start justify-between p-4 ${fade} ${hide}`}>
            <GlassBtn label="Back" icon={ArrowLeft02Icon} onClick={onBack} />
            <div className="flex gap-2">
              <GlassBtn label="Scenes" icon={LayersLogoIcon} pressed={showScenes} onClick={() => setShowScenes(v => !v)} />
              <GlassBtn label="Transcript" icon={TextAlignLeftIcon} pressed={tab === "transcript"} onClick={() => openTab("transcript")} />
              <GlassBtn label="Ask" icon={BubbleChatIcon} pressed={tab === "ask"} onClick={() => openTab("ask")} />
              <GlassBtn label="Toggle fullscreen" icon={FullScreenIcon} onClick={fullscreen} />
            </div>
          </div>

          {current && !error && <div className={`absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-8 ${fade} ${playing && (idle || !buffering) ? "opacity-0 hover:opacity-100 focus-within:opacity-100" : "opacity-100"}`}>
            <GlassBtn label="Back 10 seconds" icon={GoBackward10SecIcon} size={48} onClick={() => seek(time - 10)} />
            <GlassBtn label={playing ? "Pause video" : "Play video"} icon={playing ? PauseIcon : PlayIcon} size={80} iconSize={34} fill ring onClick={toggle} />
            <GlassBtn label="Forward 10 seconds" icon={GoForward10SecIcon} size={48} onClick={() => seek(time + 10)} />
          </div>}

          {showScenes && beats.length > 0 && <div className={`absolute top-20 right-4 bottom-28 w-56 ${fade} ${hide}`}>
            <AnimatedList ariaLabel="Scenes" frame maxHeight="100%" currentIndex={sceneIdx} animation="fade"
              items={beats.map((b, i) => ({ id: b.sceneId, title: `${i + 1}. Scene ${i + 1}`, meta: clock((i + 1 < beats.length ? beats[i + 1].offset : duration) - b.offset) }))}
              onItemSelect={(_, i) => seek(beats[i].offset)} />
          </div>}

          <div className={`absolute inset-x-0 bottom-0 px-6 pb-3 ${fade} ${hide}`}>
            <div className="mb-2 min-w-0">
              <p className="truncate text-xs text-subtle">{kicker}</p>
              <h1 className="truncate text-3xl font-bold tracking-tight">{title}</h1>
              {beats.length > 0 && <p className="text-sm text-muted">Scene {sceneIdx + 1} of {beats.length}</p>}
            </div>
            <div className="group relative" onPointerMove={hoverMove} onPointerLeave={() => setHover(null)}>
              {hover && <div role="tooltip" data-testid="scrub-preview" className="pointer-events-none absolute bottom-full left-0 z-10 mb-3 whitespace-nowrap" style={{ transform: `translateX(${hover.x}px) translateX(-50%)` }}>
                <GlassSurface width="auto" height="auto" borderRadius={12}><span className="block px-2.5 py-1 text-xs text-fg">{clock(hover.t)} · {hover.label}</span></GlassSurface></div>}
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-transform duration-200 ease-out group-hover:scale-y-[1.67]">
                <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${p / 100})` }} />
              </div>
              <div aria-hidden className="pointer-events-none absolute top-1/2 left-0 w-full" style={{ transform: "translateY(-50%)" }}>
                <div className="absolute top-0 -translate-y-1/2" style={{ left: `${p}%` }}>
                  <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-fg tabular-nums">{clock(time)}</span>
                  <span className="block size-3.5 -translate-x-1/2 rounded-full bg-accent" />
                </div>
              </div>
              <input type="range" aria-label="Seek" aria-valuetext={`${clock(time)} of ${clock(duration)}`} min={0} max={duration || 0} step="any" value={time}
                // Drag = pause once, seek silently, play once on release. play/pause/seek per input event deadlocks WebKit's AVFoundation media stack.
                onPointerDown={() => { scrubResume.current = queue.playing; queue.pause(); }}
                onPointerUp={() => { if (scrubResume.current) { scrubResume.current = false; queue.play(); } }}
                onChange={e => seek(Number(e.target.value))} className="scrubber relative block h-8 w-full" />
              {duration > 0 && threads.map(th => <button key={th.id} type="button" aria-label={`Question at ${clock(th.t)}: ${th.title}`} title={th.title}
                onClick={() => { setActiveThread(th.id); setTab("ask"); seek(th.t); }}
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-fg" style={{ left: `${Math.min(100, th.t / duration * 100)}%` }} />)}
            </div>
            <div className="flex items-center justify-between text-sm text-muted tabular-nums">
              {current && !error ? <GlassBtn label={playing ? "Pause" : "Play"} icon={playing ? PauseIcon : PlayIcon} fill onClick={toggle} /> : <span />}
              <span aria-label={`${clock(Math.max(0, duration - time))} remaining`}>-{clock(Math.max(0, duration - time))}</span>
            </div>
          </div>
        </div>
      </div>

      {tab && <SidePanel tab={tab} onTab={setTab} onClose={() => setTab(null)} time={time} lines={lines} threads={threads} activeThread={activeThread}
        onSelectThread={setActiveThread} onSend={send} thinking={thinking} onSeek={seek} onResume={resume} onPinNote={onPinNote}
        checkpoint={activeCp} checkpoints={checkpoints} provider={provider} store={store} videoId={videoId}
        onCheckpointDone={() => { setActiveCp(null); setTab(null); play(); }}
        onAskAbout={q => { setActiveCp(null); setTab("ask"); setActiveThread(null); void send(q, null); }} />}
    </main>
  );
}
