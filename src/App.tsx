import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  BubbleChatIcon,
  FullScreenIcon,
  GoBackward10SecIcon,
  GoForward10SecIcon,
  LeftToRightListBulletIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import AnimatedList from "@/components/AnimatedList";
import Icon from "@/components/Icon";
import ShinyText from "@/components/ShinyText";
import type { LLMProvider } from "./llm/provider";
import { providers } from "./llm/registry";
import Home from "./home/Home";
import { sectionFigures, sectionText, type IR } from "./home/api";
import { recordStream, replayStream, type VideoBundle } from "./storage/videos";
import { stripWatermarks } from "./gen/sanitize";
import { startSession } from "./pipeline/session";
import Panel from "./Panel";
import Stage from "./Stage";
import { Player } from "./player/player";
import { SceneQueue } from "./player/queue";
import type { GenerationStatus, PipelineEvent } from "./pipeline/streamVideo";
import { devlog } from "./devlog";
import { AUDIO_URL, scene, timeline } from "./stage/demo";
import { ping } from "./ipc";
import type { Annotation } from "./tutor/annotations";
import { beatStarts } from "./tutor/glue";
import { ask, buildTutorContext, resumeTime } from "./tutor/tutor";

const DURATION = timeline.totalSec;
const STARTS = beatStarts(timeline);
const SECTIONS = ["Binary heaps", "Heap order property", "Heapify", "Building a heap in O(n)", "Heapsort"];
const IDLE_MS = 3000;

// Monochrome overrides for AnimatedList's default (tinted) dark theme. Ring at 0.5 alpha keeps >3:1 on the panel.
const LIST_THEME = {
  "--al-tile": "transparent",
  "--al-tile-edge": "transparent",
  "--al-tile-highlight": "transparent",
  "--al-tile-shadow": "none",
  "--al-ink": "var(--fg)",
  "--al-muted": "var(--fg-muted)",
  "--al-ring": "rgba(255, 255, 255, 0.5)",
  "--al-ring-fill": "rgba(255, 255, 255, 0.04)",
  "--al-hover": "none",
  "--al-press": "brightness(0.85)",
  "--al-active": "none",
} as React.CSSProperties;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const iconBtn = "grid size-11 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg";

type StreamedScene = Extract<PipelineEvent, { type: "scene" }>;
export function PlayerScreen({ provider: injected, onBack, stream, section, progress, onRetry, autoPlay = false, title }: { title?: string; provider?: LLMProvider; onBack?: () => void; stream?: AsyncIterable<PipelineEvent>; section?: string; progress?: GenerationStatus; onRetry?: () => void; autoPlay?: boolean }) {
  const provider = injected ?? providers.claude; // ponytail: provider choice moves to a settings page later

  const [sidecar, setSidecar] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(stream ? 0 : DURATION);
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentScene, setCurrentScene] = useState<StreamedScene | null>(null);
  const localTime = useRef(0);
  const lastLogged = useRef("");
  const lastBuf = useRef(false);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const annotateRef = useRef<((a: Annotation[]) => void) | null>(null);
  const priorQs = useRef<string[]>([]);
  const askedAt = useRef(0);
  // One clock: the <audio> element. The Player paces redraws from audio.currentTime.
  const [audio] = useState(() => stream ? null : Object.assign(new Audio(AUDIO_URL), { preload: "auto" }));
  const [player] = useState<Player | SceneQueue<StreamedScene>>(() => stream ? new SceneQueue<StreamedScene>({
    createAudio: path => new Audio(path.startsWith("/") && "__TAURI_INTERNALS__" in window ? convertFileSrc(path) : path),
    render: (data, t) => {
      localTime.current = t;
      if (lastLogged.current !== data.sceneId) {
        lastLogged.current = data.sceneId; devlog(`render scene ${data.sceneId}`);
        setCurrentScene(data);
        return; // drawRef still holds the previous scene; the Stage draws the new one at timeRef when it swaps
      }
      drawRef.current?.(t);
    },
    onChange: () => {
      setTime(p => Math.abs(p - player.time) < 0.1 ? p : player.time);
      setDuration(player instanceof SceneQueue ? player.duration : DURATION);
      setPlaying(player.playing);
      setBuffering(player instanceof SceneQueue && player.buffering);
      if (player instanceof SceneQueue && player.buffering !== lastBuf.current) { lastBuf.current = player.buffering; devlog(`buffering=${player.buffering} t=${player.time.toFixed(1)}/${player.duration.toFixed(1)}`); }
    },
    onError: error => { devlog(`queue error ${String(error)}`); setPlaybackError(String(error)); },
  }) : new Player({ timeline, audio: audio!, render: (t) => {
    drawRef.current?.(t);
    setTime((p) => (Math.abs(p - t) < 0.1 ? p : t)); // don't re-render React at 60fps
  } }));
  useEffect(() => {
    if (!audio) return;
    const stop = () => { setPlaying(false); setTime(audio.currentTime); };
    audio.addEventListener("ended", stop);
    audio.addEventListener("pause", stop);
    return () => { audio.removeEventListener("ended", stop); audio.removeEventListener("pause", stop); player.pause(); };
  }, [audio, player]);
  useEffect(() => {
    if (!stream || !(player instanceof SceneQueue)) return;
    let live = true;
    let iterator: AsyncIterator<PipelineEvent> | undefined;
    let played = false;
    // Defer consumption so StrictMode's discarded effect cannot abort the live stream.
    void Promise.resolve().then(async () => {
      if (!live) return;
      iterator = stream[Symbol.asyncIterator]();
      if (autoPlay) player.play();
      try {
        while (live) {
          const next = await iterator.next();
          if (!live) return;
          if (next.done) { devlog("stream done"); break; }
          devlog(next.value.type === "scene" ? `stream scene ${next.value.sceneId} ${next.value.timeline.totalSec.toFixed(1)}s ${next.value.wavPath.slice(-40)}` : `stream error ${next.value.sceneId} ${next.value.error.message}`);
          if (next.value.type === "scene") { player.enqueue(next.value); played = true; }
          // A failed later scene is skipped; overlaying an error on a playing video is worse than a gap.
          else if (!played) setPlaybackError(`Scene ${next.value.sceneId}: ${next.value.error.message}`);
        }
      } catch (error) {
        if (live) setPlaybackError(String(error));
      } finally {
        if (live) player.finish();
      }
    });
    return () => {
      live = false;
      player.dispose();
      void iterator?.return?.().catch(() => {});
    };
  }, [stream, player, autoPlay]);
  const [panel, setPanel] = useState<"Sections" | "Ask" | null>(null);
  const [active, setActive] = useState(2);
  const [tutor, setTutor] = useState<{ s: "idle" | "loading" | "error" | "answered"; answer?: string }>({ s: "idle" });
  const [idle, setIdle] = useState(false);
  const close = useCallback(() => setPanel(null), []);

  useEffect(() => {
    ping().then(setSidecar, (e) => setSidecar(`error: ${e}`));
  }, []);

  // Auto-hide controls while playing; any pointer or key activity brings them back.
  useEffect(() => {
    setIdle(false);
    if (!playing || panel) return;
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, wake));
    return () => {
      clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [playing, panel]);

  const seek = (s: number) => {
    const t = Math.min(duration, Math.max(0, s));
    player.seek(t);
    setTime(t);
  };
  const togglePlay = () => {
    if (playing) player.pause();
    else {
      if (duration > 0 && player.time >= duration - 0.05 && !buffering) player.seek(0);
      player.play();
    }
    setPlaying(!playing);
  };
  const toggle = (name: "Sections" | "Ask") => {
    if (name === "Ask" && panel !== "Ask") interrupt(); // opening Ask interrupts
    setPanel((p) => (p === name ? null : name));
  };
  const interrupt = () => { player.pause(); setPlaying(false); };
  const submitQuestion = async (question: string) => {
    interrupt(); // typing/submitting always stops the video, even if it was resumed with the panel open
    askedAt.current = player.time;
    setTutor({ s: "loading" });
    annotateRef.current?.([]);
    try {
      // ponytail: transcript left empty until the timeline exposes words up to t; scene ids/types are enough to ground marks.
      const liveScene = player instanceof SceneQueue ? player.current?.scene : scene;
      const context = buildTutorContext({ objects: liveScene?.objects.map((o) => ({ id: o.id, type: o.type })) ?? [], transcript: "", section: section ?? liveScene?.scene ?? "", priorQuestions: priorQs.current });
      const r = await ask({ question, context, provider });
      priorQs.current.push(question);
      annotateRef.current?.(r.annotations);
      setTutor({ s: "answered", answer: r.answer });
    } catch {
      setTutor({ s: "error" });
    }
  };
  const resume = () => {
    annotateRef.current?.([]);
    setTutor({ s: "idle" });
    player.seek(resumeTime(player instanceof SceneQueue ? player.beatStarts : STARTS, askedAt.current));
    setTime(player.time);
    player.play();
    setPlaying(true);
    setPanel(null);
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

  return (
    <main className={`relative h-screen overflow-hidden bg-bg ${idle ? "cursor-none" : ""}`}>
      {(!stream || currentScene) && <Stage scene={currentScene?.scene ?? scene} timeline={currentScene?.timeline ?? timeline} drawRef={drawRef} annotateRef={annotateRef} timeRef={stream ? localTime : undefined} />}
      {buffering && <p role="status" aria-label="Buffering" className="absolute inset-x-0 top-16 text-center text-sm text-muted">Buffering…</p>}
      {progress && progress !== "done" && !playbackError && (!currentScene || buffering) && (
        <p role="status" aria-label="Generation progress" className="absolute inset-x-0 top-24 text-center text-sm text-muted">
          <ShinyText text={`${progress[0].toUpperCase()}${progress.slice(1)}…`} color={css("--fg-subtle")} shineColor={css("--fg")} />
        </p>
      )}
      {playbackError && <div className="absolute inset-x-0 top-24 z-10 text-center text-sm text-muted">
        <p role="alert">{playbackError}</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line px-4 py-2 text-fg hover:bg-fg/10">Try again</button>}
      </div>}

      <div data-idle={idle} className={`absolute inset-0 transition-opacity duration-300 ${idle ? "opacity-0" : "opacity-100"}`}>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-bg via-bg/60 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button type="button" aria-label="Back" onClick={onBack} className={iconBtn}>
            <Icon icon={ArrowLeft02Icon} />
          </button>
          <p role="status" className="px-2 text-xs text-subtle">
            {sidecar === null ? <ShinyText text="sidecar: ..." color={css("--fg-subtle")} shineColor={css("--fg")} /> : `sidecar: ${sidecar}`}
          </p>
        </div>

        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-8">
          <button type="button" aria-label="Back 10 seconds" onClick={() => seek(time - 10)} className={`${iconBtn} size-14`}>
            <Icon icon={GoBackward10SecIcon} size={32} />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlay}
            className="grid size-20 place-items-center rounded-full border border-line bg-fg/10 text-fg backdrop-blur-md transition-colors hover:bg-fg/20"
          >
            <Icon icon={playing ? PauseIcon : PlayIcon} size={30} className={`fill-current ${playing ? "" : "translate-x-0.5"}`} />
          </button>
          <button type="button" aria-label="Forward 10 seconds" onClick={() => seek(time + 10)} className={`${iconBtn} size-14`}>
            <Icon icon={GoForward10SecIcon} size={32} />
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 px-8 pb-6">
          <div className="flex items-end justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-sm font-medium text-subtle">{stream ? "Tangent" : "CS 251 · Heaps"}</p>
              <h1 className="mt-1 text-5xl font-semibold tracking-tight">{stream ? title ?? currentScene?.sceneId ?? "Video" : "Heapify"}</h1>
              {!stream && <p className="mt-2 line-clamp-2 text-base text-muted">
                How one broken spot in a heap gets fixed: the parent swaps with its bigger child, then we check again one level down.
              </p>}
            </div>
            <div className="flex gap-1">
              {(["Sections", "Ask"] as const).map((name) => (
                <button key={name} type="button" aria-label={name} aria-expanded={panel === name} onClick={() => toggle(name)} className={iconBtn}>
                  <Icon icon={name === "Sections" ? LeftToRightListBulletIcon : BubbleChatIcon} />
                </button>
              ))}
              <button type="button" aria-label="Toggle fullscreen" onClick={fullscreen} className={iconBtn}>
                <Icon icon={FullScreenIcon} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted tabular-nums">
            <span>{clock(time)}</span>
            <input
              type="range"
              aria-label="Seek"
              aria-valuetext={`${clock(time)} of ${clock(duration)}`}
              min={0}
              max={duration}
              step="any"
              value={time}
              onChange={(e) => seek(Number(e.target.value))}
              className="scrubber h-11 flex-1"
              style={{ "--p": `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
            />
            <span aria-label={`${clock(duration - time)} remaining`}>-{clock(duration - time)}</span>
          </div>
        </div>
      </div>

      {panel && (
        <Panel title={panel} onClose={close}>
          {panel === "Sections" ? (
            <AnimatedList
              items={SECTIONS}
              ariaLabel="Sections"
              initialSelectedIndex={active}
              currentIndex={active}
              onItemSelect={(_, i) => setActive(i)}
              frame={false}
              showGradients={false}
              width="100%"
              maxHeight="none"
              gap={4}
              radius={8}
              itemClassName="min-h-11 aria-[current=true]:[--al-tile:var(--surface-2)]"
              style={LIST_THEME}
              renderItem={(s, i) => (
                <>
                  <span className="w-5 text-sm text-subtle tabular-nums">{i + 1}</span>
                  <span className={`flex-1 ${i === active ? "text-fg" : "text-muted"}`}>{s as string}</span>
                  {i === active && <span className="text-xs text-subtle">Playing</span>}
                </>
              )}
            />
          ) : (
            <form
              className="flex flex-col gap-3 px-3"
              onSubmit={(e) => {
                e.preventDefault();
                const q = new FormData(e.currentTarget).get("q")?.toString().trim();
                e.currentTarget.reset();
                if (q) submitQuestion(q);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="ask" className="text-sm text-muted">Ask about this moment in the video</label>
              </div>
              <div className="flex gap-2">
                <input id="ask" name="q" autoFocus onFocus={interrupt} autoComplete="off" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-fg placeholder:text-subtle" placeholder="Why the bigger child?" />
                <button type="submit" aria-label="Send" className="grid size-11 place-items-center rounded-lg bg-accent text-bg hover:opacity-90">
                  <Icon icon={ArrowRight02Icon} size={20} />
                </button>
              </div>
              {tutor.s === "loading" && (
                <p role="status" aria-label="Thinking" className="text-sm text-muted">
                  <ShinyText text="Thinking..." color={css("--fg-subtle")} shineColor={css("--fg")} />
                </p>
              )}
              {tutor.s === "error" && (
                <p role="status" aria-label="Error" className="text-sm text-fg">The tutor couldn't answer. Try again.</p>
              )}
              {tutor.s === "answered" && (
                <>
                  <p aria-live="polite" className="text-base text-fg">{tutor.answer}</p>
                  <button type="button" onClick={resume} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-accent text-bg hover:opacity-90">
                    <Icon icon={PlayIcon} size={20} className="fill-current" />
                    Resume
                  </button>
                </>
              )}
            </form>
          )}
        </Panel>
      )}
    </main>
  );
}

function SectionSession({ id, ir, pdfPath, title, provider, onBack }: { id: string; ir: IR; pdfPath: string; title: string; provider?: LLMProvider; onBack: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<{ stream: AsyncIterable<PipelineEvent>; markdown: string } | null>(null);
  const [progress, setProgress] = useState<GenerationStatus>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setError(undefined);
    setProgress(undefined);
    void (async () => {
      try {
        const markdown = stripWatermarks(await sectionText(ir, id));
        if (controller.signal.aborted) return;
        const stream = startSession({ irSection: { markdown, figures: sectionFigures(ir, id) }, provider, signal: controller.signal,
          onStatus: status => { devlog(`status ${status}`); if (!controller.signal.aborted) setProgress(status); } });
        setSession({ markdown, stream: recordStream(stream, { title, source: { pdfPath, sectionId: id, sectionTitle: title } }, undefined, e => devlog(`video save failed ${String(e)}`)) });
      } catch (e) {
        if (!controller.signal.aborted) setError(String(e));
      }
    })();
    return () => controller.abort();
  }, [id, ir, pdfPath, title, provider, attempt]);
  const retry = () => { setSession(null); setAttempt(n => n + 1); };
  if (session) return <PlayerScreen provider={provider} stream={session.stream} section={session.markdown} title={title} progress={progress} autoPlay onRetry={retry} onBack={onBack} />;
  return <main className="flex h-screen flex-col items-center justify-center gap-4 bg-bg text-fg">
    <button type="button" onClick={onBack} className="absolute left-4 top-4 rounded-lg border border-line px-4 py-2">Back</button>
    {error ? <>
      <p role="alert">Couldn't start this section: {error}</p>
      <button type="button" onClick={retry} className="rounded-lg border border-line px-4 py-2 hover:bg-fg/10">Try again</button>
    </> : <p role="status"><ShinyText text="Reading section…" color={css("--fg-subtle")} shineColor={css("--fg")} /></p>}
  </main>;
}

function ReplayScreen({ video, provider, onBack }: { video: VideoBundle; provider?: LLMProvider; onBack: () => void }) {
  const [stream] = useState(() => replayStream(video));
  return <PlayerScreen provider={provider} stream={stream} section={video.title} title={video.title} autoPlay onBack={onBack} />;
}

// main.tsx opens Home; the default remains the demo for existing callers.
export default function App({ provider, initial = "player", stream }: { provider?: LLMProvider; initial?: "home" | "player"; stream?: AsyncIterable<PipelineEvent> }) {
  const [screen, setScreen] = useState<"home" | "player" | { id: string; ir: IR; pdfPath: string; title: string } | { replay: VideoBundle }>(initial);
  const back = () => setScreen("home");
  if (screen === "home") return <Home onStart={(id, ir, m) => setScreen({ id, ir, ...m })} onDemo={() => setScreen("player")} onOpenVideo={replay => setScreen({ replay })} />;
  if (typeof screen === "object" && "replay" in screen) return <ReplayScreen key={screen.replay.id} video={screen.replay} provider={provider} onBack={back} />;
  if (typeof screen === "object") return <SectionSession id={screen.id} ir={screen.ir} pdfPath={screen.pdfPath} title={screen.title} provider={provider} onBack={back} />;
  return <PlayerScreen provider={provider} stream={stream} onBack={back} />;
}
