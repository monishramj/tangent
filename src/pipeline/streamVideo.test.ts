// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { streamVideo, type PipelineEvent } from "./streamVideo";

afterEach(() => vi.useRealTimers());

function setup(count = 4, dslMs = (_i: number) => 200) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const beats = Array.from({ length: count }, (_, i) => ({ say: `Scene${String.fromCharCode(65 + i)} grows.`, visualIntent: "Grow an array" }));
  const trace: { stage: string; i: number; start: number; end: number }[] = [];
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const provider: LLMProvider = { complete: vi.fn(async (prompt: string) => {
    if (prompt.startsWith("Rewrite")) {
      await sleep(20);
      return JSON.stringify(beats);
    }
    const section = JSON.parse(prompt.split("Section (JSON string):\n")[1].split("\n")[0]) as string;
    const { say } = JSON.parse(section) as { say: string };
    const i = beats.findIndex(b => b.say === say);
    const entry = { stage: "dsl", i, start: Date.now(), end: 0 };
    trace.push(entry);
    await sleep(dslMs(i));
    entry.end = Date.now();
    return JSON.stringify({ scene: "model-id", objects: [{ id: "a", type: "Array", init: [2, 1] }],
      beats: [{ say, actions: [{ at: say.split(" ")[0], do: "create", target: "a" },
        { at: "grows", do: "op", target: "a", op: "swap", args: [0, 1] }] }] });
  }) };
  const ttsAlign = vi.fn(async (text: string) => {
    const i = beats.findIndex(b => b.say === text);
    const entry = { stage: "tts", i, start: Date.now(), end: 0 };
    trace.push(entry);
    await sleep(100 + i * 20);
    entry.end = Date.now();
    return { wavPath: `/tmp/${i}.wav`, sec: 10, words: text.split(" ").map((word, j) => ({ word, start: 0.25 + j * 2, end: 1 + j * 2 })) };
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

it("holds one ready scene ahead, bounds prefetch, and reports starvation", async () => {
  const { options, ttsAlign } = setup(8);
  const stream = streamVideo(options);
  expect(stream.status()).toBe("idle");
  const first = stream.next();
  expect(stream.status()).toBe("buffering");
  expect(stream.bufferedAhead()).toBe(0);
  await vi.advanceTimersByTimeAsync(340);
  expect((await first).value).toMatchObject({ type: "scene", sceneId: "scene-1" });
  expect(stream.bufferedAhead()).toBe(1);
  await vi.runAllTimersAsync();
  expect(ttsAlign).toHaveBeenCalledTimes(3);
  expect(stream.bufferedAhead()).toBe(2);
  expect(stream.status()).toBe("ready");
  await stream.return();
  expect(stream.status()).toBe("done");
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

it("caps invalid DSL at two model calls per scene", async () => {
  const { options, provider } = setup(1);
  vi.mocked(provider.complete).mockResolvedValueOnce(JSON.stringify([{ say: "Arrays grow.", visualIntent: "Grow" }]))
    .mockResolvedValue("{}");
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("error");
  expect(provider.complete).toHaveBeenCalledTimes(3); // script + two scene attempts
});

it("retries and recovers from a transient DSL transport error", async () => {
  const { options, provider, beats } = setup(1);
  vi.mocked(provider.complete).mockResolvedValueOnce(JSON.stringify(beats)).mockRejectedValueOnce(new Error("offline"));
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("scene");
  expect(provider.complete).toHaveBeenCalledTimes(3);
});

it("converts math before synthesis and rejects rewritten narration", async () => {
  const { options, provider, ttsAlign } = setup(1);
  vi.mocked(provider.complete).mockResolvedValueOnce(JSON.stringify([{ say: "x^2 grows.", visualIntent: "Show math" }]))
    .mockResolvedValue(JSON.stringify({ scene: "s", objects: [], beats: [{ say: "A different script.", actions: [] }] }));
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect(ttsAlign.mock.calls.map(call => call[0])).toEqual(["x squared grows.", "x squared grows."]);
  expect((await events)[0]).toMatchObject({ type: "error", error: expect.objectContaining({ message: expect.stringMatching(/narration/i) }) });
});

it("compiles math anchors against the expanded spoken words", async () => {
  const { options, beats, ttsAlign } = setup(1);
  beats[0].say = "x^2 grows.";
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  const [event] = await events;
  expect(ttsAlign.mock.calls[0][0]).toBe("x squared grows.");
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
  expect(provider.complete).toHaveBeenCalledTimes(1);
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
  expect(ttsAlign).toHaveBeenCalledTimes(2);
  expect(provider.complete).toHaveBeenCalledTimes(1);
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
  expect(provider.complete).toHaveBeenCalledTimes(2);
  expect(ttsAlign).not.toHaveBeenCalled();
});

it.each([0, -1, 1.5, Infinity])("rejects invalid concurrency %s", concurrency => {
  const { options } = setup();
  expect(() => streamVideo({ ...options, concurrency })).toThrow(/concurrency/i);
});

it.each([0, 1, 2, 3, 4, -1])("drains five beats with a twice-failed scene at %s across completion orders", async failed => {
  const { options, ttsAlign, beats } = setup(5, i => i % 2 ? 500 : 1);
  const synthesize = ttsAlign.getMockImplementation()!;
  ttsAlign.mockImplementation(async text => {
    if (text === beats[failed]?.say) throw new Error("tts offline");
    return synthesize(text);
  });
  for (const concurrency of [1, 2, 3]) {
    let results: PipelineEvent[] | undefined;
    const pending = collect(streamVideo({ ...options, concurrency })).then(events => { results = events; });
    await vi.runAllTimersAsync();
    // Assert before awaiting: an idle unresolved promise fails without a real-time timeout.
    expect(results?.map(e => e.sceneId)).toEqual(["scene-1", "scene-2", "scene-3", "scene-4", "scene-5"]);
    expect(results?.map(e => e.type)).toEqual(beats.map((_, i) => i === failed ? "error" : "scene"));
    await pending;
  }
});

it("resumes a paused consumer after an error with no work outstanding", async () => {
  const { options, ttsAlign, beats } = setup(5, i => i === 0 ? 500 : 1);
  const synthesize = ttsAlign.getMockImplementation()!;
  ttsAlign.mockImplementation(async text => {
    if (text === beats[1].say) throw new Error("tts offline");
    return synthesize(text);
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
