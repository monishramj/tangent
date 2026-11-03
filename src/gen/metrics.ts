import type { LLMProvider } from "../llm/provider";
import { generateScene, type GenerationResult } from "./scene";

/** Final validity after at most two retries; rate is a fraction from 0 to 1. */
export async function measureSections({ sections, provider }: { sections: readonly string[]; provider: LLMProvider }) {
  const results: GenerationResult[] = [];
  for (const section of sections) results.push(await generateScene({ section, provider }));
  const total = results.length;
  const valid = results.filter(result => result.scene !== null).length;
  const totalAttempts = results.reduce((sum, result) => sum + result.attempts, 0);
  return { total, valid, validityRate: total ? valid / total : 0, totalAttempts, averageAttempts: total ? totalAttempts / total : 0, results };
}
