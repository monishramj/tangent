// @vitest-environment node
// Measures the fact-check false-flag rate. Skipped unless TANGENT_FACTCHECK_EVAL is set (it calls `claude -p` haiku,
// one call per fixture). Production sessions enabled Step 12 after the 2026-11-16 measurement (docs/areas/gen.md).
//
//   TANGENT_FACTCHECK_EVAL=1 npx vitest run src/gen/factCheck.eval
//   TANGENT_FACTCHECK_FIXTURES=/path/outside/repo.json ...   # your own recorded beats (same shape; keeps book text out of git)
//
// Fixture shape: { name, expected: "supported"|"unsupported"|"wrong-anchor", rightAnchor?, sources: [{id, markdown}], beat: {say, visualIntent, passages} }
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ClaudeCodeCLI } from "../llm/claudeCli";
import { checkBeats, falseFlagRate, type Verdict } from "./factCheck";
import type { Beat } from "./script";
import { readManifest, readSection } from "../../scripts/eval-set";
import recordings from "../../tests/fixtures/eval/recordings.json";
import bundled from "./factCheck.fixtures.json";

type Fixture = { name: string; expected: string; rightAnchor?: string; sources: { id: string; markdown: string }[]; beat: Beat };

it.skipIf(!process.env.TANGENT_FACTCHECK_EVAL || process.env.TANGENT_FACTCHECK_PUBLIC)("false-flag rate on recorded beats", async () => {
  const path = process.env.TANGENT_FACTCHECK_FIXTURES;
  const fixtures: Fixture[] = path ? JSON.parse(readFileSync(path, "utf8")) : bundled;
  const provider = new ClaudeCodeCLI();
  const rows: { name: string; expected: string; got: Verdict; anchor?: string }[] = [];
  for (const f of fixtures) {
    const [r] = await checkBeats([f.beat], f.sources, provider);
    rows.push({ name: f.name, expected: f.expected, got: r.verdict, anchor: r.anchor });
  }
  console.table(rows);
  const correct = rows.filter(r => r.expected === "supported" || r.expected === "wrong-anchor").length;
  const missed = rows.filter(r => r.expected === "unsupported" && r.got !== "unsupported").map(r => r.name);
  const wrongAnchor = fixtures.filter(f => f.expected === "wrong-anchor");
  const anchorsFixed = wrongAnchor.filter(f => rows.find(r => r.name === f.name)?.anchor === f.rightAnchor).length;
  console.log(`FALSE-FLAG RATE: ${(falseFlagRate(rows) * 100).toFixed(1)}% of ${correct} correct beats (turn the flag on only if <= 5%)`);
  const wrong = rows.filter(r => r.expected === "unsupported");
  console.log(`CATCH RATE: ${wrong.length - missed.length}/${wrong.length}; unclear: ${rows.filter(r => r.got === "unclear").length}`);
  console.log(`missed unsupported: ${missed.join(", ") || "none"}; wrong anchors corrected: ${anchorsFixed}/${wrongAnchor.length}`);
}, 600_000);

// TANGENT_FACTCHECK_EVAL=1 TANGENT_FACTCHECK_PUBLIC=1 ... checks the public PR #25 answers.
// Read the recorded answers directly: subsequent script prompt changes invalidate exact-key replay.
// Each initial script is paired with its recorded targeted repair, where present.
const publicAnswers: Record<string, string[]> = {
  definitions: ["bb90bbf73b28322e0325ab762fd78c529bec2f1b7def7013ee0f73b067041d54", "440ed56aed62b35c1ccefce9059dd5052a84e6fa90adf01633a792eb49f21d53"],
  terminology: ["4bcb738b58b3229acdfc239ed18fd64f22daac1e22c7fb6e6cf26a3be0997a41", "cbfeebb79c7f08830edb200a9774b15fce3742077d131d93c0faeaa9fdcfde1b"],
  independence: ["0d5151b63ef74647afc2432ab70cf28f182d3bc14f1c05353bde3e95729bd34f"],
  binomial: ["c521e7a864e283ad279b34ad41ea1992258f735d237cdff6409c5ce1d638e767"],
  "standard-normal": ["f3957e46a32c7d35df667efea3583f17733d9647af2a998577f145985955e64b"],
};
function publicBeats(section: string): Beat[] {
  const [initial, ...repairs] = publicAnswers[section];
  const recorded = (key: string) => JSON.parse((recordings as Record<string, { text: string }>)[key].text);
  const beats: Beat[] = recorded(initial);
  for (const key of repairs) for (const [i, beat] of Object.entries(recorded(key))) beats[Number(i)] = beat as Beat;
  return beats;
}

it("loads all public beats with their recorded repairs without model access", () => {
  const golden = readManifest("scripts/eval-golden.json");
  expect(golden.map(g => g.section).sort()).toEqual(Object.keys(publicAnswers).sort());
  expect(golden.flatMap(g => publicBeats(g.section))).toHaveLength(26);
  expect(publicBeats("definitions")[3].say).toContain("Now take a class of 40 students.");
  expect(publicBeats("terminology")[3].say).toContain("An event is a piece of that space.");
});

it.skipIf(!process.env.TANGENT_FACTCHECK_EVAL || !process.env.TANGENT_FACTCHECK_PUBLIC)("false-flag rate on public golden beats", async () => {
  const cli = new ClaudeCodeCLI();
  const rows: { name: string; expected: string; got: Verdict; say: string }[] = [];
  const golden = readManifest("scripts/eval-golden.json");
  expect(golden).toHaveLength(5);
  for (const g of golden) {
    const section = readSection(g, "");
    expect(section?.passages?.length).toBeGreaterThan(0);
    const beats = publicBeats(g.section);
    const checks = await checkBeats(beats, section!.passages!, cli);
    rows.push(...beats.map((b, i) => ({ name: `${g.section}/${i}`, expected: "supported", got: checks[i].verdict, say: b.say })));
  }
  expect(rows).toHaveLength(26);
  console.table(rows.map(({ say: _, ...r }) => r));
  for (const r of rows.filter(r => r.got !== "supported")) console.log(`${r.name}: ${r.got}: ${r.say}`);
  console.log(`PUBLIC FALSE-FLAG RATE: ${(falseFlagRate(rows) * 100).toFixed(1)}% of ${rows.length} recorded beats; unclear: ${rows.filter(r => r.got === "unclear").length}`);
}, 600_000);
