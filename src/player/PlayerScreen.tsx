import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft02Icon, BookOpen01Icon, BubbleChatIcon, CheckListIcon, ClosedCaptionIcon, FullScreenIcon, GoBackward10SecIcon, GoForward10SecIcon, PauseIcon, PlayIcon, TextAlignLeftIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import Menu from "@/components/ui/Menu";
import Icon from "@/components/Icon";
import GlassSurface from "@/components/GlassSurface";
import Stage from "@/Stage";
import type { LLMProvider } from "@/llm/provider";
import { providers } from "@/llm/registry";
import type { PipelineEvent, Progress } from "@/pipeline/streamVideo";
import type { Checkpoint } from "@/gen/checkpoints";
import { tauriJsonStore, threads as threadStore, newId, type JsonStore, type Thread } from "@/storage/store";
import type { Annotation } from "@motion/annotations";
import { applyEventsAt } from "@motion/stage/scene";
import { describeScene, visibleObjects } from "@motion/stage/describe";
import { ask, buildTutorContext, resumeTime } from "@/tutor/tutor";
import { narrationLines, nowSayingAt, transcriptUntil } from "@/tutor/narration";
import { devlog } from "@/devlog";
import { SceneQueue } from "@motion/player/queue";
import { bufferClock, unlockAudioOnGesture } from "@motion/player/bufferClock";
import SidePanel, { type Tab } from "./SidePanel";
import Loading from "./Loading";
import Textbook from "./Textbook";
import type { TextbookSource } from "@/follow/types";
import Captions, { captionCues } from "./Captions";
import Checks, { type CheckStatus } from "./Checks";
import CheckpointCard, { results, type CheckpointResult } from "./CheckpointCard";
import Quiz from "./Quiz";

type StreamedScene = Extract<PipelineEvent, { type: "scene" }>;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const iconBtn = "relative grid size-10 shrink-0 place-items-center rounded-full text-fg/80 transition-colors hover:bg-fg/15 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-fg/15 aria-pressed:text-fg aria-expanded:bg-fg/15";
// Absolute filesystem paths (sidecar WAVs, saved bundles) go through the asset protocol; URLs pass through.
const audioSrc = (p: string) => p.startsWith("/") && "__TAURI_INTERNALS__" in window ? convertFileSrc(p) : p;
const CC_KEY = "tangent.cc";
// The Home "Make video" click (same document) is the gesture that lets the shared AudioContext run later.
if (typeof window !== "undefined" && typeof AudioContext !== "undefined") unlockAudioOnGesture();
const readCc = () => { try { return localStorage.getItem(CC_KEY) !== "off"; } catch { return true; } };
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SPEED_KEY = "tangent.speed";
const readSpeed = () => { try { const v = Number(localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(v) ? v : 1; } catch { return 1; } };
const statusOf = (r?: CheckpointResult): CheckStatus => !r ? "upcoming" : r.skipped ? "skipped" : r.correct ? "right" : "wrong";
export const IDLE_MS = 2500; // playing + no pointer/key activity this long → the chrome fades out
const THUMB_W = 480;

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
  autoPlay?: boolean;
  initialError?: string;
  textbook?: TextbookSource;
};

export default function PlayerScreen({ stream, title, kicker = "Tangent", videoId, section = "", provider = providers.claude, store = tauriJsonStore, progress, onRetry, onBack, autoPlay = false, initialError, textbook }: PlayerProps) {
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
  const [cpResults, setCpResults] = useState<Record<string, CheckpointResult>>({});
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [cc, setCc] = useState(readCc);
  const [speed, setSpeed] = useState(readSpeed);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [quiz, setQuiz] = useState<Checkpoint[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [idle, setIdle] = useState(false);
  const [overChrome, setOverChrome] = useState(false);
  const localTime = useRef(0);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const annotateRef = useRef<((a: Annotation[]) => void) | null>(null);
  const snapshotRef = useRef<((maxW?: number) => Promise<string | null>) | null>(null);
  const shownCps = useRef(new Set<string>());
  const cpsRef = useRef<Checkpoint[]>([]);
  const resultsRef = useRef<Record<string, CheckpointResult>>({});
  const autoScene = useRef<number | null>(null); // scene whose checkpoints popped up by themselves (vs opened from the list)
  const currentRef = useRef<StreamedScene | null>(null);
  currentRef.current = current;
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  const scrubResume = useRef(false);
  const idleTimer = useRef(0);
  const [hover, setHover] = useState<{ x: number; t: number; label: string } | null>(null);

  /** Auto-pop the next checkpoint after a scene: not one already shown this session or answered in an earlier one. */
  const showCheckpointAfter = useCallback((sceneIndex: number) => {
    const cp = cpsRef.current.find(c => c.afterScene === sceneIndex && !shownCps.current.has(c.id) && !resultsRef.current[c.id]);
    if (!cp) return false;
    shownCps.current.add(cp.id);
    autoScene.current = sceneIndex;
    queue.pause();
    setActiveCp(cp);
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cache a small picture of a scene's last frame (checkpoint context). Only while the Stage shows that scene at its end. */
  const captureThumb = useCallback((sceneIndex: number) => {
    const sceneId = queue.sceneBeats[sceneIndex]?.sceneId, live = currentRef.current;
    if (sceneIndex < 0 || thumbsRef.current[sceneIndex] || !live || live.sceneId !== sceneId || localTime.current < live.timeline.totalSec - 0.2) return;
    void snapshotRef.current?.(THUMB_W).then(b64 => {
      if (b64) setThumbs(p => p[sceneIndex] ? p : { ...p, [sceneIndex]: `data:image/png;base64,${b64}` });
    }, () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [queue] = useState(() => new SceneQueue<StreamedScene>({
    // Web Audio, not <audio>: per-element audio-session churn deadlocks WKWebView. <audio> only where there's no AudioContext (jsdom).
    createAudio: path => typeof AudioContext === "undefined" ? new Audio(audioSrc(path)) : bufferClock(audioSrc(path)),
    render: (data, t) => {
      localTime.current = t;
      setCurrent(prev => {
        if (prev?.sceneId !== data.sceneId) devlog(`render scene ${data.sceneId}`);
        return prev?.sceneId === data.sceneId ? prev : data;
      });
      drawRef.current?.(t);
      if (t < data.timeline.totalSec) return;
      // The scene's last frame: keep a thumbnail, and if playback ran into the end (not a seek), its checkpoint.
      const beats = queue.sceneBeats, i = beats.findIndex(b => b.sceneId === data.sceneId);
      captureThumb(i);
      if (i >= 0 && queue.playing && queue.time >= beats[i].offset + data.timeline.totalSec - 1e-6) queueMicrotask(() => showCheckpointAfter(i));
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
      setScenes([]); setDone(false); setError(initialError ?? null); // a re-run (Fast Refresh, new stream) starts from an empty queue
      if (autoPlay) queue.play();
      try {
        while (live) {
          const next = await it.next();
          if (!live) return;
          if (next.done) break;
          const ev = next.value;
          if (ev.type === "scene") { queue.enqueue(ev); setScenes(s => [...s, ev]); played = true; }
          else if (ev.type === "checkpoints") { const items = [...ev.items].sort((a, b) => a.afterScene - b.afterScene); cpsRef.current = items; setCheckpoints(items); }
          else { devlog(`scene failed ${ev.sceneId}: ${ev.error.message}`); if (!played) setError(`Scene ${ev.sceneId}: ${ev.error.message}`); } // later failures are skipped, not overlaid
        }
      } catch (e) { if (live) setError(String(e)); }
      finally { if (live) { queue.finish(); setDone(true); } }
    });
    return () => { live = false; queue.dispose(); void it?.return?.().catch(() => {}); };
  }, [stream, queue, autoPlay]);

  useEffect(() => { queue.setRate(speed); }, [queue, speed]);

  // End of the whole video: the last checkpoints.
  useEffect(() => {
    if (done && !playing && !buffering && duration > 0 && time >= duration - 0.15) showCheckpointAfter(queue.sceneBeats.length - 1);
  }, [done, playing, buffering, time, duration, showCheckpointAfter, queue]);

  useEffect(() => {
    if (!videoId) return;
    threadStore(store).list(videoId).then(setThreads, () => {});
    results(store).get(videoId).then(saved => setCpResults(p => { const next = { ...saved, ...p }; resultsRef.current = next; return next; }), () => {});
  }, [videoId, store]);
  const saveThreads = (next: Thread[]) => { setThreads(next); if (videoId) void threadStore(store).save(videoId, next).catch(() => {}); };
  const saveResult = (id: string, r: CheckpointResult) => {
    const prev = resultsRef.current[id];
    if (r.skipped && prev && !prev.skipped) return; // skipping a retry never erases a real answer
    resultsRef.current = { ...resultsRef.current, [id]: r };
    setCpResults(resultsRef.current);
    if (videoId) void results(store).put(videoId, id, r).catch(() => {});
  };

  const lines = useMemo(() => narrationLines(scenes), [scenes]);
  // Scene start times on the queue's clock (which holds a short gap between scenes); `duration` changes whenever a scene is enqueued.
  const offsets = useMemo(() => queue.sceneBeats.map(b => b.offset), [queue, scenes, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  const cues = useMemo(() => captionCues(scenes, offsets), [scenes, offsets]);
  // Global end time of each arrived scene's timeline: where its checkpoints sit on the seek bar.
  const sceneEnds = useMemo(() => scenes.map((s, i) => (offsets[i] ?? 0) + s.timeline.totalSec), [scenes, offsets]);
  const cpTime = (cp: Checkpoint) => sceneEnds[cp.afterScene] as number | undefined;
  const isReady = (cp: Checkpoint) => cpTime(cp) !== undefined;
  const status = useMemo(() => Object.fromEntries(checkpoints.map(c => [c.id, statusOf(cpResults[c.id])])), [checkpoints, cpResults]);
  const answered = checkpoints.filter(c => status[c.id] === "right" || status[c.id] === "wrong").length;

  // The thumbnail for a checkpoint opened from the list: once the Stage shows its scene's end.
  useEffect(() => { if (activeCp) captureThumb(activeCp.afterScene); }, [activeCp, current, captureThumb]);

  const seek = (s: number) => { const t = Math.min(duration, Math.max(0, s)); queue.seek(t); setTime(t); };
  const pause = () => { queue.pause(); setPlaying(false); };
  const play = () => {
    annotateRef.current?.([]);
    if (activeCp) { // Play over an open card = skipping it (unless it was answered)
      if (!resultsRef.current[activeCp.id]) saveResult(activeCp.id, { response: "", correct: false, at: Date.now(), skipped: true });
      autoScene.current = null;
      setActiveCp(null);
    }
    if (duration > 0 && queue.time >= duration - 0.05 && !buffering) queue.seek(0);
    queue.play(); setPlaying(true);
  };
  const resume = (t: number) => { annotateRef.current?.([]); setActiveCp(null); queue.seek(resumeTime(queue.beatStarts, t)); setTime(queue.time); queue.play(); setPlaying(true); };

  /** Open a checkpoint on demand (list / marker): park on the last frame of its scene, paused. */
  const openCp = (cp: Checkpoint) => {
    const at = cpTime(cp);
    if (at === undefined) return;
    pause();
    shownCps.current.add(cp.id);
    autoScene.current = null;
    seek(Math.max(0, at - 0.05));
    setActiveCp(cp);
  };
  /** Continue after a checkpoint: the scene's next question, else on to the next scene (or stay put at the very end). */
  const continueCp = () => {
    setActiveCp(null);
    const auto = autoScene.current;
    autoScene.current = null;
    if (auto !== null && showCheckpointAfter(auto)) return;
    if (done && duration > 0 && queue.time >= duration - 0.2) return;
    const next = auto !== null ? queue.sceneBeats[auto + 1] : undefined;
    if (next) queue.seek(next.offset); // the card was the pause between scenes
    queue.play(); setPlaying(true);
  };
  const openQuiz = () => { pause(); setActiveCp(null); setSpeedOpen(false); setQuiz(checkpoints.filter(isReady)); };
  const jumpToScene = (i: number) => { setQuiz(null); const b = queue.sceneBeats[i]; if (!b) return; seek(b.offset); queue.play(); setPlaying(true); };

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
      // What the student sees and hears right now: the live scene graph, its description, the line being said, and a frame.
      const live = queue.current;
      const state = live ? applyEventsAt(live.scene, live.timeline, localTime.current) : null;
      const context = buildTutorContext({
        objects: live && state ? visibleObjects(live.scene, state) : [],
        transcript: transcriptUntil(lines, t), section, priorQuestions: threads.map(x => x.title),
        sceneDescription: live && state ? describeScene(live.scene, state) : undefined,
        nowSaying: nowSayingAt(lines, t),
      });
      const image = (await snapshotRef.current?.().catch(() => null)) ?? undefined;
      const r = await ask({ question, context, provider, history: base.messages, image });
      annotateRef.current?.(r.annotations);
      thread = { ...thread, messages: [...thread.messages, { role: "tutor", text: r.answer, at: Date.now() }] };
    } catch (e) {
      devlog(`tutor failed ${String(e)}`);
      thread = { ...thread, messages: [...thread.messages, { role: "tutor", text: "I couldn't answer that just now. Try asking again.", at: Date.now() }] };
    }
    next = [thread, ...next.filter(x => x.id !== thread!.id)];
    saveThreads(next); setThinking(false);
  };

  // Hover preview on the seek bar: time under the cursor, or the marker it is near. Never seeks.
  const hoverMove = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.pointerType === "touch" || !duration || !r.width) return;
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left)), t = x / r.width * duration;
    const nearCps = checkpoints.filter(c => { const at = cpTime(c); return at !== undefined && Math.abs(at / duration * r.width - x) < 8; });
    const nearCp = nearCps[0];
    const near = threads.find(th => Math.abs(th.t / duration * r.width - x) < 8);
    setHover({ x, t, label: nearCps.length > 1 ? `${nearCps.length} checkpoints` : nearCp ? `Checkpoint · ${nearCp.prompt}` : near ? near.title : "" });
  };
  const openTab = (t: Tab) => {
    if (t === "ask" && tab !== "ask") {
      pause();
      // Asking at another moment starts a new question; the old thread stays one tap away in the list.
      const th = threads.find(x => x.id === activeThread);
      if (th && (Math.abs(queue.time - th.t) > 3 || (th.sceneId && th.sceneId !== queue.current?.sceneId))) setActiveThread(null);
    }
    setTab(p => p === t ? null : t);
  };
  const toggleCc = () => setCc(v => { try { localStorage.setItem(CC_KEY, v ? "off" : "on"); } catch { /* fine */ } return !v; });
  const changeSpeed = (r: number) => { setSpeed(r); try { localStorage.setItem(SPEED_KEY, String(r)); } catch { /* fine */ } };
  const stepSpeed = (dir: 1 | -1) => setSpeed(s => {
    const r = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(s) + dir))];
    try { localStorage.setItem(SPEED_KEY, String(r)); } catch { /* fine */ }
    return r;
  });
  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  const waiting = !current && !error;
  const p = duration ? time / duration * 100 : 0;
  const toggle = playing ? pause : play;
  const canPlay = !!current && !error;

  // Chrome over the video: visible unless playing and idle; anything open or hovered keeps it up.
  const poke = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => { if (playing) poke(); }, [playing, poke]);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);
  const chrome = !playing || !idle || overChrome || speedOpen || !!activeCp || buffering || !canPlay;
  const chromeHover = { onPointerEnter: () => setOverChrome(true), onPointerLeave: () => setOverChrome(false) };

  const keys = useRef({ toggle, seek, time, toggleCc, stepSpeed, poke, blocked: false });
  keys.current = { toggle, seek, time, toggleCc, stepSpeed, poke, blocked: !!activeCp || !!quiz };

  // Space / K play-pause, arrows ±10 s, C captions, < > speed. Typing never triggers them; an open checkpoint or quiz holds playback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const k = keys.current;
      k.poke();
      if (e.key === "Escape") setSpeedOpen(false);
      if (e.metaKey || e.ctrlKey || e.altKey || el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "c") { e.preventDefault(); k.toggleCc(); return; }
      if (e.key === "<" || e.key === ">") { e.preventDefault(); k.stepSpeed(e.key === ">" ? 1 : -1); return; }
      if (k.blocked) return;
      if ((e.key === " " && el.tagName !== "BUTTON") || e.key === "k") { e.preventDefault(); k.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); k.seek(k.time - 10); }
      else if (e.key === "ArrowRight") { e.preventDefault(); k.seek(k.time + 10); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cpIndex = activeCp ? checkpoints.findIndex(c => c.id === activeCp.id) : -1;
  const fmtSpeed = (r: number) => `${r}×`;

  return (
    // overflow-clip, not hidden: a hidden box can still be scrolled by focus(), and the Ask box autofocusing while the panel
    // slid in scrolled the whole player sideways (the jagged jump on open).
    <main onPointerMove={poke} onPointerDown={poke} className={`relative flex h-screen overflow-clip bg-bg ${chrome ? "" : "cursor-none"}`}>
      {/* Video column: the 16:9 box letterboxed in it; header and controls pinned to the column's top/bottom (the window's),
          not the video's. The side panel docks beside the column at lg+, floats over it below. */}
      <div className="relative grid min-w-0 flex-1 place-items-center [container-type:size]">
        <div data-testid="frame" data-chrome={chrome ? "shown" : "hidden"}
          className="relative" style={{ width: "min(100cqw, calc(100cqh * 16 / 9))" }}>
          <div data-testid="video" onClick={canPlay && !activeCp ? toggle : undefined}
            className={`relative aspect-video w-full overflow-hidden bg-bg ${canPlay && !activeCp ? "cursor-pointer" : ""}`}>
            {current && <Stage scene={current.scene} timeline={current.timeline} drawRef={drawRef} annotateRef={annotateRef} timeRef={localTime} snapshotRef={snapshotRef} />}
            {waiting && <Loading progress={progress} />}
            {buffering && current && !activeCp && <Loading progress={progress} compact />}
            {error && <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div><p role="alert" className="text-muted">{error}</p>
                {current && <button type="button" onClick={() => { setError(null); play(); }} className="mt-3 mr-2 rounded-lg border border-line px-4 py-2 hover:bg-fg/10">Resume</button>}
                {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line px-4 py-2 hover:bg-fg/10">Try again</button>}</div>
            </div>}
            {canPlay && !playing && !buffering && !activeCp && <div className="absolute top-1/2 left-1/2 z-[5] -translate-x-1/2 -translate-y-1/2">
              <GlassSurface width={72} height={72} borderRadius={36}>
                <button type="button" aria-label="Play video" onClick={e => { e.stopPropagation(); play(); }}
                  className="grid size-full place-items-center rounded-full text-fg transition-transform duration-150 ease-out hover:scale-105 active:scale-95">
                  <Icon icon={PlayIcon} size={30} className="translate-x-0.5 fill-current" /></button>
              </GlassSurface>
            </div>}
            {activeCp && <CheckpointCard key={activeCp.id} checkpoint={activeCp} index={cpIndex} total={checkpoints.length} provider={provider} thumb={thumbs[activeCp.afterScene]}
              onResult={r => saveResult(activeCp.id, r)} onContinue={continueCp}
              onAskAbout={q => { setActiveCp(null); autoScene.current = null; setTab("ask"); setActiveThread(null); void send(q, null); }} />}
          </div>

        </div>

        {cc && <Captions cues={activeCp ? [] : cues} time={time} />}

      <header data-hidden={!chrome || undefined} {...chromeHover}
        className="chrome scrim-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-1 px-2 pt-2 pb-8 sm:px-3">
        <button type="button" aria-label="Back" title="Back" onClick={onBack} className={`${iconBtn} pointer-events-auto`}><Icon icon={ArrowLeft02Icon} /></button>
        <div className="min-w-0 flex-1 pt-0.5 [text-shadow:0_1px_8px_rgba(0,0,0,.6)]">
          <p className="truncate text-xs text-fg/60">{kicker}</p>
          <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
        </div>
        <div className={`pointer-events-auto flex items-center gap-0.5`}>
          {!tab && <>
          {checkpoints.length > 0 && <button type="button" aria-label="Checks" aria-pressed={tab === "checks"} title={`Checks · ${answered} of ${checkpoints.length} answered`} onClick={() => openTab("checks")} className={iconBtn}>
            <Icon icon={CheckListIcon} size={22} />
            <span data-testid="checks-badge" className="absolute -top-0.5 -right-1 rounded-full bg-fg px-1.5 text-[10px] leading-4 font-bold text-bg tabular-nums">{answered}/{checkpoints.length}</span>
          </button>}
          {textbook && <button type="button" aria-label="Textbook" aria-pressed={tab === "textbook"} title="Textbook" onClick={() => openTab("textbook")} className={iconBtn}><Icon icon={BookOpen01Icon} size={22} /></button>}
          <button type="button" aria-label="Transcript" aria-pressed={tab === "transcript"} title="Transcript" onClick={() => openTab("transcript")} className={iconBtn}><Icon icon={TextAlignLeftIcon} size={22} /></button>
          <button type="button" aria-label="Ask" aria-pressed={tab === "ask"} title="Ask a question" onClick={() => openTab("ask")} className={iconBtn}><Icon icon={BubbleChatIcon} size={22} /></button>
          </>}
          <button type="button" aria-label="Toggle fullscreen" title="Fullscreen" onClick={fullscreen} className={iconBtn}><Icon icon={FullScreenIcon} size={22} /></button>
        </div>
      </header>

      <div data-hidden={!chrome || undefined} {...chromeHover} className="chrome scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pt-10 pb-1.5 sm:px-3">
        <div className="group pointer-events-auto relative" onPointerMove={hoverMove} onPointerLeave={() => setHover(null)}>
          {hover && <span role="tooltip" data-testid="scrub-preview" className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 max-w-[20rem] truncate whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-fg"
            style={{ transform: `translateX(${hover.x}px) translateX(-50%)` }}>{clock(hover.t)}{hover.label && ` · ${hover.label}`}</span>}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-fg/25 transition-transform duration-150 ease-out group-hover:scale-y-150">
            <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${p / 100})` }} />
          </div>
          <span aria-hidden className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100" style={{ left: `${p}%` }} />
          <input type="range" aria-label="Seek" aria-valuetext={`${clock(time)} of ${clock(duration)}`} min={0} max={duration || 0} step="any" value={time}
            // Drag = pause once, seek silently, play once on release. play/pause/seek per input event deadlocks WebKit's AVFoundation media stack.
            onPointerDown={() => { scrubResume.current = queue.playing; queue.pause(); }}
            onPointerUp={() => { if (scrubResume.current) { scrubResume.current = false; queue.play(); } }}
            onChange={e => seek(Number(e.target.value))} className="scrubber relative block h-6 w-full" />
          {duration > 0 && threads.map(th => <button key={th.id} type="button" aria-label={`Question at ${clock(th.t)}: ${th.title}`} title={th.title}
            onClick={() => { setActiveThread(th.id); setTab("ask"); seek(th.t); }}
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-fg" style={{ left: `${Math.min(100, th.t / duration * 100)}%` }} />)}
          {/* One diamond per scene end (its checkpoints share that moment): hollow = something left, filled = all right. */}
          {duration > 0 && [...new Set(checkpoints.map(c => c.afterScene))].map(sceneI => {
            const group = checkpoints.flatMap((cp, i) => cp.afterScene === sceneI ? [{ cp, n: i + 1 }] : []);
            const at = cpTime(group[0].cp);
            if (at === undefined) return null;
            const ss = group.map(g => status[g.cp.id]);
            const s = ss.every(x => x === "right") ? "right" : ss.includes("upcoming") ? "upcoming" : ss.includes("wrong") ? "wrong" : "skipped";
            const target = group.find(g => status[g.cp.id] === "upcoming") ?? group[0];
            const label = group.length > 1 ? `Checkpoints ${group[0].n}–${group[group.length - 1].n} at ${clock(at)}` : `Checkpoint ${group[0].n} at ${clock(at)}`;
            return <button key={sceneI} type="button" aria-label={label} title={group.map(g => g.cp.prompt).join("\n")} onClick={() => openCp(target.cp)}
              className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 transition-transform hover:scale-125 ${
                s === "right" ? "border-black bg-fg" : s === "wrong" ? "border-fg bg-black" : s === "skipped" ? "border-fg/50 bg-black" : "border-fg bg-black"}`}
              style={{ left: `${Math.min(100, at / duration * 100)}%` }} />;
          })}
        </div>
        <div className="pointer-events-auto flex items-center gap-0.5 text-sm text-fg/80 tabular-nums">
          <button type="button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"} disabled={!canPlay} onClick={toggle} className={iconBtn}>
            <Icon icon={playing ? PauseIcon : PlayIcon} className="fill-current" /></button>
          <button type="button" aria-label="Back 10 seconds" title="Back 10 s (←)" disabled={!canPlay} onClick={() => seek(time - 10)} className={iconBtn}><Icon icon={GoBackward10SecIcon} /></button>
          <button type="button" aria-label="Forward 10 seconds" title="Forward 10 s (→)" disabled={!canPlay} onClick={() => seek(time + 10)} className={iconBtn}><Icon icon={GoForward10SecIcon} /></button>
          <span className="ml-1 whitespace-nowrap">{clock(time)} <span className="text-fg/50">/ {clock(duration)}</span></span>
          <div className="ml-auto flex items-center gap-0.5">
            <Menu label="Playback speed" menuLabel="Speed" trigger={fmtSpeed(speed)} open={speedOpen} onOpenChange={setSpeedOpen} above triggerClassName={`${iconBtn} w-auto min-w-10 px-2 text-[13px] font-semibold`}>
              {SPEEDS.map(r => <button key={r} type="button" role="menuitemradio" tabIndex={-1} aria-checked={r === speed} onClick={() => changeSpeed(r)}>
                {r === 1 ? "Normal" : fmtSpeed(r)}{r === speed && <Icon icon={Tick02Icon} size={16} />}</button>)}
            </Menu>
            <button type="button" aria-label="Captions" aria-pressed={cc} title="Captions (C)" onClick={toggleCc} className={iconBtn}><Icon icon={ClosedCaptionIcon} /></button>
          </div>
        </div>
      </div>
      </div>

      {tab && <SidePanel tab={tab} onTab={setTab} onClose={() => setTab(null)} time={time} lines={lines} threads={threads} activeThread={activeThread}
        onSelectThread={setActiveThread} onSend={send} thinking={thinking} onSeek={seek} onResume={resume}
        checksBadge={<span data-testid="checks-badge" className="absolute -top-0.5 -right-1 rounded-full bg-fg px-1.5 text-[10px] leading-4 font-bold text-bg tabular-nums">{answered}/{checkpoints.length}</span>}
        textbook={textbook ? <Textbook source={textbook} scenes={scenes} time={time} /> : undefined}
        checks={checkpoints.length ? <Checks checkpoints={checkpoints} status={status} active={activeCp?.id} onOpen={openCp} isReady={isReady} onQuiz={openQuiz} complete={done} /> : undefined} />}

      {quiz && <Quiz checkpoints={quiz} provider={provider} thumbs={thumbs} onResult={saveResult} onClose={() => setQuiz(null)} onJump={jumpToScene} />}
    </main>
  );
}
