import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { z } from "zod";

/** Silence the sidecar puts after every beat but the last (s). Scene-to-scene pauses come from SceneQueue.gapSec. */
export const BEAT_GAP_SEC = 0.45;

const span = z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() });
const alignment = z.object({
  wav_path: z.string().min(1),
  sec: z.number().positive(),
  words: z.array(z.object({ word: z.string().min(1), start: z.number().nonnegative(), end: z.number().nonnegative() })).min(1),
  segments: z.array(span).min(1),
});

/**
 * One WAV per scene: each segment (spoken beat) is synthesized separately and joined with `gapSec` of silence.
 * Returns word times and each segment's {start, end} on the WAV's clock.
 * Temp WAVs are played through the scoped Tauri asset protocol (SceneQueue converts the path).
 */
export async function sidecarTts(segments: string[], options?: { signal?: AbortSignal; sceneId: string; gapSec?: number }) {
  const checkAbort = () => {
    if (options?.signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
  };
  checkAbort();
  if (!segments.length || segments.some(s => !s.trim())) throw new Error("TTS segments must not be empty");
  const outPath = await join(await tempDir(), `tangent-${crypto.randomUUID()}.wav`);
  checkAbort();
  const response = await invoke<unknown>("sidecar_call", {
    method: "tts_align",
    params: { segments, out_path: outPath, voice: "alba", gap_sec: options?.gapSec ?? BEAT_GAP_SEC },
    timeoutMs: 300_000,
  });
  checkAbort();
  const audio = alignment.parse(response);
  if (audio.wav_path !== outPath) throw new Error("TTS returned an unexpected WAV path");
  if (audio.segments.length !== segments.length) throw new Error("TTS returned the wrong number of segments");
  // shortcut: temp WAVs live until OS cleanup; add session cleanup when sessions own saved assets.
  return { wavPath: audio.wav_path, sec: audio.sec, words: audio.words, segments: audio.segments }; // raw path: the player converts it, and save copies it
}
