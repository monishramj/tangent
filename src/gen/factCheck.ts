import { z } from "zod";
import type { LLMProvider } from "../llm/provider";
import { dataBlock, dataReminder, dataRule } from "./sanitize";
import { checkGrounding, checkScript, parseRepair, SCRIPT_OPTS, type Beat } from "./script";
import { devlog } from "../devlog";

/** Step 12: does each beat's narration say what its source paragraphs say? Off by default (streamVideo `factCheck`):
 *  turn on only after the false-flag rate on correct beats is measured <= 5% (factCheck.eval.test.ts). */
export type Verdict = "supported" | "unsupported" | "unclear";
export type BeatCheck = { verdict: Verdict; anchor?: string };
export type Source = { id: string; markdown: string };

const Answer = z.array(z.object({ beat: z.number().int(), verdict: z.enum(["supported", "unsupported", "unclear"]), anchor: z.string().optional() }));
const sourceText = (sources: Source[]) => sources.map(p => `[${p.id}] ${p.markdown}`).join("\n\n");

function prompt(beats: Beat[], sources: Source[]): string {
  const rows = beats.map((b, beat) => ({ beat, say: b.say, cited: b.passages ?? [] }));
  return `Fact-check narration against its source. For each beat decide whether everything it states as fact (numbers, names, definitions, claims) is stated or directly implied by the source paragraphs. Jokes, analogies and signposting are fine. Verdicts: "supported", "unsupported" (a number, name or claim differs from or is missing in the source), or "unclear" (cannot tell). For a supported beat also give "anchor": the id of the source paragraph that best supports it, which may differ from the cited ids. Return JSON only: [{"beat": number, "verdict": string, "anchor"?: string}], one entry per beat.
${dataRule(["source", "narration"])}
${dataBlock("source", sourceText(sources))}
${dataBlock("narration", JSON.stringify(rows))}
${dataReminder(["source", "narration"])} Return only the JSON array.`;
}

/** One cheap haiku call for a group of beats. Any failure is "unclear" for every beat: the check fails open. */
export async function checkBeats(beats: Beat[], sources: Source[], provider: LLMProvider): Promise<BeatCheck[]> {
  const out: BeatCheck[] = beats.map(() => ({ verdict: "unclear" }));
  try {
    const text = (await provider.complete(prompt(beats, sources), { model: "haiku" })).trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
    for (const r of Answer.parse(JSON.parse(text))) if (r.beat >= 0 && r.beat < beats.length) out[r.beat] = { verdict: r.verdict, ...(r.anchor ? { anchor: r.anchor } : {}) };
  } catch (e) {
    devlog(`fact-check: unusable answer (${e instanceof Error ? e.message.slice(0, 80) : e})`);
  }
  return out;
}

/**
 * A supported beat whose cite anchor is not the supporting paragraph gets the right anchor; an unsupported beat gets
 * one targeted repair, is re-checked, and is cut if still unsupported (never all beats). `sayChanged` = narration
 * differs from the input, so the caller must redo that scene's audio.
 */
export async function factCheckBeats({ beats, sources, provider }: { beats: Beat[]; sources: Source[]; provider: LLMProvider }): Promise<{ beats: Beat[]; sayChanged: boolean; log: string[] }> {
  const log: string[] = [];
  const known = new Set(sources.map(s => s.id));
  const checks = await checkBeats(beats, sources, provider);
  const out = beats.map((b, i) => {
    const { verdict, anchor } = checks[i];
    if (verdict !== "supported" || !anchor || !known.has(anchor) || !b.passages || b.passages.includes(anchor)) return b;
    log.push(`beat ${i}: anchor ${b.passages.join(",") || "-"} -> ${anchor}`);
    return { ...b, passages: [anchor] };
  });
  const bad = checks.flatMap((c, i) => c.verdict === "unsupported" ? [i] : []);
  let cut = new Set<number>(bad);
  if (bad.length) try {
    const prev = JSON.stringify(out.map(({ say, visualIntent, passages }) => ({ say, visualIntent, ...(passages ? { passages } : {}) })));
    const fixed = parseRepair(await provider.complete(`These narration beats were judged unsupported by their source paragraphs. Rewrite ONLY beats ${bad.join(", ")} so every fact, number and claim comes from the source, keeping their meaning and place. If the source does not support the idea, say a plainly true one-sentence version of what it does say. Speech rules hold: short sentences, no parentheticals. Return JSON only: an object keyed by beat index, like {"${bad[0]}": {"say": "...", "visualIntent": "..."}}.\n${dataRule(["source", "previous_answer"])}\n${dataBlock("source", sourceText(sources))}\n${dataBlock("previous_answer", prev)}\n${dataReminder(["source", "previous_answer"])}`, SCRIPT_OPTS), out, bad);
    if (fixed && fixed.length === out.length) {
      const repaired = bad.map(i => ({ ...fixed[i], ...(out[i].passages ? { passages: out[i].passages } : {}) }));
      // The repair must pass the same deterministic gates and the fact-check again, else the beat is cut.
      const again = await checkBeats(repaired, sources, provider);
      const all = sources.map(s => s.markdown).join("\n");
      bad.forEach((i, k) => {
        if (repaired[k].say !== out[i].say && again[k].verdict !== "unsupported" && !checkScript([repaired[k]]).length && !checkGrounding([repaired[k]], all).length) {
          out[i] = repaired[k]; cut.delete(i); log.push(`beat ${i}: repaired`);
        }
      });
    }
  } catch (e) { log.push(`repair failed: ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
  if (cut.size >= out.length) { log.push("all beats unsupported; kept"); cut = new Set(); }
  if (cut.size) log.push(`cut beats ${[...cut].join(", ")}`);
  const sayChanged = cut.size > 0 || out.some((b, i) => b.say !== beats[i].say);
  return { beats: out.filter((_, i) => !cut.has(i)), sayChanged, log };
}

/** Eval maths: the share of beats expected `supported` that the checker flagged `unsupported`. */
export function falseFlagRate(cases: { expected: string; got: Verdict }[]): number {
  const correct = cases.filter(c => c.expected === "supported");
  return correct.length ? correct.filter(c => c.got === "unsupported").length / correct.length : 0;
}
