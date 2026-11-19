import { factCheckBeats } from "../gen/factCheck";
import { generateScript, type ScriptResult, type Beat, type DetailLevel } from "../gen/script";
import { generateGroupScene, recentFor } from "../gen/scene";
import { chunkBeats, type Figure, type ScenePlan } from "../gen/plan";
import { generateCheckpoints, type Checkpoint, type Exercise } from "../gen/checkpoints";
import { resolveGifs, type GifSearch } from "../media/giphy";
import { splitBeatAudio, type Segment } from "./splitAudio";
import { mathToSpeech } from "../speech/mathToSpeech";
import { compileOps } from "@motion/dsl/ops";
import { resolveAnchor, type Timeline, type Word } from "@motion/dsl/compile";
import { boxesFor } from "../follow/passages";
import { citedSources, oneSourceText, sceneSourceIds } from "../gen/sources";
import type { BeatBoxes, Passage } from "../follow/types";
import type { LLMProvider } from "../llm/provider";
import { FRACTION_ANCHOR, type Scene } from "@motion/dsl/schema";
import { devlog } from "../devlog";

export type PipelineEvent =
  | { type: "scene"; sceneId: string; scene: Scene; timeline: Timeline; wavPath: string; generationMs: number; factCheck?: "checked" | "unchecked"; passages?: BeatBoxes; passageIds?: string[][]; sourceIds?: string[] }
  /** scope "scene": this scene failed its retry too, so the player shows a skip card in its place. "script": part 2 of the script failed (nothing to skip over). */
  | { type: "error"; sceneId: string; error: Error; scope?: "scene" | "script" }
  | { type: "checkpoints"; items: Checkpoint[] };

/** Real generation progress for the loading UI: which step scene `scene` is on, and how many scenes are ready. */
/** "formulas" is set by the caller (App) while the section's formulas decode, before the pipeline starts. */
export type Progress = { step: "formulas" | "script" | "narration" | "animation" | "ready"; scene: number; scenesReady: number; scenesTotal: number; beats: string[]; formulas?: number };

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
  /** Source blocks; passage ids are `sourceId/passageId` only with multiple sources. */
  sources?: { id: string; markdown: string }[];
  exercises?: Exercise[];
  /** How much of the section the script covers (see DetailLevel). */
  detail?: DetailLevel;
  gifSearch?: GifSearch | null;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  clock?: { now(): number };
  /** Fact-check each scene against its source. Production sessions enable this; direct callers opt in. */
  factCheck?: boolean;
};
type Status = "idle" | "buffering" | "ready" | "done" | "aborted";

export function streamVideo({ sectionMarkdown, provider, ttsAlign, concurrency = 3, lookahead = 3, figures = [], passages = [], sources, exercises = [], detail = "standard", gifSearch = null, onProgress, signal, onStatus, clock = { now: () => Date.now() }, factCheck = false }: Options) {
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
  const providerWithSignal = (signal: AbortSignal): LLMProvider => ({
    complete(prompt, opts) {
      checkAbort();
      signal.throwIfAborted();
      return Promise.race([provider.complete(prompt, { ...opts, signal }), aborted]);
    },
  });
  const complete = providerWithSignal(controller.signal);
  const jobs = new Map<number, Promise<PipelineEvent>>();
  const ready = new Map<number, PipelineEvent>();
  let started = 0;
  let cursor = 0;
  let issued = 0;
  let active = 0;
  let groups: { beats: Beat[]; plan: ScenePlan }[] = [];
  let failedScenes = 0;
  let ready_ = 0, says: string[] = [];
  const progress = (step: Progress["step"], scene: number) => onProgress?.({ step, scene, scenesReady: ready_, scenesTotal: groups.length, beats: says });

  const FACT_WAIT_MS = 20_000;
  async function checkScene(beats: Beat[], index: number) {
    const check = new AbortController();
    const abort = () => check.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    controller.signal.addEventListener("abort", abort, { once: true });
    try {
      return await Promise.race([
        factCheckBeats({ beats, sources: passages.length ? passages : [{ id: "section", markdown: sectionMarkdown }], provider: providerWithSignal(check.signal) }).catch(() => null),
        new Promise<null>(resolve => { timer = setTimeout(() => { resolve(null); abort(); }, index === 0 ? 8_000 : FACT_WAIT_MS); }),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
    }
  }

  async function build({ beats: initial, plan }: { beats: Beat[]; plan: ScenePlan }, index: number): Promise<PipelineEvent> {
    let beats = initial;
    // Bound the whole check (including repairs), rather than adding a fresh wait after TTS.
    let verdict = factCheck ? checkScene(beats, index) : undefined;
    void verdict?.catch(() => {});
    let checkStatus: "checked" | "unchecked" | undefined;
    async function applyCheck() {
      if (!verdict) return false;
      const r = await verdict;
      verdict = undefined;
      checkStatus = r?.checked ? "checked" : "unchecked";
      if (r) {
        beats = r.beats;
        if (r.log.length) devlog(`fact-check scene ${index + 1}: ${r.log.join("; ")}`);
      } else devlog(`fact-check scene ${index + 1}: unchecked (timed out or failed; numeric gate only)`);
      return r?.sayChanged ?? false;
    }
    const sceneId = `scene-${index + 1}`;
    const start = clock.now();
    let error = new Error("Scene generation failed");
    let audio: Awaited<ReturnType<Options["ttsAlign"]>> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        checkAbort();
        onStatus?.("generating narration");
        progress("narration", index);
        if (index > 0) await applyCheck();
        let spoken = beats.map(beat => mathToSpeech(beat.say));
        // One wav per scene, one segment per beat: the sidecar puts a pause after each beat and reports
        // where each beat starts, so clips are cut on real boundaries.
        // Audio survives a failed scene attempt; only the DSL is retried.
        audio ??= await Promise.race([ttsAlign(spoken, { sceneId, signal: controller.signal }), aborted]);
        if (await applyCheck()) {
          spoken = beats.map(beat => mathToSpeech(beat.say));
          // Scene 1 overlaps checking and narration for TTFF; a rewrite needs matching audio.
          audio = undefined;
          audio = await Promise.race([ttsAlign(spoken, { sceneId, signal: controller.signal }), aborted]);
        }
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
        const sourceIdsKnown = new Set((sources ?? []).map(s => s.id));
        const perBeatSource = sourceIdsKnown.size > 1 ? beats.map(b => oneSourceText(b, passages, sourceIdsKnown)) : undefined;
        const result = await generateGroupScene({ beats, plan, figures, provider: complete, sceneNo: index + 1, recent: recentFor(groups.slice(0, index).map(g => g.plan)), source: perBeatSource ? undefined : sectionMarkdown, perBeatSource });
        checkAbort();
        const scene = result.scene;
        if (!scene) throw new Error(`Invalid scene DSL: ${result.errors[result.errors.length - 1]?.[0]?.message ?? "unknown"}`);
        await Promise.race([resolveGifs(scene, gifSearch, controller.signal), aborted]);
        checkAbort();
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
        groups[index].beats = beats;
        ready_++; progress("ready", index);
        if (index === 0) devlog(`generation: first-scene-ready +${clock.now() - started}ms`);
        const sourceIds = sceneSourceIds(beats, (sources ?? []).map(s => s.id));
        return { type: "scene", sceneId, scene, timeline, wavPath: audio.wavPath, generationMs: clock.now() - start,
          ...(checkStatus ? { factCheck: checkStatus } : {}),
          // Aligned with scene.beats (like `spoken`); absent when the IR has no passages.
          ...(passages.length ? { passages: beats.map(b => boxesFor(b.passages ?? [], passages)), passageIds: beats.map(b => b.passages ?? []) } : {}),
          ...(sourceIds ? { sourceIds } : {}) };
      } catch (cause) {
        checkAbort();
        error = cause instanceof Error ? cause : new Error(String(cause));
      }
    }
    failedScenes++;
    devlog(`generation: ${sceneId} skipped after retry (${failedScenes} this session): ${error.message}`);
    return { type: "error", sceneId, error, scope: "scene" };
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
      started = clock.now();
      devlog("generation: script-part-1-start +0ms");
      const valid = (script: ScriptResult) => {
        if (!script.beats || script.violations.length) throw new Error("Invalid script: " + script.violations.slice(0, 5).map(v => `beat ${v.beat} ${v.rule}: ${v.message}`).join(" | "));
        return script.beats;
      };
      const opening = await generateScript({ sectionMarkdown, provider: complete, detail, passages, sources, part: "opening" });
      const beats = valid(opening);
      devlog(`generation: script-part-1-ready +${clock.now() - started}ms`);
      says = beats.map(b => b.say);
      groups = chunkBeats(beats).map(plan => ({ plan, beats: beats.slice(plan.start, plan.start + plan.count) }));
      fill();
      let scriptDone = false;
      let continuationError: PipelineEvent | undefined;
      // Part 2 overlaps scene 1, including TTS; it can never reject an already playing scene.
      const continuation = (async () => {
        devlog(`generation: script-part-2-start +${clock.now() - started}ms`);
        let script: ScriptResult | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            script = await generateScript({ sectionMarkdown, provider: complete, detail, passages, sources, part: { previous: beats, outline: opening.outline! } });
            break;
          } catch (error) {
            checkAbort();
            if (attempt === 1) throw error;
          }
        }
        const rest = valid(script!);
        const offset = beats.length;
        says = [...says, ...rest.map(b => b.say)];
        groups.push(...chunkBeats(rest).map(plan => ({ plan: { ...plan, start: plan.start + offset }, beats: rest.slice(plan.start, plan.start + plan.count) })));
        devlog(`generation: script-part-2-ready +${clock.now() - started}ms`);
        fill();
      })().catch(cause => {
        continuationError = { type: "error", sceneId: `scene-${groups.length + 1}`, error: cause instanceof Error ? cause : new Error(String(cause)), scope: "script" };
        devlog(`generation: script-part-2-failed +${clock.now() - started}ms`);
      }).finally(() => { scriptDone = true; });
      // Wait for the full scene list for checkpoints, without delaying any playable scene.
      let checkpoints: Checkpoint[] | null = null, sent = false;
      // With fact checking enabled, wait for repairs/cuts so checks use the narration that actually shipped.
      let releaseChecks = () => {};
      const narrationReady = factCheck ? new Promise<void>(resolve => { releaseChecks = resolve; }) : Promise.resolve();
      const knownSources = new Set((sources ?? []).map(s => s.id));
      const pending = continuation.then(() => narrationReady).then(() => generateCheckpoints({ sectionMarkdown, exercises, figures,
        scenes: groups.map(g => g.beats.map(b => b.say).join(" ")),
        passages: passages.filter(p => groups.some(g => g.beats.some(b => b.passages?.includes(p.id)))),
        sceneSources: knownSources.size > 1 ? groups.map(g => {
          const ids = g.beats.map(b => citedSources(b, knownSources));
          return ids.length && ids.every(x => x.length === 1 && x[0] === ids[0][0]) ? [ids[0][0]] : [];
        }) : undefined,
        provider: complete }))
        .then(items => { checkpoints = items; }, () => { checkpoints = []; });
      while (cursor < groups.length || !scriptDone) {
        if (cursor === groups.length) {
          await Promise.race([continuation, aborted]);
          checkAbort();
          if (cursor === groups.length) break;
        }
        const event = await Promise.race([jobs.get(cursor)!, aborted]);
        checkAbort();
        ready.delete(cursor);
        jobs.delete(cursor++);
        fill();
        yield event;
        if (checkpoints && !sent) { sent = true; yield { type: "checkpoints", items: checkpoints }; }
      }
      releaseChecks();
      if (continuationError) yield continuationError;
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
    /** Scenes that failed their retry this session (each becomes a skip card). */
    failedScenes() { return failedScenes; },
    bufferedAhead() { return ready.size; },
    status(): Status {
      return state === "buffering" && ready.has(cursor) ? "ready" : state;
    },
  };
}
