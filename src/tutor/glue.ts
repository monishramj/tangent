import type { Timeline } from "../dsl/compile";
import type { LLMProvider } from "../llm/provider";

/** Start time (sec) of each spoken beat, ascending: the input resumeTime() wants. */
export const beatStarts = (tl: Timeline) => tl.events.filter((e) => e.verb === "say").map((e) => e.start).sort((a, b) => a - b);

/** Default until a real provider (Ollama / Claude) is injected. */
export const stubProvider: LLMProvider = {
  complete: async () => JSON.stringify({ answer: "The tutor is not connected yet.", annotations: [] }),
};
