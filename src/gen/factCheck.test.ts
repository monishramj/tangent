// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("../devlog", () => ({ devlog: vi.fn() }));
import type { LLMProvider } from "../llm/provider";
import { checkBeats, factCheckBeats, falseFlagRate } from "./factCheck";
import type { Beat } from "./script";
import fixtures from "./factCheck.fixtures.json";

const sources = [{ id: "p1", markdown: "Heaps are trees. A heap has 7 nodes." }, { id: "p2", markdown: "Inserting takes log n time." }];
const beat = (say: string, passages = ["p1"]): Beat => ({ say, visualIntent: "x", passages });
/** Fake LLM: fact-check prompts get `verdicts` (a function of call number), repair prompts get `repair`. */
function fake(verdicts: object[][], repair?: string) {
  let n = 0;
  return { complete: vi.fn(async (prompt: string) => prompt.startsWith("Fact-check") ? JSON.stringify(verdicts[Math.min(n++, verdicts.length - 1)]) : repair ?? "{}") } satisfies LLMProvider;
}
const run = (beats: Beat[], p: LLMProvider) => factCheckBeats({ beats, sources, provider: p });

it("supported beats pass untouched", async () => {
  const beats = [beat("Heaps are trees."), beat("A heap has 7 nodes.")];
  const r = await run(beats, fake([[{ beat: 0, verdict: "supported", anchor: "p1" }, { beat: 1, verdict: "supported", anchor: "p1" }]]));
  expect(r).toMatchObject({ beats, sayChanged: false, log: [] });
});

it("unclear and unusable answers keep every beat (fail open)", async () => {
  const beats = [beat("Heaps are trees."), beat("Trees are neat.")];
  const p = fake([[{ beat: 0, verdict: "unclear" }]]);
  expect((await run(beats, p)).beats).toEqual(beats);
  const bad: LLMProvider = { complete: async () => "nope" };
  expect(await checkBeats(beats, sources, bad)).toEqual([{ verdict: "unclear" }, { verdict: "unclear" }]);
  const down: LLMProvider = { complete: async () => { throw new Error("offline"); } };
  expect((await run(beats, down)).sayChanged).toBe(false);
});

it("corrects a wrong anchor when another paragraph supports the beat", async () => {
  const r = await run([beat("Inserting takes log n time.", ["p1"])], fake([[{ beat: 0, verdict: "supported", anchor: "p2" }]]));
  expect(r.beats[0].passages).toEqual(["p2"]);
  expect(r.sayChanged).toBe(false);
  // an invented anchor id is ignored
  const r2 = await run([beat("Heaps are trees.")], fake([[{ beat: 0, verdict: "supported", anchor: "p99" }]]));
  expect(r2.beats[0].passages).toEqual(["p1"]);
});

it("repairs an unsupported beat once, keeping its anchor", async () => {
  const beats = [beat("Heaps are trees."), beat("A heap has 9 nodes.")];
  const p = fake([[{ beat: 0, verdict: "supported" }, { beat: 1, verdict: "unsupported" }], [{ beat: 0, verdict: "supported" }]], JSON.stringify({ 1: { say: "A heap has 7 nodes.", visualIntent: "y" } }));
  const r = await run(beats, p);
  expect(r.beats.map(b => b.say)).toEqual(["Heaps are trees.", "A heap has 7 nodes."]);
  expect(r.beats[1].passages).toEqual(["p1"]);
  expect(r).toMatchObject({ sayChanged: true });
  expect(p.complete).toHaveBeenCalledTimes(3); // check, one repair, re-check
});

it("cuts a beat whose repair is still unsupported or breaks the number gate", async () => {
  const beats = [beat("Heaps are trees."), beat("A heap has 9 nodes."), beat("Heaps are trees. Really.")];
  const stillBad = fake([[{ beat: 1, verdict: "unsupported" }], [{ beat: 0, verdict: "unsupported" }]], JSON.stringify({ 1: { say: "A heap has 7 nodes.", visualIntent: "y" } }));
  expect((await run(beats, stillBad)).beats.map(b => b.say)).toEqual(["Heaps are trees.", "Heaps are trees. Really."]);
  const badNumber = fake([[{ beat: 1, verdict: "unsupported" }], [{ beat: 0, verdict: "supported" }]], JSON.stringify({ 1: { say: "A heap has 4096 nodes.", visualIntent: "y" } }));
  const r = await run(beats, badNumber);
  expect(r.beats).toHaveLength(2);
  expect(r.sayChanged).toBe(true);
});

it("never cuts every beat", async () => {
  const r = await run([beat("A heap has 9 nodes.")], fake([[{ beat: 0, verdict: "unsupported" }]]));
  expect(r.beats).toHaveLength(1);
  expect(r.log).toContain("all beats unsupported; kept");
});

it("fixtures: 6+ cases, every kind present, rate maths", () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(6);
  expect(new Set(fixtures.map(f => f.expected))).toEqual(new Set(["supported", "unsupported", "wrong-anchor"]));
  for (const f of fixtures) expect(f.sources.some(s => f.beat.passages.includes(s.id))).toBe(true);
  expect(falseFlagRate([{ expected: "supported", got: "unsupported" }, { expected: "supported", got: "supported" }, { expected: "unsupported", got: "unsupported" }])).toBe(0.5);
  expect(falseFlagRate([])).toBe(0);
});
