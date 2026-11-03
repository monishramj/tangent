import { useCallback, useEffect, useRef, useState } from "react";
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
import Panel from "./Panel";
import Stage from "./Stage";
import { Player } from "./player/player";
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

export default function App({ provider: injected }: { provider?: LLMProvider }) {
  const provider = injected ?? providers.claude; // ponytail: provider choice moves to a settings page later

  const [sidecar, setSidecar] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const drawRef = useRef<((t: number) => void) | null>(null);
  const annotateRef = useRef<((a: Annotation[]) => void) | null>(null);
  const priorQs = useRef<string[]>([]);
  const askedAt = useRef(0);
  // One clock: the <audio> element. The Player paces redraws from audio.currentTime.
  const [audio] = useState(() => Object.assign(new Audio(AUDIO_URL), { preload: "auto" }));
  const [player] = useState(() => new Player({ timeline, audio, render: (t) => {
    drawRef.current?.(t);
    setTime((p) => (Math.abs(p - t) < 0.1 ? p : t)); // don't re-render React at 60fps
  } }));
  useEffect(() => {
    const stop = () => { setPlaying(false); setTime(audio.currentTime); };
    audio.addEventListener("ended", stop);
    audio.addEventListener("pause", stop);
    return () => { audio.removeEventListener("ended", stop); audio.removeEventListener("pause", stop); player.pause(); };
  }, [audio, player]);
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
    const t = Math.min(DURATION, Math.max(0, s));
    player.seek(t);
    setTime(t);
  };
  const togglePlay = () => {
    if (playing) player.pause();
    else {
      if (player.time >= DURATION - 0.05) player.seek(0);
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
      const context = buildTutorContext({ objects: scene.objects.map((o) => ({ id: o.id, type: o.type })), transcript: "", section: "Heapify", priorQuestions: priorQs.current });
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
    player.seek(resumeTime(STARTS, askedAt.current));
    player.play();
    setPlaying(true);
    setPanel(null);
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

  return (
    <main className={`relative h-screen overflow-hidden bg-bg ${idle ? "cursor-none" : ""}`}>
      <Stage scene={scene} timeline={timeline} drawRef={drawRef} annotateRef={annotateRef} />

      <div data-idle={idle} className={`absolute inset-0 transition-opacity duration-300 ${idle ? "opacity-0" : "opacity-100"}`}>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-bg via-bg/60 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button type="button" aria-label="Back" className={iconBtn}>
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
              <p className="text-sm font-medium text-subtle">CS 251 · Heaps</p>
              <h1 className="mt-1 text-5xl font-semibold tracking-tight">Heapify</h1>
              <p className="mt-2 line-clamp-2 text-base text-muted">
                How one broken spot in a heap gets fixed: the parent swaps with its bigger child, then we check again one level down.
              </p>
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
              aria-valuetext={`${clock(time)} of ${clock(DURATION)}`}
              min={0}
              max={DURATION}
              step="any"
              value={time}
              onChange={(e) => seek(Number(e.target.value))}
              className="scrubber h-11 flex-1"
              style={{ "--p": `${(time / DURATION) * 100}%` } as React.CSSProperties}
            />
            <span aria-label={`${clock(DURATION - time)} remaining`}>-{clock(DURATION - time)}</span>
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
