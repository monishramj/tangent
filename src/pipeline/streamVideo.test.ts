// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/provider";
import { streamVideo, type PipelineEvent, type Progress } from "./streamVideo";

afterEach(() => vi.useRealTimers());

type Beat = { say: string; visualIntent: string };
const sizeOf = (i: number) => (i === 0 ? 3 : 4); // chunkBeats(beats, 4, 3): first scene 3 beats, then 4
const startOf = (i: number) => (i === 0 ? 0 : 3 + 4 * (i - 1));
const sceneEvents = (events: PipelineEvent[]) => events.filter((e): e is Extract<PipelineEvent, { type: "scene" | "error" }> => e.type !== "checkpoints");

/** A valid template answer for the beats in a scene prompt; the first beat is a computed array with a swap op. */
const answerFor = (group: { say: string }[], extra: (k: number) => object = () => ({})) => JSON.stringify({ beats: group.map(({ say }, k) => ({ say, ...(k === 0
  ? { template: "array", variant: "default", data: { values: [2, 1], ops: [{ op: "swap", args: [0, 1], at: "grows" }] } }
  : k % 2 ? { template: "callout", variant: "box", data: { text: "Key idea" } }
  : { template: "list", variant: "column", data: { items: [{ text: "One" }, { text: "Two" }] } }), ...extra(k) })) });
const groupOf = (prompt: string) => JSON.parse(prompt.split("Narration beats (JSON):\n")[1].split("\n")[0]) as { say: string }[];

/** Like the sidecar: each segment is synthesized alone (0.5 s per word + 0.5 s), joined by GAP s of silence. */
const GAP = 0.45;
function fakeTts(segments: string[], wavPath: string) {
  const words: { word: string; start: number; end: number }[] = [], spans: { start: number; end: number }[] = [];
  let t = 0;
  segments.forEach((seg, k) => {
    if (k) t += GAP;
    const parts = seg.split(" ");
    parts.forEach((word, j) => words.push({ word, start: t + 0.25 + j * 0.5, end: t + 0.65 + j * 0.5 }));
    spans.push({ start: t, end: t + parts.length * 0.5 + 0.5 });
    t = spans[k].end;
  });
  return { wavPath, sec: t, words, segments: spans };
}

function setup(count = 4, dslMs = (_i: number) => 200) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const total = startOf(count - 1) + sizeOf(count - 1);
  const beats: Beat[] = Array.from({ length: total }, (_, i) => ({ say: `Scene${String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)} grows.`, visualIntent: "Grow an array" }));
  const trace: { stage: string; i: number; start: number; end: number }[] = [];
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const sceneIndex = (say: string) => { const k = beats.findIndex(b => b.say === say); return k < 3 ? 0 : 1 + Math.floor((k - 3) / 4); };
  // Routed by prompt content: script, checkpoints, then one template answer per scene group.
  const provider: LLMProvider = { complete: vi.fn(async (prompt: string) => {
    if (prompt.includes("Rewrite the textbook section")) {
      await sleep(20);
      return JSON.stringify(beats);
    }
    if (prompt.startsWith("Write checkpoint questions")) return "[]";
    const group = groupOf(prompt);
    const i = sceneIndex(group[0].say);
    const entry = { stage: "dsl", i, start: Date.now(), end: 0 };
    trace.push(entry);
    await sleep(dslMs(i));
    entry.end = Date.now();
    return answerFor(group);
  }) };
  const ttsAlign = vi.fn(async (segments: string[], o?: { sceneId: string }) => {
    const i = Number(o?.sceneId.replace("scene-", "")) - 1;
    const entry = { stage: "tts", i, start: Date.now(), end: 0 };
    trace.push(entry);
    await sleep(100 + i * 20);
    entry.end = Date.now();
    return fakeTts(segments, `/tmp/${i}.wav`);
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
  const all = await events;
  const results = sceneEvents(all);
  expect(results).toHaveLength(6);
  expect(all.filter(e => e.type === "checkpoints")).toHaveLength(1);
  for (const [n, event] of results.entries()) {
    expect(event.type).toBe("scene");
    if (event.type === "scene") {
      expect(event.generationMs).toBeGreaterThanOrEqual(300);
      expect(event.scene.beats).toHaveLength(sizeOf(n));
      expect(event.timeline.events.filter(e => e.verb === "say")).toHaveLength(sizeOf(n));
      // one wav: per beat 2 words + 0.5 s, plus the sidecar's gap between beats; no extra compiler pauses
      expect(event.timeline.totalSec).toBeCloseTo(sizeOf(n) * (2 * 0.5 + 0.5) + (sizeOf(n) - 1) * GAP, 5);
      expect(event.scene.scene).toBe(event.sceneId);
      expect(event.scene.objects[0].id).toBe("arr");
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
  expect(sceneEvents(await events).map(e => e.sceneId)).toEqual(["scene-1", "scene-2", "scene-3"]);
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
  expect(sceneEvents(await events).map(e => e.sceneId)).toEqual(Array.from({ length: 8 }, (_, i) => `scene-${i + 1}`));
});

it("passes section figures to the scene and checkpoint prompts", async () => {
  const { options, provider } = setup(1);
  const events = collect(streamVideo({ ...options, figures: [{ id: "figure-1", caption: "A datapath", src: "asset://dp.png" }] }));
  await vi.runAllTimersAsync();
  await events;
  const prompts = vi.mocked(provider.complete).mock.calls.map(c => c[0]);
  expect(prompts.filter(p => p.includes("asset://dp.png") && !p.startsWith("Write checkpoint questions"))).toHaveLength(1);
  expect(prompts.filter(p => p.includes("asset://dp.png") && p.startsWith("Write checkpoint questions"))).toHaveLength(1);
});

it("passes the detail level to the script prompt (standard by default)", async () => {
  for (const [detail, needle] of [[undefined, "Detail level: Standard"], ["complete", "Detail level: Complete"]] as const) {
    const { options, provider } = setup(1);
    const events = collect(streamVideo({ ...options, detail }));
    await vi.runAllTimersAsync();
    await events;
    expect(vi.mocked(provider.complete).mock.calls[0][0]).toContain(needle);
  }
});

it("supports a single worker while retaining lookahead", async () => {
  const { options, trace } = setup(3);
  const events = collect(streamVideo({ ...options, concurrency: 1 }));
  await vi.runAllTimersAsync();
  expect(sceneEvents(await events)).toHaveLength(3);
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
  expect(sceneEvents(results).map(e => e.type)).toEqual(["error", "scene", "scene"]);
  expect(results[0]).toMatchObject({ sceneId: "scene-1", error: expect.any(Error) });
  expect(ttsAlign).toHaveBeenCalledTimes(4);
});

it("caps invalid DSL at two scene attempts, each with one repair call", async () => {
  const { options, provider } = setup(1);
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => p.includes("motion designer") ? "{}" : base(p, o));
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("error");
  expect(provider.complete).toHaveBeenCalledTimes(6); // script + checkpoints + 2 x (scene + repair)
});

it("retries and recovers from a transient DSL transport error", async () => {
  const { options, provider } = setup(1);
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  let failed = false;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => {
    if (p.includes("motion designer") && !failed) { failed = true; throw new Error("offline"); }
    return base(p, o);
  });
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("scene");
  expect(provider.complete).toHaveBeenCalledTimes(4); // script + checkpoints + failed scene + scene
});

it("converts math before synthesis and rejects rewritten narration", async () => {
  const { options, provider, ttsAlign, beats } = setup(1);
  beats[0].say = "x^2 grows.";
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => !p.includes("motion designer") ? base(p, o)
    : JSON.stringify({ beats: groupOf(p).map(() => ({ say: "A different script.", template: "callout", variant: "box", data: { text: "x" } })) }));
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect(ttsAlign.mock.calls.map(call => call[0][0])).toEqual(["x squared grows."]); // audio is reused across the DSL retry
  expect((await events)[0]).toMatchObject({ type: "error", error: expect.objectContaining({ message: expect.stringMatching(/narration/i) }) });
});

it("compiles math anchors against the expanded spoken words", async () => {
  const { options, beats, ttsAlign } = setup(1);
  beats[0].say = "x^2 grows.";
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  const [event] = await events;
  expect(ttsAlign.mock.calls[0][0].slice(0, 2)).toEqual(["x squared grows.", "SceneAB grows."]); // one segment per beat
  expect(event.type).toBe("scene");
  if (event.type === "scene") {
    expect(event.scene.beats[0]).toMatchObject({ say: "x squared grows." });
    expect(event.timeline.events.find(e => e.verb === "move")?.start).toBeGreaterThanOrEqual(0.25 + 0.5); // swap anchored on "grows" (second spoken word of the beat)
  }
});

it("rejects invalid alignment without calling the scene model", async () => {
  const { options, provider, ttsAlign } = setup(1);
  ttsAlign.mockResolvedValue({ wavPath: "/tmp/a.wav", sec: 1, words: [{ word: "bad", start: -1, end: 3 }], segments: [{ start: 0, end: 1 }] });
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0].type).toBe("error");
  expect(ttsAlign).toHaveBeenCalledTimes(2);
  expect(provider.complete).toHaveBeenCalledTimes(2); // script + checkpoints only
});

it("rejects alignment whose segments do not match the beats", async () => {
  const { options, provider, ttsAlign } = setup(1);
  ttsAlign.mockImplementation(async segments => ({ ...fakeTts(segments, "/tmp/a.wav"), segments: [{ start: 0, end: 1 }] }));
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  expect((await events)[0]).toMatchObject({ type: "error", error: expect.objectContaining({ message: expect.stringMatching(/segments/) }) });
  expect(provider.complete).toHaveBeenCalledTimes(2);
});

it("cuts beats at the returned segment starts, so each beat clip ends with its pause on the single wav clock", async () => {
  const { options, ttsAlign } = setup(1);
  const events = collect(streamVideo(options));
  await vi.runAllTimersAsync();
  const [event] = await events;
  if (event.type !== "scene") throw new Error("expected a scene");
  const audio = await ttsAlign.mock.results[0].value as ReturnType<typeof fakeTts>;
  const says = event.timeline.events.filter(e => e.verb === "say");
  expect(says.map(e => e.start)).toEqual(audio.segments.map((s, b) => b === 0 ? 0 : s.start));
  expect(says.map(e => e.end)).toEqual([...audio.segments.slice(1).map(s => s.start), audio.sec]);
  expect(event.timeline.totalSec).toBeCloseTo(audio.sec, 9);
  expect(event.timeline.insertedSilences).toEqual([]);
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
  expect(provider.complete).toHaveBeenCalledTimes(2); // script + checkpoints
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
  ttsAlign.mockImplementation(async (segments, o) => {
    if (failed >= 0 && segments[0] === beats[startOf(failed)].say) throw new Error("tts offline");
    return synthesize(segments, o);
  });
  for (const concurrency of [1, 2, 3]) {
    let results: PipelineEvent[] | undefined;
    const pending = collect(streamVideo({ ...options, concurrency })).then(events => { results = events; });
    await vi.runAllTimersAsync();
    // Assert before awaiting: an idle unresolved promise fails without a real-time timeout.
    expect(sceneEvents(results ?? []).map(e => e.sceneId)).toEqual(["scene-1", "scene-2", "scene-3", "scene-4", "scene-5"]);
    expect(sceneEvents(results ?? []).map(e => e.type)).toEqual(Array.from({ length: 5 }, (_, i) => i === failed ? "error" : "scene"));
    await pending;
  }
});

it("resumes a paused consumer after an error with no work outstanding", async () => {
  const { options, ttsAlign, beats } = setup(5, i => i === 0 ? 500 : 1);
  const synthesize = ttsAlign.getMockImplementation()!;
  ttsAlign.mockImplementation(async (segments, o) => {
    if (segments[0] === beats[startOf(1)].say) throw new Error("tts offline");
    return synthesize(segments, o);
  });
  const stream = streamVideo(options);
  const first = stream.next();
  await vi.runAllTimersAsync();
  expect((await first).value).toMatchObject({ type: "scene", sceneId: "scene-1" });
  const rest = collect(stream).then(sceneEvents);
  let done = false;
  void rest.then(() => { done = true; });
  await vi.runAllTimersAsync();
  expect(done).toBe(true);
  expect((await rest).map(e => e.type)).toEqual(["error", "scene", "scene", "scene"]);
});

it("reports real progress: script, then narration and animation per scene, then ready, with scene totals", async () => {
  const { options } = setup(2);
  const progress: Progress[] = [];
  const events = collect(streamVideo({ ...options, concurrency: 1, onProgress: p => progress.push({ ...p }) }));
  await vi.runAllTimersAsync();
  await events;
  expect(progress[0]).toMatchObject({ step: "script", scene: 0, scenesReady: 0, scenesTotal: 0 });
  const steps0 = progress.filter(p => p.scene === 0).map(p => p.step);
  expect(steps0).toEqual(["script", "narration", "animation", "ready"]);
  expect(progress.filter(p => p.scene === 1).map(p => p.step)).toEqual(["narration", "animation", "ready"]);
  const last = progress[progress.length - 1];
  expect(last).toMatchObject({ step: "ready", scene: 1, scenesReady: 2, scenesTotal: 2 });
  expect(last.beats).toHaveLength(7);
});

it("fills gif src from an injected gifSearch", async () => {
  const { options, provider } = setup(1);
  const base = vi.mocked(provider.complete).getMockImplementation()!;
  vi.mocked(provider.complete).mockImplementation(async (p, o) => {
    if (!p.includes("motion designer")) return base(p, o);
    return answerFor(groupOf(p), k => k === 1 ? { template: "gif", variant: "center", data: { query: "mind blown", caption: "wow" } } : {});
  });
  const gifSearch = vi.fn(async (q: string) => `https://gifs.test/${encodeURIComponent(q)}.gif`);
  const events = collect(streamVideo({ ...options, gifSearch }));
  await vi.runAllTimersAsync();
  const [event] = await events;
  expect(event.type).toBe("scene");
  if (event.type !== "scene") return;
  expect(gifSearch).toHaveBeenCalledWith("mind blown");
  expect(event.scene.objects.find(o => o.type === "gif")).toMatchObject({ src: "https://gifs.test/mind%20blown.gif" });
});

it("emits checkpoints exactly once from the side call, and an invalid answer yields none", async () => {
  const good = JSON.stringify([{ afterScene: 5, kind: "mcq", prompt: "Q?", choices: ["a", "b"], answer: "a", explanation: "Because.", source: "generated" }, { bad: true }]);
  for (const answer of [good, "not json"]) {
    const { options, provider } = setup(2);
    const base = vi.mocked(provider.complete).getMockImplementation()!;
    vi.mocked(provider.complete).mockImplementation(async (p, o) => p.startsWith("Write checkpoint questions") ? answer : base(p, o));
    const events = collect(streamVideo({ ...options, exercises: [{ id: "e1", markdown: "Do a thing" }] }));
    await vi.runAllTimersAsync();
    const all = await events;
    const cps = all.filter((e): e is Extract<PipelineEvent, { type: "checkpoints" }> => e.type === "checkpoints");
    expect(cps).toHaveLength(1);
    expect(sceneEvents(all)).toHaveLength(2);
    if (answer === good) expect(cps[0].items).toMatchObject([{ id: "cp1", afterScene: 1, source: "generated" }]); // clamped to the last scene
    else expect(cps[0].items).toEqual([]);
    expect(vi.mocked(provider.complete).mock.calls.filter(c => c[0].startsWith("Write checkpoint questions"))).toHaveLength(1);
  }
});

// Textbook follow-along (docs/textbook-follow.md).
it("attaches each beat's passage boxes to its scene; unknown ids are dropped; no passages → no field", async () => {
  const { options, beats } = setup(2);
  const box = (page: number) => ({ page, bbox: [0, page / 10, 1, page / 10 + 0.05] as [number, number, number, number] });
  const passages = [{ id: "p1", markdown: "Arrays grow.", boxes: [box(1)] }, { id: "p2", markdown: "Then shrink.", boxes: [box(2), box(3)] }];
  const tagged = beats.map((b, i) => ({ ...b, passages: i === 0 ? ["p1"] : i === 1 ? ["p2", "p404"] : i === 3 ? ["p1", "p2"] : [] }));
  options.provider.complete = vi.fn(async (prompt: string) => {
    if (prompt.includes("Rewrite the textbook section")) return JSON.stringify(tagged);
    if (prompt.startsWith("Write checkpoint questions")) return "[]";
    return answerFor(groupOf(prompt));
  });
  const events = collect(streamVideo({ ...options, passages }));
  await vi.runAllTimersAsync();
  const scenes = sceneEvents(await events).filter(e => e.type === "scene");
  expect(scenes.map(s => s.passages)).toEqual([
    [[box(1)], [box(2), box(3)], []],
    [[box(1), box(2), box(3)], [], [], []],
  ]);

  const plain = setup(2);
  const out = collect(streamVideo(plain.options));
  await vi.runAllTimersAsync();
  for (const s of sceneEvents(await out)) expect(s.type === "scene" && "passages" in s).toBe(false);
});
