import { invoke } from "@tauri-apps/api/core";
import type { Scene } from "@motion/dsl/schema";
import type { Timeline } from "@motion/dsl/compile";
import type { PipelineEvent } from "../pipeline/streamVideo";
import type { Checkpoint } from "../gen/checkpoints";
import type { DetailLevel } from "../gen/script";

export type StoredScene = { sceneId: string; scene: Scene; timeline: Timeline; audioFile: string; durationSec: number };
export type VideoBundle = {
  id: string; title: string; createdAt: number; complete: boolean;
  source: { pdfPath: string; sectionId: string; sectionTitle: string };
  scenes: StoredScene[];
  checkpoints?: Checkpoint[];
  detail?: DetailLevel; // how granular the script was (overview … complete)
};
/** audioFile is a temp path when saving and an absolute app-data path when loaded. */
export type VideoStore = {
  save(b: VideoBundle): Promise<VideoBundle>;
  list(): Promise<VideoBundle[]>;
  load(id: string): Promise<VideoBundle>;
  remove(id: string): Promise<void>;
};

export const tauriVideoStore: VideoStore = {
  save: bundle => invoke("save_video_bundle", { bundle }),
  list: async () => { const r = await invoke<unknown>("list_video_bundles"); return Array.isArray(r) ? r as VideoBundle[] : []; },
  load: id => invoke("load_video_bundle", { id }),
  remove: id => invoke("delete_video_bundle", { id }),
};

/** In-memory stand-in with the same contract (audioFile resolved to videos/<id>/<sceneId>.wav). */
export function fakeVideoStore(seed: VideoBundle[] = []): VideoStore & { bundles: Map<string, VideoBundle> } {
  const bundles = new Map(seed.map(b => [b.id, b]));
  const resolved = (b: VideoBundle): VideoBundle => structuredClone({ ...b, scenes: b.scenes.map(s => ({ ...s, audioFile: `/data/videos/${b.id}/${s.sceneId}.wav` })) });
  return {
    bundles,
    async save(b) { const r = resolved(b); bundles.set(b.id, r); return structuredClone(r); },
    async list() { return [...bundles.values()].sort((a, b) => b.createdAt - a.createdAt).map(b => structuredClone(b)); },
    async load(id) { const b = bundles.get(id); if (!b) throw new Error(`no video ${id}`); return structuredClone(b); },
    async remove(id) { bundles.delete(id); },
  };
}

export const videoDuration = (b: VideoBundle) => b.scenes.reduce((n, s) => n + s.durationSec, 0);

type SceneEvent = Extract<PipelineEvent, { type: "scene" }>;

/**
 * Tee a pipeline stream into the store: save after every scene (so a partial watch survives),
 * mark complete only if the stream ends cleanly with no scene errors. Save failures never break playback.
 */
export function recordStream(stream: AsyncIterable<PipelineEvent>, meta: { id?: string; title: string; source: VideoBundle["source"]; detail?: DetailLevel }, store: VideoStore = tauriVideoStore, onError: (e: unknown) => void = () => {}): AsyncIterable<PipelineEvent> {
  const bundle: VideoBundle = { id: meta.id ?? `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, title: meta.title, detail: meta.detail, createdAt: Date.now(), complete: false, source: meta.source, scenes: [] };
  let chain: Promise<unknown> = Promise.resolve();
  const persist = () => { const snap = structuredClone(bundle); chain = chain.then(() => store.save(snap)).catch(onError); return chain; };
  return (async function* () {
    let clean = true;
    let finished = false;
    try {
      for await (const ev of stream) {
        if (ev.type === "scene") {
          const e: SceneEvent = ev;
          bundle.scenes.push({ sceneId: e.sceneId, scene: e.scene, timeline: e.timeline, audioFile: e.wavPath, durationSec: e.timeline.totalSec });
          void persist();
        } else if (ev.type === "checkpoints") { bundle.checkpoints = ev.items; void persist(); }
        else clean = false;
        yield ev;
      }
      finished = true;
    } finally {
      if (finished && clean && bundle.scenes.length) { bundle.complete = true; void persist(); }
    }
  })();
}

/** Stored scenes as pipeline events: no LLM, no TTS. */
export async function* replayStream(b: VideoBundle): AsyncGenerator<PipelineEvent> {
  for (const s of b.scenes) yield { type: "scene", sceneId: s.sceneId, scene: s.scene, timeline: s.timeline, wavPath: s.audioFile, generationMs: 0 };
  if (b.checkpoints?.length) yield { type: "checkpoints", items: b.checkpoints };
}
