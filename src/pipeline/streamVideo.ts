import { generateScript, type Beat, type DetailLevel } from "../gen/script";
import { generateGroupScene, recentFor } from "../gen/scene";
import { chunkBeats, type Figure, type ScenePlan } from "../gen/plan";
import { generateCheckpoints, type Checkpoint, type Exercise } from "../gen/checkpoints";
import { resolveGifs, type GifSearch } from "../media/giphy";
import { splitBeatAudio, type Segment } from "./splitAudio";
import { mathToSpeech } from "../speech/mathToSpeech";
import { compileOps } from "@motion/dsl/ops";
import { resolveAnchor, type Timeline, type Word } from "@motion/dsl/compile";
import { boxesFor } from "../follow/passages";
import type { BeatBoxes, Passage } from "../follow/types";
import type { LLMProvider } from "../llm/provider";
import { FRACTION_ANCHOR, type Scene } from "@motion/dsl/schema";

export type PipelineEvent =
  | { type: "scene"; sceneId: string; scene: Scene; timeline: Timeline; wavPath: string; generationMs: number; passages?: BeatBoxes }
  | { type: "error"; sceneId: string; error: Error }
  | { type: "checkpoints"; items: Checkpoint[] };

/** Real generation progress for the loading UI: which step scene `scene` is on, and how many scenes are ready. */
export type Progress = { step: "script" | "narration" | "animation" | "ready"; scene: number; scenesReady: number; scenesTotal: number; beats: string[] };

export type GenerationStatus = "writing script" | "generating narration" | "building scenes" | "done";

type Options = {
  onStatus?: (status: GenerationStatus) => void;
  sectionMarkdown: string;
  provider: LLMProvider;
  /**
   * Synthesize one scene WAV from its spoken beats (one segment each, separated by a short silence)
   * and return word times plus each segment's {start, end}, all on that WAV's clock.
   */
  ttsAlign: (segments: string[], options?: { signal?: AbortSignal; sceneId: string }) => Promise<{
    wavPath: string; sec: number; words: Word[]; segments: Segment[];
  }>;
  concurrency?: number;
  /** Scenes allowed to be in flight or ready beyond the one being played. */
  lookahead?: number;
  figures?: Figure[];
  /** Source blocks with page boxes (textbook follow-along); beats name them and scenes carry their boxes. */
  passages?: Passage[];
  exercises?: Exercise[];
  /** How much of the section the script covers (see DetailLevel). */
  detail?: DetailLevel;
  gifSearch?: GifSearch | null;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  clock?: { now(): number };
};
type Status = "idle" | "buffering" | "ready" | "done" | "aborted";

export function streamVideo({ sectionMarkdown, provider, ttsAlign, concurrency = 3, lookahead = 3, figures = [], passages = [], exercises = [], detail = "standard", gifSearch = null, onProgress, signal, onStatus, clock = { now: () => Date.now() } }: Options) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const controller = new AbortController();
  let state: Status = "idle";
  const abortError = () => new DOMException("Video generation aborted", "AbortError");
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  controller.signal.addEventListener("abort", () => rejectAbort(abortError()), { once: true });
  const onAbort = () => {
    state = "aborted";
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const checkAbort = () => { if (controller.signal.aborted) throw abortError(); };
  const complete: LLMProvider = {
    complete(prompt, opts) {
      checkAbort();
      return Promise.race([provider.complete(prompt, { ...opts, signal: controller.signal }), aborted]);
    },
  };
  const jobs = new Map<number, Promise<PipelineEvent>>();
  const ready = new Map<number, PipelineEvent>();
  let cursor = 0;
  let issued = 0;
  let active = 0;
  let groups: { beats: Beat[]; plan: ScenePlan }[] = [];
  let ready_ = 0, says: string[] = [];
  const progress = (step: Progress["step"], scene: number) => onProgress?.({ step, scene, scenesReady: ready_, scenesTotal: groups.length, beats: says });

  async function build({ beats, plan }: { beats: Beat[]; plan: ScenePlan }, index: number): Promise<PipelineEvent> {
    const sceneId = `scene-${index + 1}`;
    const start = clock.now();
    let error = new Error("Scene generation failed");
    let audio: Awaited<ReturnType<Options["ttsAlign"]>> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        checkAbort();
        onStatus?.("generating narration");
        progress("narration", index);
        const spoken = beats.map(beat => mathToSpeech(beat.say));
        // One wav per scene, one segment per beat: the sidecar puts a pause after each beat and reports
        // where each beat starts, so clips are cut on real boundaries.
        // Audio survives a failed scene attempt; only the DSL is retried.
        audio ??= await Promise.race([ttsAlign(spoken, { sceneId, signal: controller.signal }), aborted]);
        checkAbort();
        if (!audio.wavPath?.trim() || !Number.isFinite(audio.sec) || audio.sec <= 0 || !audio.words.length)
          { audio = undefined; throw new Error("Invalid alignment audio"); }
        let end = 0;
        for (const word of audio.words) {
          if (!word.word.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end)
            || word.start < end || word.end < word.start || word.end > audio.sec)
            { audio = undefined; throw new Error("Invalid alignment word timestamps"); }
          end = word.end;
        }
        if (audio.segments?.length !== spoken.length) { audio = undefined; throw new Error("Invalid alignment segments"); }
        end = 0;
        for (const seg of audio.segments) {
          if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end) || seg.start < end || seg.end < seg.start || seg.end > audio.sec + 1e-6)
            { audio = undefined; throw new Error("Invalid alignment segments"); }
          end = seg.end;
        }
        const clips = splitBeatAudio(spoken, audio);
        onStatus?.("building scenes");
        progress("animation", index);
        const result = await generateGroupScene({ beats, plan, figures, provider: complete, sceneNo: index + 1, recent: recentFor(groups.slice(0, index).map(g => g.plan)), source: sectionMarkdown });
        checkAbort();
        const scene = result.scene;
        if (!scene) throw new Error(`Invalid scene DSL: ${result.errors[result.errors.length - 1]?.[0]?.message ?? "unknown"}`);
        await resolveGifs(scene, gifSearch);
        scene.scene = sceneId;
        scene.beats.forEach((beat, i) => {
          if (!("say" in beat)) return;
          beat.say = spoken[i];
          beat.actions = beat.actions.map(action => FRACTION_ANCHOR.test(action.at) ? action : ({ ...action, at: mathToSpeech(action.at) }));
        });
        // Anchors the TTS spoke differently (e.g. "LEGv 8" vs "LEGv eight"): snap to a token that was spoken, else the word at the same relative position.
        scene.beats.forEach((beat, i) => {
          if (!("say" in beat)) return;
          const words = clips[i]?.words ?? [];
          beat.actions = beat.actions.map(action => {
            if (resolveAnchor(words, action.at) >= 0 || !words.length) return action;
            const token = action.at.split(/\s+/).find(t => resolveAnchor(words, t) >= 0);
            if (token) return { ...action, at: token };
            const idx = Math.min(words.length - 1, Math.floor(Math.max(0, beat.say.toLowerCase().indexOf(action.at.toLowerCase())) / beat.say.length * words.length));
            return { ...action, at: words[idx].word };
          });
        });
        // pause 0: beats are contiguous slices of the single wav (each clip already ends with its pause).
        const timeline = compileOps(scene, clips, 0);
        ready_++; progress("ready", index);
        return { type: "scene", sceneId, scene, timeline, wavPath: audio.wavPath, generationMs: clock.now() - start,
          // Aligned with scene.beats (like `spoken`); absent when the IR has no passages.
          ...(passages.length ? { passages: beats.map(b => boxesFor(b.passages ?? [], passages)) } : {}) };
      } catch (cause) {
        checkAbort();
        error = cause instanceof Error ? cause : new Error(String(cause));
      }
    }
    return { type: "error", sceneId, error };
  }

  function fill() {
    // Window = the scene being awaited plus `lookahead` after it; a paused consumer bounds all prefetch.
    while (!controller.signal.aborted && active < concurrency && issued < groups.length
      && issued <= cursor + lookahead) {
      const index = issued++;
      active++;
      const job = build(groups[index], index).then(event => {
        ready.set(index, event);
        return event;
      }).finally(() => { active--; fill(); });
      jobs.set(index, job);
      void job.catch(() => {});
    }
  }

  async function* run(): AsyncGenerator<PipelineEvent, void, unknown> {
    try {
      checkAbort();
      onStatus?.("writing script");
      progress("script", 0);
      const script = await generateScript({ sectionMarkdown, provider: complete, detail, passages });
      if (!script.beats || script.violations.length) throw new Error("Invalid script: " + script.violations.slice(0, 5).map(v => `beat ${v.beat} ${v.rule}: ${v.message}`).join(" | "));
      const beats = script.beats;
      says = beats.map(b => b.say);
      groups = chunkBeats(beats, 4, 3).map(plan => ({ plan, beats: beats.slice(plan.start, plan.start + plan.count) }));
      fill();
      // Checkpoints are one side call; they never delay a scene and failure just means none.
      let checkpoints: Checkpoint[] | null = null, sent = false;
      const pending = generateCheckpoints({ sectionMarkdown, exercises, figures, scenes: groups.map(g => g.plan.concept), provider: complete })
        .then(items => { checkpoints = items; }, () => { checkpoints = []; });
      while (cursor < groups.length) {
        const event = await Promise.race([jobs.get(cursor)!, aborted]);
        checkAbort();
        ready.delete(cursor);
        jobs.delete(cursor++);
        fill();
        yield event;
        if (checkpoints && !sent) { sent = true; yield { type: "checkpoints", items: checkpoints }; }
      }
      if (!sent) { await Promise.race([pending, aborted]); yield { type: "checkpoints", items: checkpoints ?? [] }; }
    } finally {
      if (state !== "aborted") { state = "done"; onStatus?.("done"); }
      controller.abort();
      signal?.removeEventListener("abort", onAbort);
      ready.clear();
      jobs.clear();
    }
  }
  const generator = run();
  return {
    next() {
      if (state === "idle") state = "buffering";
      return generator.next();
    },
    return() {
      if (state !== "aborted") state = "done";
      controller.abort();
      signal?.removeEventListener("abort", onAbort);
      return generator.return();
    },
    [Symbol.asyncIterator]() { return this; },
    bufferedAhead() { return ready.size; },
    status(): Status {
      return state === "buffering" && ready.has(cursor) ? "ready" : state;
    },
  };
}
