// The hand-written heapify scene + real Kokoro alignment + the concatenated narration clip (public/demo/heapify.wav:
// s0, 0.25s, s3, 0.25s, 2s reaction silence; same layout the compiler produces).
import heapify from "@/dsl/fixtures/heapify.json";
import kokoro from "@/dsl/fixtures/heapify.kokoro.json";
import { compileOps } from "@/dsl/ops";
import { Scene } from "@/dsl/schema";

export const scene = Scene.parse(heapify);
export const timeline = compileOps(scene, [kokoro[0], kokoro[1], undefined]);
export const AUDIO_URL = "/demo/heapify.wav";
