import type { Scene } from "@motion/dsl/schema";
import type { Timeline } from "@motion/dsl/compile";
import type { PipelineEvent } from "@/pipeline/streamVideo";

export const SKIP_SEC = 2;
type SceneEvent = Extract<PipelineEvent, { type: "scene" }>;
/** A queue entry for a scene that failed twice: 2 s of silence, no beats (so no captions, narration or passages). */
export type SkipScene = SceneEvent & { skipped: true };
export const isSkip = (s?: { sceneId: string } | null): s is SkipScene => !!s && "skipped" in s;

// 8 kHz mono 8-bit silence: a real clip, so the queue's audio clock runs it like any scene and nothing in the clock changes.
let silence = "";
function silentWav(sec: number) {
  if (silence) return silence;
  const n = 8000 * sec, b = new Uint8Array(44 + n).fill(128), v = new DataView(b.buffer);
  "RIFF".split("").forEach((c, i) => b[i] = c.charCodeAt(0));
  "WAVEfmt ".split("").forEach((c, i) => b[8 + i] = c.charCodeAt(0));
  "data".split("").forEach((c, i) => b[36 + i] = c.charCodeAt(0));
  v.setUint32(4, 36 + n, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); v.setUint32(40, n, true);
  let bin = "";
  b.forEach(x => bin += String.fromCharCode(x));
  return silence = `data:audio/wav;base64,${btoa(bin)}`;
}

export const skipScene = (sceneId: string): SkipScene => ({
  type: "scene", sceneId, skipped: true, generationMs: 0, wavPath: silentWav(SKIP_SEC),
  scene: { scene: sceneId, beats: [] } as unknown as Scene,
  timeline: { events: [], totalSec: SKIP_SEC, insertedSilences: [] } satisfies Timeline,
});

/** Calm, plain card shown where a failed scene would have played. Fades only when motion is allowed. */
export default function SkipCard() {
  return (
    <div data-testid="skip-card" role="status" className="absolute inset-0 z-[4] grid place-items-center bg-bg motion-safe:animate-[fade-up_0.3s_ease-out]">
      <p className="text-lg text-muted">Skipping ahead…</p>
    </div>
  );
}
