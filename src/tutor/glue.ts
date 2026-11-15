import type { Timeline } from "@motion/dsl/compile";
import { DEFAULT_GAP_SEC } from "@motion/player/queue";
import type { LLMProvider } from "../llm/provider";

/** Start time (sec) of each spoken beat, ascending: the input resumeTime() wants. */
export { beatStarts } from "@motion/player/queue";

/** Default until a real provider (Ollama / Claude) is injected. */
export const stubProvider: LLMProvider = {
  complete: async () => JSON.stringify({ answer: "The tutor is not connected yet.", annotations: [] }),
};

/** Passage ids behind the spoken beat at the pause time, including the hold between scenes. */
export function currentPassageIds(scenes: { timeline: Timeline; passageIds?: string[][] }[], t: number): string[] {
  let offset = 0;
  let ids: string[] = [];
  for (const scene of scenes) {
    for (const event of scene.timeline.events) {
      if (event.verb === "say" && offset + event.start <= t + .01) ids = scene.passageIds?.[event.beat] ?? [];
    }
    offset += scene.timeline.totalSec + DEFAULT_GAP_SEC;
  }
  return ids;
}
