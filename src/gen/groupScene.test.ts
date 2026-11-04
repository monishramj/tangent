import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { DSL_CHEATSHEET } from "../dsl";
import { generateGroupScene } from "./scene";
import type { ScenePlan } from "./plan";

const beats = [
  { say: "A mux picks one input.", visualIntent: "mux" },
  { say: "The select line decides which one.", visualIntent: "select" },
  { say: "So the output follows the chosen input.", visualIntent: "out" },
];
const plan: ScenePlan = { start: 0, count: 3, concept: "multiplexer", visualPlan: "flow of inputs into a mux" };
const act = (at: string, target: string, extra = {}) => ({ at, do: "create", target, ...extra });
const good = () => ({
  scene: "g",
  objects: [
    { id: "title", type: "text", text: "Multiplexer" },
    { id: "net", type: "flow", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "m", label: "MUX" }], edges: [{ from: "a", to: "m" }, { from: "b", to: "m" }] },
    { id: "sel", type: "shape", shape: "circle", label: "select" },
  ],
  beats: [
    { say: beats[0].say, actions: [act("A mux", "title", { style: "type" }), act("picks", "net", { style: "stagger" })] },
    { say: beats[1].say, actions: [act("select line", "sel", { style: "pop" }), { at: "decides", do: "highlight", target: "net" }] },
    { say: beats[2].say, actions: [{ at: "output", do: "indicate", target: "net" }, { at: "chosen input", do: "transform", target: "sel", scale: 1.3 }] },
  ],
});
const mock = (...responses: unknown[]) => ({
  complete: vi.fn<LLMProvider["complete"]>().mockImplementation(async () => {
    const r = responses.shift();
    return typeof r === "string" ? r : JSON.stringify(r);
  }),
});

describe("generateGroupScene", () => {
  it("accepts a good multi-beat scene and teaches the cheatsheet and hard rules", async () => {
    const provider = mock(good());
    const result = await generateGroupScene({ beats, plan, provider, figures: [{ id: "figure-1", caption: "Mux", src: "asset://mux.png" }] });
    expect(result.scene?.beats).toHaveLength(3);
    expect(result.attempts).toBe(1);
    const prompt = provider.complete.mock.calls[0][0];
    for (const text of [DSL_CHEATSHEET, "Visuals over text", "6 words", "at least 2 animated actions", "stagger", "Reuse object ids", "last beat resolves", "flow of inputs into a mux", "asset://mux.png", beats[2].say])
      expect(prompt).toContain(text);
  });

  it("retries once with the errors, then gives up", async () => {
    const shortBeat = good();
    shortBeat.beats[1].actions.pop();
    const provider = mock(shortBeat, shortBeat);
    const result = await generateGroupScene({ beats, plan, provider });
    expect(result.scene).toBeNull();
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(provider.complete.mock.calls[1][0]).toContain("at least 2 animated actions");
    const recovered = await generateGroupScene({ beats, plan, provider: mock(shortBeat, good()) });
    expect(recovered).toMatchObject({ attempts: 2, scene: expect.anything() });
  });

  const cases: [string, (s: ReturnType<typeof good>) => void, RegExp][] = [
    ["narration on screen", s => { s.objects[0] = { id: "title", type: "text", text: "The select line decides which one" } as never; }, /copies the narration/],
    ["long text", s => { (s.objects[0] as { text: string }).text = "one two three four five six seven eight nine ten"; }, /short label/],
    ["more text than visuals", s => { s.objects = [s.objects[0], { id: "t2", type: "text", text: "Extra" }, s.objects[2]] as never; s.beats[0].actions = [act("A mux", "title"), act("picks", "t2")]; s.beats[1].actions = [act("select line", "sel"), { at: "decides", do: "highlight", target: "sel" }]; s.beats[2].actions = [{ at: "output", do: "indicate", target: "sel" }, { at: "chosen input", do: "highlight", target: "sel" }]; }, /more visuals than text/],
    ["altered narration", s => { s.beats[0].say = "A mux picks."; s.beats[0].actions = [act("A mux", "title"), act("picks", "net")]; }, /narration exactly/],
    ["nothing reused", s => { s.beats[1].actions = [act("select line", "sel"), act("decides", "title2")]; s.objects.push({ id: "title2", type: "shape", shape: "rect" } as never); s.beats[2].actions = [act("output", "x1"), act("chosen input", "x2")]; s.objects.push({ id: "x1", type: "shape", shape: "rect" } as never, { id: "x2", type: "shape", shape: "rect" } as never); s.beats[0].actions = [act("A mux", "title"), act("picks", "net")]; }, /reuse object ids/],
    ["hallucinated figure", s => { s.objects.push({ id: "fig", type: "figure", src: "/etc/hosts" } as never); s.beats[0].actions.push(act("mux", "fig")); }, /figure src/],
  ];
  it.each(cases)("rejects: %s", async (_n, mutate, message) => {
    const bad = good();
    mutate(bad);
    const result = await generateGroupScene({ beats, plan, provider: mock(bad, bad) });
    expect(result.scene).toBeNull();
    expect(JSON.stringify(result.errors[0])).toMatch(message);
  });
});
