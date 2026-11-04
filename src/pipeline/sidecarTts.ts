import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { z } from "zod";

const alignment = z.object({
  wav_path: z.string().min(1),
  sec: z.number().positive(),
  words: z.array(z.object({ word: z.string().min(1), start: z.number().nonnegative(), end: z.number().nonnegative() })).min(1),
});

/** Temp WAVs are played through the scoped Tauri asset protocol (SceneQueue converts the path). */
export async function sidecarTts(text: string, options?: { signal?: AbortSignal; sceneId: string }) {
  const checkAbort = () => {
    if (options?.signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
  };
  checkAbort();
  if (!text.trim()) throw new Error("TTS text must not be empty");
  const outPath = await join(await tempDir(), `tangent-${crypto.randomUUID()}.wav`);
  checkAbort();
  const response = await invoke<unknown>("sidecar_call", {
    method: "tts_align", params: { text, out_path: outPath, voice: "af_heart" }, timeoutMs: 300_000,
  });
  checkAbort();
  const audio = alignment.parse(response);
  if (audio.wav_path !== outPath) throw new Error("TTS returned an unexpected WAV path");
  // shortcut: temp WAVs live until OS cleanup; add session cleanup when sessions own saved assets.
  return { wavPath: audio.wav_path, sec: audio.sec, words: audio.words }; // raw path: the player converts it, and save copies it
}
