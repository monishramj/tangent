import { generateScript, type Beat } from "../gen/script";
import { generateScene } from "../gen/scene";
import { mathToSpeech } from "../speech/mathToSpeech";
import { compileOps } from "../dsl/ops";
import type { Timeline, Word } from "../dsl/compile";
import type { LLMProvider } from "../llm/provider";
import type { Scene } from "../dsl/schema";

export type PipelineEvent =
  | { type: "scene"; sceneId: string; scene: Scene; timeline: Timeline; wavPath: string; generationMs: number }
  | { type: "error"; sceneId: string; error: Error };

export type GenerationStatus = "writing script" | "generating narration" | "building scenes" | "done";

type Options = {
  onStatus?: (status: GenerationStatus) => void;
  sectionMarkdown: string;
  provider: LLMProvider;
  ttsAlign: (text: string, options?: { signal?: AbortSignal; sceneId: string }) => Promise<{
    wavPath: string; sec: number; words: Word[];
  }>;
  concurrency?: number;
  signal?: AbortSignal;
  clock?: { now(): number };
};
type Status = "idle" | "buffering" | "ready" | "done" | "aborted";

export function streamVideo({ sectionMarkdown, provider, ttsAlign, concurrency = 2, signal, onStatus, clock = { now: () => Date.now() } }: Options) {
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
  let beats: Beat[] = [];

  async function build(beat: Beat, index: number): Promise<PipelineEvent> {
    const sceneId = `scene-${index + 1}`;
    const start = clock.now();
    let error = new Error("Scene generation failed");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        checkAbort();
        onStatus?.("generating narration");
        const spoken = mathToSpeech(beat.say);
        const audio = await Promise.race([ttsAlign(spoken, { sceneId, signal: controller.signal }), aborted]);
        checkAbort();
        if (!audio.wavPath?.trim() || !Number.isFinite(audio.sec) || audio.sec <= 0 || !audio.words.length)
          throw new Error("Invalid alignment audio");
        let end = 0;
        for (const word of audio.words) {
          if (!word.word.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end)
            || word.start < end || word.end < word.start || word.end > audio.sec)
            throw new Error("Invalid alignment word timestamps");
          end = word.end;
        }
        // The pipeline owns retries; suppress generateScene's additional model calls.
        onStatus?.("building scenes");
        let called = false;
        const result = await generateScene({
          section: JSON.stringify({ ...beat, instruction: "Preserve say exactly; return exactly one narrated beat and no reaction beats." }),
          provider: { complete(prompt, opts) {
            if (called) throw new Error("Invalid scene DSL");
            called = true;
            return complete.complete(prompt, opts);
          } },
        });
        checkAbort();
        const scene = result.scene;
        if (!scene) throw new Error("Invalid scene DSL");
        const narration = scene.beats[0];
        if (scene.beats.length !== 1 || !narration || !("say" in narration) || narration.say !== beat.say)
          throw new Error("Scene narration must match the script exactly");
        scene.scene = sceneId;
        narration.say = spoken;
        narration.actions = narration.actions.map(action => ({ ...action, at: mathToSpeech(action.at) }));
        const timeline = compileOps(scene, [{ words: audio.words, duration: audio.sec }]);
        return { type: "scene", sceneId, scene, timeline, wavPath: audio.wavPath, generationMs: clock.now() - start };
      } catch (cause) {
        checkAbort();
        error = cause instanceof Error ? cause : new Error(String(cause));
      }
    }
    return { type: "error", sceneId, error };
  }

  function fill() {
    // Retain lookahead even with one worker; a paused consumer bounds all prefetch.
    while (!controller.signal.aborted && active < concurrency && issued < beats.length
      && issued < cursor + Math.max(2, concurrency)) {
      const index = issued++;
      active++;
      const job = build(beats[index], index).then(event => {
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
      const script = await generateScript({ sectionMarkdown, provider: complete });
      if (!script.beats || script.violations.length) throw new Error("Invalid script");
      beats = script.beats;
      fill();
      while (cursor < beats.length) {
        const event = await Promise.race([jobs.get(cursor)!, aborted]);
        // Release a scene only after its successor is ready (except at EOF).
        if (cursor + 1 < beats.length) await Promise.race([jobs.get(cursor + 1)!, aborted]);
        checkAbort();
        ready.delete(cursor);
        jobs.delete(cursor++);
        fill();
        yield event;
      }
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
