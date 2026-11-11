// The hand-written heapify scene + real Alba alignment + the concatenated narration clip (public/demo/heapify.wav:
// speech beat 0, 0.25s, speech beat 1, 0.25s, 2s reaction silence; same layout the compiler produces).
import heapify from "../dsl/fixtures/heapify.json";
import alba from "../dsl/fixtures/heapify.alba.json";
import { compileOps } from "../dsl/ops";
import { Scene } from "../dsl/schema";

export const scene = Scene.parse(heapify);
export const timeline = compileOps(scene, [alba[0], alba[1], undefined]);
export const AUDIO_URL = "/demo/heapify.wav";
