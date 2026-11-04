// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { streamVideo, type PipelineEvent } from "./streamVideo";

afterEach(() => vi.useRealTimers());

const SIZE = 3; // beats per scene group

function setup(count = 4, dslMs = (_i: number) => 200) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const beats = Array.from({ length: count * SIZE }, (_, i) => ({ say: `Scene${String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)} grows.`, visualIntent: "Grow an array" }));
  const trace: { stage: string; i: number; start: number; end: number }[] = [];
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const provider: LLMProvider = { complete: vi.fn(async (prompt: string) => {
    if (prompt.startsWith("Rewrite")) {
      await sleep(20);
      return JSON.stringify(beats);
    }
    if (prompt.startsWith("Group")) return JSON.stringify(Array.from({ length: count }, () => ({ count: SIZE, concept: "c", visualPlan: "grow an array" })));
    const group = JSON.parse(prompt.split("Narration beats (JSON):\n")[1].split("\n")[0]) as { say: string }[];
    const i = beats.findIndex(b => b.say === group[0].say) / SIZE;
    const entry = { stage: "dsl", i, start: Date.now(), end: 0 };
    trace.push(entry);
    await sleep(dslMs(i));
    entry.end = Date.now();
    return JSON.stringify({ scene: "model-id", objects: [{ id: "a", type: "Array", init: [2, 1] }],
      beats: group.map(({ say }, k) => ({ say, actions: k === 0
        ? [{ at: say.split(" ")[0], do: "create", target: "a" }, { at: "grows", do: "op", target: "a", op: "swap", args: [0, 1] }]
        : [{ at: say.split(" ")[0], do: "highlight", target: "a" }, { at: "grows", do: "indicate", target: "a" }] })) });
  }) };
  const ttsAlign = vi.fn(async (text: string, o?: { sceneId: string }) => {
    const i = Number(o?.sceneId.replace("scene-", "")) - 1;
    const entry = { stage: "tts", i, start: Date.now(), end: 0 };
    trace.push(entry);
    await sleep(100 + i * 20);
    entry.end = Date.now();
    const words = text.split(" ");
    return { wavPath: `/tmp/${i}.wav`, sec: words.length * 0.5 + 0.5, words: words.map((word, j) => ({ word, start: 0.25 + j * 0.5, end: 0.65 + j * 0.5 })) };
  });
  const options = { sectionMarkdown: "Arrays grow.", provider, ttsAlign, clock: { now: () => Date.now() } };
  return { beats, trace, provider, ttsAlign, options };
}

async function collect(stream: AsyncIterable<PipelineEvent>) {
  const events: PipelineEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

it("beats playback time with fake latencies and overlaps TTS with the preceding DSL", async () => {
  const { options, trace } = setup(6);
  const stream = streamVideo(options);
  const events = collect(stream);
  await vi.runAllTimersAsync();
  const results = await events;
  expect(results).toHaveLength(6);
  for (const event of results) {
    expect(event.type).toBe("scene");
    if (event.type === "scene") {
      expect(event.generationMs).toBeGreaterThanOrEqual(300);
      expect(event.scene.beats).toHaveLength(SIZE);
      expect(event.timeline.events.filter(e => e.verb === "say")).toHaveLength(SIZE);
      expect(event.timeline.totalSec).toBeCloseTo(SIZE * 2 * 0.5 + 0.5, 5); // one wav, no extra beat pauses
      expect(event.scene.scene).toBe(event.sceneId);
      expect(event.scene.objects[0].id).toBe("a");
      expect(event.generationMs).toBeLessThan(event.timeline.totalSec * 1000);
      expect(event.timeline.events.find(e => e.verb === "create")?.start).toBe(0.25);
      expect(event.timeline.events.filter(e => e.verb === "move")).toHaveLength(2);
      expect(event.timeline.events.some(e => e.verb === "op")).toBe(false);
    }
  }
  const firstDsl = trace.find(e => e.stage === "dsl" && e.i === 0)!;
  const nextTts = trace.find(e => e.stage === "tts" && e.i === 1)!;
  expect(Math.max(firstDsl.start, nextTts.start)).toBeLessThan(Math.min(firstDsl.end, nextTts.end));
  expect(stream.status()).toBe("done");
});

it("yields in script order even when later scenes complete first", async () => {
  const { options, trace } = setup(3, i => i === 0 ? 500 : 10);
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect(trace.filter(e => e.stage === "dsl").sort((a, b) => a.end - b.end)[0].i).toBe(1);
  expect((await events).map(e => e.sceneId)).toEqual(["scene-1", "scene-2", "scene-3"]);
});

it("yields as soon as a scene is ready, bounds prefetch to the lookahead window, and reports starvation", async () => {
  const { options, ttsAlign } = setup(8);
  const stream = streamVideo(options);
  expect(stream.status()).toBe("idle");
  const first = stream.next();
  expect(stream.status()).toBe("buffering");
  expect(stream.bufferedAhead()).toBe(0);
  await vi.runAllTimersAsync();
  expect((await first).value).toMatchObject({ type: "scene", sceneId: "scene-1" });
  expect(ttsAlign).toHaveBeenCalledTimes(5); // scene 1 plus lookahead 3 after the cursor
  expect(stream.bufferedAhead()).toBe(4);
  expect(stream.status()).toBe("ready");
  await stream.return();
  expect(stream.status()).toBe("done");
});

it("does not release a scene only after its successor: the first scene is yielded while the second is still slow", async () => {
  const { options } = setup(3, i => i === 0 ? 10 : 5000);
  const stream = streamVideo(options);
  const first = stream.next();
  await vi.advanceTimersByTimeAsync(300);
  expect((await first).value).toMatchObject({ sceneId: "scene-1" });
  await stream.return();
});

it("a slow scene N does not block generation of N+1..N+3, and output stays in order", async () => {
  const { options, trace } = setup(8, i => i === 0 ? 5000 : 10);
  const events = collect(streamVideo(options));
  await vi.advanceTimersByTimeAsync(1000);
  const started = new Set(trace.filter(e => e.stage === "dsl").map(e => e.i));
  expect([...started].sort()).toEqual([0, 1, 2, 3]); // N+1..N+3 ran while N was stuck; N+4 is outside the window
  expect(trace.filter(e => e.stage === "dsl" && e.i > 0).every(e => e.end > 0)).toBe(true);
  await vi.runAllTimersAsync();
  expect((await events).map(e => e.sceneId)).toEqual(Array.from({ length: 8 }, (_, i) => `scene-${i + 1}`));
});

it("passes section figures to the planning and scene prompts", async () => {
  const { options, provider } = setup(1);
  const events = collect(streamVideo({ ...options, figures: [{ id: "figure-1", caption: "A datapath", src: "asset://dp.png" }] }));
  await vi.runAllTimersAsync();
  await events;
  const prompts = vi.mocked(provider.complete).mock.calls.map(c => c[0]);
  expect(prompts.filter(p => p.includes("asset://dp.png"))).toHaveLength(2);
});

it("supports a single worker while retaining lookahead", async () => {
  const { options, trace } = setup(3);
  const events = collect(streamVideo({ ...options, concurrency: 1 }));
  await vi.runAllTimersAsync();
  expect(await events).toHaveLength(3);
  const work = trace.sort((a, b) => a.start - b.start);
  for (let i = 1; i < work.length; i++) expect(work[i].start).toBeGreaterThanOrEqual(work[i - 1].end);
});

it("retries TTS once, emits an ordered error, and continues", async () => {
  const { options, ttsAlign } = setup(3);
  ttsAlign.mockImplementationOnce(async () => { throw new Error("tts offline"); });
  ttsAlign.mockImplementationOnce(async () => { throw new Error("tts offline"); });
  const events = collect(streamVideo({ ...options, concurrency: 1 }));
  await vi.runAllTimersAsync();
  const results = await events;
  expect(results.map(e => e.type)).toEqual(["error", "scene", "scene"]);
  expect(results[0]).toMatchObject({ sceneId: "scene-1", error: expect.any(Error) });
  expect(ttsAlign).toHaveBeenCalledTimes(4);
});

it("caps invalid DSL at two scene attempts, each with one repair call", async () => {
  const { options, provider } = setup(1);
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => p.startsWith("Rewrite") || p.startsWith("Group") ? base(p, o) : "{}");
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("error");
  expect(provider.complete).toHaveBeenCalledTimes(6); // script + plan + 2 x (scene + repair)
});

it("retries and recovers from a transient DSL transport error", async () => {
  const { options, provider } = setup(1);
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  let failed = false;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => {
    if (!p.startsWith("Rewrite") && !p.startsWith("Group") && !failed) { failed = true; throw new Error("offline"); }
    return base(p, o);
  });
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("scene");
  expect(provider.complete).toHaveBeenCalledTimes(4);
});

it("converts math before synthesis and rejects rewritten narration", async () => {
  const { options, provider, ttsAlign, beats } = setup(1);
  beats[0].say = "x^2 grows.";
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => p.startsWith("Rewrite") || p.startsWith("Group") ? base(p, o)
    : JSON.stringify({ scene: "s", objects: [{ id: "a", type: "Array", init: [1] }], beats: beats.map(() => ({ say: "A different script.", actions: [] })) }));
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect(ttsAlign.mock.calls.map(call => call[0].slice(0, 16))).toEqual(["x squared grows.", "x squared grows."]);
  expect((await events)[0]).toMatchObject({ type: "error", error: expect.objectContaining({ message: expect.stringMatching(/narration/i) }) });
});

it("compiles math anchors against the expanded spoken words", async () => {
  const { options, beats, ttsAlign } = setup(1);
  beats[0].say = "x^2 grows.";
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  const [event] = await events;
  expect(ttsAlign.mock.calls[0][0].startsWith("x squared grows. SceneAB grows.")).toBe(true);
  expect(event.type).toBe("scene");
  if (event.type === "scene")
    expect(event.timeline.events.find(e => e.verb === "create")?.start).toBe(0.25);
});

it("rejects invalid alignment without calling the scene model", async () => {
  const { options, provider, ttsAlign } = setup(1);
  ttsAlign.mockResolvedValue({ wavPath: "/tmp/a.wav", sec: 1, words: [{ word: "bad", start: -1, end: 3 }] });
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("error");
  expect(ttsAlign).toHaveBeenCalledTimes(2);
  expect(provider.complete).toHaveBeenCalledTimes(2); // script + plan only
});

it("aborts promptly even if a dependency ignores cancellation", async () => {
  const { options, provider, ttsAlign } = setup();
  const controller = new AbortController();
  const stream = streamVideo({ ...options, signal: controller.signal });
  const pending = stream.next();
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(30);
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(stream.status()).toBe("aborted");
  expect(ttsAlign).toHaveBeenCalledTimes(3);
  expect(provider.complete).toHaveBeenCalledTimes(2);
  expect(vi.mocked(provider.complete).mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("does no work for a pre-aborted signal", async () => {
  const { options, provider } = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(streamVideo({ ...options, signal: controller.signal }).next()).rejects.toMatchObject({ name: "AbortError" });
  expect(provider.complete).not.toHaveBeenCalled();
});

it("rejects an invalid script before TTS", async () => {
  const { options, provider, ttsAlign } = setup();
  vi.mocked(provider.complete).mockResolvedValue("[]");
  await expect(streamVideo(options).next()).rejects.toThrow(/script/i);
  expect(provider.complete).toHaveBeenCalledTimes(2); // two script attempts
  expect(ttsAlign).not.toHaveBeenCalled();
});

it.each([0, -1, 1.5, Infinity])("rejects invalid concurrency %s", concurrency => {
  const { options } = setup();
  expect(() => streamVideo({ ...options, concurrency })).toThrow(/concurrency/i);
});

it.each([0, 1, 2, 3, 4, -1])("drains five scenes with a twice-failed scene at %s across completion orders", async failed => {
  const { options, ttsAlign, beats } = setup(5, i => i % 2 ? 500 : 1);
  const synthesize = ttsAlign.getMockImplementation()!;
  ttsAlign.mockImplementation(async (text, o) => {
    if (failed >= 0 && text.startsWith(beats[failed * SIZE].say)) throw new Error("tts offline");
    return synthesize(text, o);
  });
  for (const concurrency of [1, 2, 3]) {
    let results: PipelineEvent[] | undefined;
    const pending = collect(streamVideo({ ...options, concurrency })).then(events => { results = events; });
    await vi.runAllTimersAsync();
    // Assert before awaiting: an idle unresolved promise fails without a real-time timeout.
    expect(results?.map(e => e.sceneId)).toEqual(["scene-1", "scene-2", "scene-3", "scene-4", "scene-5"]);
    expect(results?.map(e => e.type)).toEqual(Array.from({ length: 5 }, (_, i) => i === failed ? "error" : "scene"));
    await pending;
  }
});

it("resumes a paused consumer after an error with no work outstanding", async () => {
  const { options, ttsAlign, beats } = setup(5, i => i === 0 ? 500 : 1);
  const synthesize = ttsAlign.getMockImplementation()!;
  ttsAlign.mockImplementation(async (text, o) => {
    if (text.startsWith(beats[SIZE].say)) throw new Error("tts offline");
    return synthesize(text, o);
  });
  const stream = streamVideo(options);
  const first = stream.next();
  await vi.runAllTimersAsync();
  expect((await first).value).toMatchObject({ type: "scene", sceneId: "scene-1" });
  const rest = collect(stream);
  let done = false;
  void rest.then(() => { done = true; });
  await vi.runAllTimersAsync();
  expect(done).toBe(true);
  expect((await rest).map(e => e.type)).toEqual(["error", "scene", "scene", "scene"]);
});
