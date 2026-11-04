import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft02Icon, BubbleChatIcon, FullScreenIcon, GoBackward10SecIcon, GoForward10SecIcon, PauseIcon, PlayIcon, TextAlignLeftIcon } from "@hugeicons/core-free-icons";
import Icon from "@/components/Icon";
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
const iconBtn = "grid size-11 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg";
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

  const openTab = (t: Tab) => { if (t === "ask") pause(); setTab(p => p === t ? null : t); };
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  const waiting = !current && !error;

  return (
    <main className={`flex h-screen bg-bg ${idle ? "cursor-none" : ""}`}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className={`flex items-center gap-3 px-4 py-3 transition-opacity duration-300 ${idle ? "opacity-0" : ""}`}>
          <button type="button" aria-label="Back" onClick={onBack} className={iconBtn}><Icon icon={ArrowLeft02Icon} /></button>
          <div className="min-w-0">
            <p className="truncate text-xs text-subtle">{kicker}</p>
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="ml-auto flex gap-1">
            <button type="button" aria-label="Transcript" aria-pressed={tab === "transcript"} onClick={() => openTab("transcript")} className={iconBtn}><Icon icon={TextAlignLeftIcon} /></button>
            <button type="button" aria-label="Ask" aria-pressed={tab === "ask"} onClick={() => openTab("ask")} className={iconBtn}><Icon icon={BubbleChatIcon} /></button>
            <button type="button" aria-label="Toggle fullscreen" onClick={fullscreen} className={iconBtn}><Icon icon={FullScreenIcon} /></button>
          </div>
        </header>

        {/* The video is always a 16:9 box, letterboxed in whatever space the side panel leaves. */}
        <div className="grid min-h-0 flex-1 place-items-center px-4 pb-2 [container-type:size]">
          <div data-testid="video" className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden rounded-xl border border-line bg-bg">
            {current && <Stage scene={current.scene} timeline={current.timeline} drawRef={drawRef} annotateRef={annotateRef} timeRef={localTime} />}
            {waiting && <Loading progress={progress} />}
            {buffering && current && <Loading progress={progress} compact />}
            {error && <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div><p role="alert" className="text-muted">{error}</p>
                {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line px-4 py-2 hover:bg-fg/10">Try again</button>}</div>
            </div>}
            {current && !error && <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={playing ? pause : play}
              className={`absolute top-1/2 left-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full glass transition-opacity duration-300 ${playing && (idle || !buffering) ? "opacity-0 hover:opacity-100" : "opacity-100"}`}>
              <Icon icon={playing ? PauseIcon : PlayIcon} size={30} className={`fill-current ${playing ? "" : "translate-x-0.5"}`} />
            </button>}
          </div>
        </div>

        <div className={`flex items-center gap-3 px-6 pb-4 text-sm text-muted tabular-nums transition-opacity duration-300 ${idle ? "opacity-0" : ""}`}>
          <button type="button" aria-label="Back 10 seconds" onClick={() => seek(time - 10)} className={iconBtn}><Icon icon={GoBackward10SecIcon} /></button>
          <button type="button" aria-label="Forward 10 seconds" onClick={() => seek(time + 10)} className={iconBtn}><Icon icon={GoForward10SecIcon} /></button>
          <span>{clock(time)}</span>
          <div className="relative flex-1">
            <input type="range" aria-label="Seek" aria-valuetext={`${clock(time)} of ${clock(duration)}`} min={0} max={duration || 0} step="any" value={time}
              onChange={e => seek(Number(e.target.value))} className="scrubber h-11 w-full" style={{ "--p": `${duration ? time / duration * 100 : 0}%` } as React.CSSProperties} />
            {duration > 0 && threads.map(th => <button key={th.id} type="button" aria-label={`Question at ${clock(th.t)}: ${th.title}`} title={th.title}
              onClick={() => { setActiveThread(th.id); setTab("ask"); seek(th.t); }}
              className="absolute top-1 size-3 -translate-x-1/2 rounded-full border border-bg bg-fg" style={{ left: `${Math.min(100, th.t / duration * 100)}%` }} />)}
          </div>
          <span aria-label={`${clock(Math.max(0, duration - time))} remaining`}>-{clock(Math.max(0, duration - time))}</span>
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
