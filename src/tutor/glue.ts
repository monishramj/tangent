import type { LLMProvider } from "../llm/provider";

/** Start time (sec) of each spoken beat, ascending: the input resumeTime() wants. */
export { beatStarts } from "@motion/player/queue";

/** Default until a real provider (Ollama / Claude) is injected. */
export const stubProvider: LLMProvider = {
  complete: async () => JSON.stringify({ answer: "The tutor is not connected yet.", annotations: [] }),
};
