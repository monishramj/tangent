import { z } from "zod";
import type { LLMProvider } from "../llm/provider";
import type { Beat } from "./script";

/** A section figure offered to the model; src is what a `figure` object must use. */
export type Figure = { id: string; caption: string; src: string };
/** `count` consecutive beats starting at beat `start`, built as one scene around one concept. */
export type ScenePlan = { start: number; count: number; concept: string; visualPlan: string };

const MAX_GROUP = 6;
const MIN_GROUP = 3;
const Plan = z.array(z.object({ count: z.number().int().min(1).max(MAX_GROUP), concept: z.string().min(1), visualPlan: z.string().min(1) })).min(1);

export const figuresPrompt = (figures: Figure[]) => figures.length
  ? `Available figure assets (use as a figure object with exactly this src, never invent one):\n${JSON.stringify(figures)}`
  : "No figure assets are available; do not use figure objects.";

function withStarts(groups: { count: number; concept: string; visualPlan: string }[]): ScenePlan[] {
  let start = 0;
  return groups.map(g => { const plan = { ...g, start }; start += g.count; return plan; });
}

/** Deterministic grouping: a short first scene (fast first frame), then chunks of `size`; a short remainder merges back. */
export function chunkBeats(beats: Beat[], size = 4, first = size): ScenePlan[] {
  const counts: number[] = [];
  for (let i = 0; i < beats.length; i += counts[counts.length - 1]) counts.push(Math.min(counts.length ? size : first, beats.length - i));
  if (counts.length > 1 && counts[counts.length - 1] < MIN_GROUP) counts[counts.length - 2] += counts.pop()!;
  let start = 0;
  return counts.map(count => {
    const group = beats.slice(start, start + count);
    const plan = { start, count, concept: group[0].visualIntent, visualPlan: group.map(b => b.visualIntent).join(" Then: ") };
    start += count;
    return plan;
  });
}

function parse(response: string, total: number): ScenePlan[] | null {
  const text = response.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  try {
    const r = Plan.safeParse(JSON.parse(text));
    if (!r.success || r.data.reduce((n, g) => n + g.count, 0) !== total) return null;
    // Every group but the last must have 3-6 beats; the last may be a short remainder.
    if (r.data.slice(0, -1).some(g => g.count < MIN_GROUP)) return null;
    return withStarts(r.data);
  } catch {
    return null;
  }
}

/** Groups beats into scenes (3-6 beats, one concept each). Invalid model output falls back to chunking by 4. */
export async function planScenes({ beats, provider, figures = [] }: { beats: Beat[]; provider: LLMProvider; figures?: Figure[] }): Promise<ScenePlan[]> {
  const prompt = `Group the narrated beats below into scenes for an animated explainer video. Return JSON only, without commentary or fences: an array of {"count": number, "concept": string, "visualPlan": string}, in order.

Rules:
- Each scene covers a run of consecutive beats about ONE concept. count is 3 to ${MAX_GROUP}; the counts must add up to exactly ${beats.length}. Only the last scene may have fewer than ${MIN_GROUP} beats.
- visualPlan describes ONE diagram or animation that is built up progressively across the scene's beats: which DSL objects and styles to use (flow, table, Array, Tree, shape, arrow, bits, stack, code, figure; draw/pop/stagger styles), which objects stay on screen from beat to beat, and what moves, highlights or transforms at each beat. The last beat should resolve or summarize the diagram visually.
- Visuals over text: on-screen text is only short labels.
${figuresPrompt(figures)}

Beats (JSON):
${JSON.stringify(beats.map((b, i) => ({ i, say: b.say, visualIntent: b.visualIntent })))}`;
  return parse(await provider.complete(prompt), beats.length) ?? chunkBeats(beats);
}
