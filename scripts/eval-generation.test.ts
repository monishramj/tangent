// @vitest-environment node
// Golden-set eval for script accuracy and speed (docs/generation-accuracy.md, "Eval harness"). Skipped unless
// TANGENT_EVAL is set (it runs under vitest because the motion package uses Vite's import.meta.glob). Flags:
//
//   TANGENT_EVAL=1 vitest run scripts/eval-generation           # replay recorded model answers offline
//   TANGENT_EVAL="--record" ...                                 # call claude -p for any prompt without a recording
//   TANGENT_EVAL="--judge --scenes --verbose" ...               # LLM judge per beat; run the scene stage too
//   TANGENT_EVAL="--impl ./src/gen/script.before.ts --label before" ...
//
// Per section it reports: beats, attempts, script generation time (recorded wall time of the model calls),
// beats with an unsupported number (deterministic, grounding.ts) and, with --judge, beats the judge calls
// unsupported. Recordings hold textbook text, so they live outside the repo (TANGENT_EVAL_DIR, default
// <appData>/eval); golden.json only names sections. Replay is exact: prompts are keyed by sha256.
import { it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ClaudeCodeCLI } from "../src/llm/claudeCli";
import type { CompleteOpts, LLMProvider } from "../src/llm/provider";
import { checkGrounding, type Beat, type DetailLevel } from "../src/gen/script";
import { stripWatermarks } from "../src/gen/sanitize";
import { chunkBeats } from "../src/gen/plan";
import { generateGroupScene } from "../src/gen/scene";

type Golden = { name: string; ir: string; section: string; detail?: DetailLevel };
type Section = { id: string; markdown?: string; passages?: { id: string; markdown: string }[]; children?: Section[] };
type Recording = Record<string, { text: string; ms: number }>;

const args = (process.env.TANGENT_EVAL ?? "").split(/\s+/).filter(Boolean);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const appData = join(homedir(), "Library", "Application Support", "com.tangent.app");
const evalDir = process.env.TANGENT_EVAL_DIR ?? join(appData, "eval");
const label = opt("--label") ?? "after";
const impl = resolve(opt("--impl") ?? "src/gen/script.ts");
const record = flag("--record");

const recPath = join(evalDir, "recordings.json");
let recordings: Recording = {};
const cli = new ClaudeCodeCLI();
let spentMs = 0;

/** Replays a recorded answer for the exact prompt; with --record, calls claude -p on a miss and saves it. */
const provider: LLMProvider = {
  async complete(prompt: string, opts: CompleteOpts = {}) {
    const key = createHash("sha256").update(`${opts.model ?? "haiku"}\n${prompt}`).digest("hex");
    let hit = recordings[key];
    if (!hit) {
      if (!record) throw new Error(`no recording for a ${opts.model ?? "haiku"} prompt (${key.slice(0, 12)}); rerun with --record`);
      const t = performance.now();
      const text = await cli.complete(prompt, { ...opts, timeoutMs: opts.timeoutMs ?? 300_000 });
      hit = recordings[key] = { text, ms: Math.round(performance.now() - t) };
      writeFileSync(recPath, JSON.stringify(recordings));
    }
    spentMs += hit.ms;
    const repair = /These beats broke the rules: (.*)/.exec(prompt) ?? /broke these rules\. [^\n]*\n(.*)/.exec(prompt);
    if (repair && flag("--verbose")) console.log(`[repair] ${repair[1].slice(0, 400)}`);
    return hit.text;
  },
};

const find = (s: Section[], id: string): Section | undefined => {
  for (const x of s) { if (x.id === id) return x; const c = find(x.children ?? [], id); if (c) return c; }
};

/** LLM-as-judge: is each beat entailed by the source? Run with --judge; recorded like everything else. */
async function judge(beats: Beat[], source: string): Promise<{ i: number; why?: string }[]> {
  const text = await provider.complete(`You are checking a narrated lesson script against its textbook source for factual accuracy. For each numbered beat, decide:
- "supported": every factual claim in the beat is stated in or directly entailed by the source.
- "unsupported": the beat states a fact, number, example-as-fact, definition or claim the source does not support, or overstates/distorts it.
- "framing": no factual claim (a hook question, a signpost, an obvious analogy or a joke).
Be strict: a plausible but unstated fact is unsupported. Return JSON only: [{"i": number, "verdict": "supported"|"unsupported"|"framing", "why": string}].

<source>
${source}
</source>

<beats>
${beats.map((b, i) => `${i}. ${b.say}`).join("\n")}
</beats>
Return only the JSON array.`, { model: "sonnet", timeoutMs: 300_000 });
  const rows = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")) as { i: number; verdict: string; why?: string }[];
  return rows.filter(r => r.verdict === "unsupported");
}

it.skipIf(!process.env.TANGENT_EVAL)("golden set", async () => {
mkdirSync(evalDir, { recursive: true });
recordings = existsSync(recPath) ? JSON.parse(readFileSync(recPath, "utf8")) : {};
const golden: Golden[] = JSON.parse(readFileSync(resolve("scripts/eval-golden.json"), "utf8"));
const { generateScript } = await import(impl) as typeof import("../src/gen/script");
const rows: Record<string, string | number>[] = [];
for (const g of golden) {
  const irPath = g.ir.startsWith("appdata:") ? join(appData, g.ir.slice(8)) : resolve(g.ir);
  if (!existsSync(irPath)) { console.warn(`skip ${g.name}: ${irPath} missing`); continue; }
  const section = find(JSON.parse(readFileSync(irPath, "utf8")).sections, g.section);
  if (!section?.markdown) { console.warn(`skip ${g.name}: no section ${g.section}`); continue; }
  spentMs = 0;
  try {
    const r = await generateScript({ sectionMarkdown: section.markdown, provider, detail: g.detail ?? "standard", passages: section.passages });
    const scriptMs = spentMs;
    const beats = r.beats ?? [];
    const source = stripWatermarks(section.markdown);
    const flagged = checkGrounding(beats, source);
    const numbers = flagged.length;
    const verdicts = flag("--judge") && beats.length ? await judge(beats, source) : null;
    const judged = verdicts ? verdicts.length : "";
    if (flag("--verbose")) {
      for (const v of flagged) console.log(`[${g.name}] number: ${beats[v.beat].say} -- ${v.message}`);
      for (const v of verdicts ?? []) console.log(`[${g.name}] judge: ${beats[v.i]?.say} -- ${v.why ?? ""}`);
      for (const d of r.dropped ?? []) console.log(`[${g.name}] cut: ${d}`);
    }
    // --scenes: every scene group through the haiku scene stage with the on-screen number gate on.
    let scenes = "", sceneNumberRejects = "" as number | string, sceneMs = "" as number | string;
    if (flag("--scenes") && beats.length) {
      let ok = 0, rejects = 0, total = 0;
      spentMs = 0;
      const plans = chunkBeats(beats, 4, 3);
      for (const [k, plan] of plans.entries()) {
        const res = await generateGroupScene({ beats: beats.slice(plan.start, plan.start + plan.count), plan, provider, sceneNo: k + 1, source });
        if (res.scene) ok++;
        const first = res.errors[0] ?? [];
        if (first.some(e => e.message.startsWith("on-screen number"))) rejects++;
        if (flag("--verbose")) for (const e of first) if (e.message.startsWith("on-screen number")) console.log(`[${g.name}] scene ${k + 1}: ${e.message}`);
        total++;
      }
      scenes = `${ok}/${total}`; sceneNumberRejects = rejects; sceneMs = +(spentMs / 1000 / total).toFixed(1);
    }
    rows.push({ section: g.name, beats: beats.length, scenes, sceneNumberRejects, sceneSec: sceneMs, attempts: r.attempts, dropped: r.dropped?.length ?? 0, lint: r.violations.filter(v => v.rule !== "unsupported-number").length,
      unsupportedNumberBeats: numbers, judgeUnsupported: judged, scriptSec: +(scriptMs / 1000).toFixed(1) });
  } catch (e) {
    rows.push({ section: g.name, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
  }
}
console.log(`\n${label} (${impl.split("/").pop()})`);
console.table(rows);
const ok = rows.filter(r => typeof r.beats === "number") as Record<string, number>[];
const sum = (k: string) => ok.reduce((n, r) => n + (Number(r[k]) || 0), 0);
console.log(JSON.stringify({ label, sections: ok.length, beats: sum("beats"), unsupportedNumberBeats: sum("unsupportedNumberBeats"),
  judgeUnsupported: flag("--judge") ? sum("judgeUnsupported") : null, judgeRate: flag("--judge") && sum("beats") ? +(sum("judgeUnsupported") / sum("beats")).toFixed(3) : null,
  meanScriptSec: ok.length ? +(sum("scriptSec") / ok.length).toFixed(1) : null }));
}, 3_600_000);
