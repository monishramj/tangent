import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { chunkBeats, planScenes } from "./plan";

const beats = (n: number) => Array.from({ length: n }, (_, i) => ({ say: `Beat ${i} here.`, visualIntent: `intent ${i}` }));
const mock = (response: string) => ({ complete: vi.fn<LLMProvider["complete"]>().mockResolvedValue(response) });
const g = (count: number) => ({ count, concept: "c", visualPlan: "build a flow" });

describe("planScenes", () => {
  it("accepts a valid plan, fills in starts, and passes beats and figures to the prompt", async () => {
    const provider = mock("```json\n" + JSON.stringify([g(4), g(3), g(2)]) + "\n```");
    const plans = await planScenes({ beats: beats(9), provider, figures: [{ id: "figure-1", caption: "A datapath", src: "asset://x.png" }] });
    expect(plans.map(p => [p.start, p.count])).toEqual([[0, 4], [4, 3], [7, 2]]);
    const prompt = provider.complete.mock.calls[0][0];
    expect(prompt).toContain("Beat 8 here.");
    expect(prompt).toContain("asset://x.png");
  });

  it.each([
    ["not json", "nope"],
    ["wrong total", JSON.stringify([g(4), g(4)])],
    ["middle group too small", JSON.stringify([g(2), g(3), g(4)])],
    ["group too big", JSON.stringify([g(7), g(2)])],
    ["empty", "[]"],
  ])("falls back to chunks of 4 on %s", async (_n, response) => {
    const plans = await planScenes({ beats: beats(9), provider: mock(response) });
    expect(plans.map(p => [p.start, p.count])).toEqual([[0, 4], [4, 5]]);
  });

  it("chunks 18 beats as 4,4,4,6 and tiny inputs as one group", () => {
    expect(chunkBeats(beats(18)).map(p => p.count)).toEqual([4, 4, 4, 6]);
    expect(chunkBeats(beats(2)).map(p => p.count)).toEqual([2]);
    expect(chunkBeats(beats(7)).map(p => p.count)).toEqual([4, 3]);
  });

  it("lets transport errors propagate (no silent fallback)", async () => {
    const provider: LLMProvider = { complete: vi.fn().mockRejectedValue(new Error("offline")) };
    await expect(planScenes({ beats: beats(4), provider })).rejects.toThrow("offline");
  });
});
