import { z } from "zod";
import type { LLMProvider } from "../llm/provider";
import { dataBlock, dataReminder, dataRule, stripWatermarks } from "./sanitize";

export const Beat = z.object({ say: z.string().min(1), visualIntent: z.string().min(1), cite: z.string().optional() });
export type Beat = z.infer<typeof Beat>;
export type Violation = { beat: number; rule: string; message: string };
export type ScriptResult = { beats: Beat[] | null; attempts: number; violations: Violation[] };

const MAX_WORDS = 22;

/** How much of the section the video covers. Chosen when starting a video; "standard" by default. */
export const DETAIL_LEVELS = ["overview", "standard", "detailed", "complete"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export const isDetailLevel = (x: unknown): x is DetailLevel => typeof x === "string" && (DETAIL_LEVELS as readonly string[]).includes(x);
/** Source words per beat for each level. */
const WORDS_PER_BEAT: Record<DetailLevel, number> = { overview: 250, standard: 120, detailed: 70, complete: 40 };

/** Target beat count for a section at a level (never fewer than 4). */
export function targetBeats(sectionMarkdown: string, detail: DetailLevel): number {
  const words = sectionMarkdown.split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.round(words / WORDS_PER_BEAT[detail]));
}

function detailRules(detail: DetailLevel, beats: number): string {
  const what: Record<DetailLevel, string> = {
    overview: "Overview: only the key ideas and why they matter. Skip side examples, proofs and minor caveats.",
    standard: "Standard: the key ideas plus the main definitions and one worked example per big idea. Skip minor side notes.",
    detailed: "Detailed: every key idea, definition and theorem, the worked examples, and the important caveats and edge cases.",
    complete: "Complete: cover everything in the section. Every definition, example, theorem, caveat and number gets its own beats, in the section's order. Skip nothing. This is still a rewrite for the ear, never a reading: split dense passages into many short beats instead of dropping detail.",
  };
  return `Detail level: ${what[detail]} Aim for about ${beats} beats; the section's length sets this, so do not pad and do not compress past it.`;
}

/** Deterministic speech linter for CLAUDE.md principle 1. Empty result = clean. */
export function checkScript(beats: Beat[]): Violation[] {
  const out: Violation[] = [];
  beats.forEach((b, beat) => {
    const add = (rule: string, message: string) => out.push({ beat, rule, message });
    const say = b.say;
    // A "(" after whitespace/start is an aside; "f(x)" and "O(n)" are calls, not asides.
    const aside = /(^|[\s,;])\([^)]*\)/.exec(say);
    if (aside) add("parenthetical", `Remove the parenthetical "${aside[0].trim()}"; say it as its own sentence or drop it.`);
    for (const s of say.split(/(?<=[.!?])\s+/)) {
      const n = s.trim().split(/\s+/).filter(Boolean).length;
      if (n > MAX_WORDS) add("long-sentence", `Sentence has ${n} words (max ${MAX_WORDS}): "${s.trim()}". Split it.`);
    }
    if (/\b(the )?(former|latter)\b/i.test(say)) add("former-latter", 'Replace "former/latter" by naming the things again.');
    if (/\brespectively\b/i.test(say)) add("respectively", 'Replace "respectively" by saying each pairing out loud.');
    if (/^\W*it\b/i.test(say)) add("starts-with-it", 'Do not start a beat with "it"; name the thing.');
    if (/[[\]]/.test(say)) add("brackets", "No square brackets in say; speak a list as words, like \"3, 9 and 7\".");
    if (/\p{Extended_Pictographic}/u.test(say)) add("emoji", "No emoji in say; it is spoken aloud.");
  });
  return out;
}

/** Deterministic cleanup of markdown the model sometimes leaks into spoken text: bold/italic marks, backticks,
 *  heading hashes and bullet markers. Brackets and emoji are left for checkScript to flag (they need rewording). */
export function cleanSay(say: string): string {
  return say
    .replace(/\*\*|__|`+/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=[\s.,!?;:]|$)/g, "$1$2")
    .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+(?=[A-Za-z]))/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptPrompt(sectionMarkdown: string, detail: DetailLevel): string {
  return `Rewrite the textbook section below as a spoken script for a narrated explainer video. This is a rewrite for the ear, not a summary and not prose read aloud. Return JSON only, without commentary or fences: an array of beats, each {"say": string, "visualIntent": string, "cite"?: string}.

Voice: a fast, witty tech explainer in the style of Fireship's "The Code Report". Open with a hook: a surprising fact, a bold claim or a question. Keep it punchy and conversational, use vivid analogies and the occasional dry joke, set up tension ("but here's the catch"), and land each idea with a short memorable line. End with a quick recap of the key idea. Never trade accuracy for a joke.

Speech rules, all mandatory:
1. Short sentences, one idea each. Never more than ${MAX_WORDS} words in a sentence. One idea per beat: one sentence or two short ones.
2. Signpost: "first X, then Y", "here's the key move", "so the takeaway is".
3. Define a term before you use it. Re-say the noun instead of relying on "it" or "respectively". Never start a beat with "it".
4. No parentheticals, no nested clauses, no "the former" or "the latter".
5. Write numbers and symbols the way you would say them: "n log n", "x squared". LaTeX in say is fine for simple expressions like O(n \\log n); it is converted to speech later.
6. Lightly repeat the key idea at the start and end of its explanation.
7. say is plain spoken English only. No markdown: no asterisks, backticks, # headings or bullet points. No square brackets, so say a list as words ("3, 9 and 7", not "[3, 9, 7]"). No emoji. Digits are fine, and so is simple math.

${detailRules(detail, targetBeats(sectionMarkdown, detail))}

visualIntent is a short plain description of what should be on screen while the beat is spoken (motion, diagram, highlight). Energy comes from visuals, never from packing more ideas into a sentence. cite is optional: copy a source anchor like "p. 287" only if the section supplies one; never invent one.
Do not add claims the section does not make.

${dataRule(["source"])}

${dataBlock("source", sectionMarkdown)}

${dataReminder(["source"])} Return only the JSON array of beats.`;
}

function parse(response: string): { beats?: Beat[]; error?: string } {
  const text = response.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  try {
    const r = z.array(Beat).min(1).safeParse(JSON.parse(text));
    return r.success ? { beats: r.data.map(b => ({ ...b, say: cleanSay(b.say) })) } : { error: r.error.message };
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Sonnet writes the script: Haiku's scripts didn't hold the speech-first rules. Slower, so a longer timeout.
export const SCRIPT_OPTS = { model: "sonnet", timeoutMs: 300_000 } as const;

export async function generateScript({ sectionMarkdown, provider, detail = "standard" }: { sectionMarkdown: string; provider: LLMProvider; detail?: DetailLevel }): Promise<ScriptResult> {
  const base = scriptPrompt(stripWatermarks(sectionMarkdown), detail);
  let prompt = base;
  let beats: Beat[] | null = null;
  let violations: Violation[] = [];
  for (let attempts = 1; attempts <= 2; attempts++) {
    const { beats: b, error } = parse(await provider.complete(prompt, SCRIPT_OPTS));
    beats = b ?? null;
    violations = b ? checkScript(b) : [{ beat: -1, rule: "format", message: error ?? "Invalid output" }];
    if (violations.length === 0) return { beats, attempts, violations };
    prompt = `${base}\n\nYour previous answer broke these rules. Fix every one, keep everything else, and return the full JSON array again:\n${JSON.stringify(violations)}`;
  }
  return { beats, attempts: 2, violations };
}
