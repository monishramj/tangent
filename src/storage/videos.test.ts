import { expect, it, vi } from "vitest";
import { fakeVideoStore, recordStream, replayStream, tauriVideoStore, videoDuration } from "./videos";
import type { PipelineEvent } from "../pipeline/streamVideo";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "list_video_bundles" ? "pong" : undefined)) }));
import { invoke } from "@tauri-apps/api/core";

const ev = (n: number, sec = 2): PipelineEvent => ({ type: "scene", sceneId: `scene-${n}`, scene: { scene: "s", objects: [], beats: [] } as never, timeline: { totalSec: sec } as never, wavPath: `/tmp/tangent-${n}.wav`, generationMs: 1 });
const source = { pdfPath: "/b.pdf", sectionId: "s1", sectionTitle: "Heaps" };
async function* of(events: PipelineEvent[], fail = false) { for (const e of events) yield e; if (fail) throw new Error("boom"); }
const drain = async (s: AsyncIterable<unknown>) => { for await (const _ of s); };

it("saves incrementally and marks complete when the stream ends", async () => {
  const store = fakeVideoStore();
  const saves: boolean[] = [];
  const save = store.save; store.save = async b => { saves.push(b.complete); return save(b); };
  const out: PipelineEvent[] = [];
  for await (const e of recordStream(of([ev(1), ev(2)]), { id: "v1", title: "Heaps", source }, store)) {
    out.push(e);
    await new Promise(r => setTimeout(r, 0));
    if (out.length === 1) expect((await store.load("v1")).scenes).toHaveLength(1); // already on disk mid-stream
  }
  await new Promise(r => setTimeout(r, 0));
  expect(out).toHaveLength(2);
  const b = await store.load("v1");
  expect(b).toMatchObject({ complete: true, scenes: [{ sceneId: "scene-1", audioFile: "/data/videos/v1/scene-1.wav", durationSec: 2 }, { sceneId: "scene-2" }] });
  expect(videoDuration(b)).toBe(4);
  expect(saves).toEqual([false, false, true]);
});

it("stays partial when the consumer leaves early, on scene errors, or on thrown errors", async () => {
  for (const run of ["early", "error", "throw"]) {
    const store = fakeVideoStore();
    const events = run === "error" ? [ev(1), { type: "error", sceneId: "scene-2", error: new Error("x") } as PipelineEvent] : [ev(1), ev(2)];
    const s = recordStream(of(events, run === "throw"), { id: "v", title: "t", source }, store)[Symbol.asyncIterator]();
    if (run === "early") { await s.next(); await s.return?.(); }
    else await drain({ [Symbol.asyncIterator]: () => s }).catch(() => {});
    await new Promise(r => setTimeout(r, 0));
    expect((await store.load("v")).complete, run).toBe(false);
  }
});

it("a save failure does not break the stream", async () => {
  const store = fakeVideoStore(); store.save = async () => { throw new Error("disk full"); };
  const onError = vi.fn();
  const out: unknown[] = [];
  for await (const e of recordStream(of([ev(1)]), { title: "t", source }, store, onError)) out.push(e);
  await new Promise(r => setTimeout(r, 0));
  expect(out).toHaveLength(1);
  expect(onError).toHaveBeenCalled();
});

it("replays stored scenes as pipeline events and the fake store lists newest first / deletes", async () => {
  const store = fakeVideoStore();
  await drain(recordStream(of([ev(1)]), { id: "a", title: "A", source }, store));
  await new Promise(r => setTimeout(r, 5));
  await drain(recordStream(of([ev(1)]), { id: "b", title: "B", source }, store));
  await new Promise(r => setTimeout(r, 0));
  expect((await store.list()).map(b => b.id)).toEqual(["b", "a"]);
  const events: PipelineEvent[] = [];
  for await (const e of replayStream(await store.load("a"))) events.push(e);
  expect(events).toMatchObject([{ type: "scene", sceneId: "scene-1", wavPath: "/data/videos/a/scene-1.wav" }]);
  await store.remove("a");
  expect((await store.list()).map(b => b.id)).toEqual(["b"]);
});

it("tauri store maps to the four commands and tolerates a non-array list", async () => {
  await tauriVideoStore.remove("x");
  expect(invoke).toHaveBeenCalledWith("delete_video_bundle", { id: "x" });
  expect(await tauriVideoStore.list()).toEqual([]);
});

it("stores checkpoints on the bundle without marking it incomplete, and replays them after the scenes", async () => {
  const store = fakeVideoStore();
  const items = [{ id: "cp1", afterScene: 0, kind: "short", prompt: "Q?", answer: "A", explanation: "E", source: "generated" }] as never;
  const cp: PipelineEvent = { type: "checkpoints", items };
  const out: PipelineEvent[] = [];
  for await (const e of recordStream(of([ev(1), cp]), { id: "c", title: "C", source }, store)) out.push(e);
  await new Promise(r => setTimeout(r, 0));
  expect(out).toHaveLength(2);
  const b = await store.load("c");
  expect(b).toMatchObject({ complete: true, checkpoints: [{ id: "cp1" }] });
  const events: PipelineEvent[] = [];
  for await (const e of replayStream(b)) events.push(e);
  expect(events.map(e => e.type)).toEqual(["scene", "checkpoints"]);
  expect(events[1]).toMatchObject({ items: [{ id: "cp1" }] });
});

// Textbook follow-along (docs/textbook-follow.md): beat → passage boxes persist so replay needs no regeneration.
it("persists and replays per-beat passage boxes; old bundles replay without them", async () => {
  const boxes = [[{ page: 3, bbox: [0.1, 0.2, 0.9, 0.3] as [number, number, number, number] }], []];
  const store = fakeVideoStore();
  await drain(recordStream(of([{ ...ev(1), passages: boxes } as PipelineEvent, ev(2)]), { id: "v", title: "t", source }, store));
  await new Promise(r => setTimeout(r, 0));
  const saved = await store.load("v");
  expect(saved.scenes[0].passages).toEqual(boxes);
  expect(saved.scenes[1].passages).toBeUndefined();
  const replayed: PipelineEvent[] = [];
  for await (const e of replayStream(saved)) replayed.push(e);
  expect(replayed[0]).toMatchObject({ type: "scene", passages: boxes });
  expect("passages" in replayed[1]).toBe(false);
  // A bundle saved before this feature (no passages anywhere) still replays scene for scene.
  const old = { ...saved, scenes: saved.scenes.map(({ passages: _p, ...s }) => s) };
  const oldEvents: PipelineEvent[] = [];
  for await (const e of replayStream(old)) oldEvents.push(e);
  expect(oldEvents.map(e => e.type === "scene" && "passages" in e)).toEqual([false, false]);
});

const gifBundle = () => ({
  id: "gif", title: "Reaction", createdAt: 0, complete: true, source,
  scenes: [{ sceneId: "s", scene: { scene: "s", beats: [], objects: [
    { id: "missing", type: "gif", query: "wow" },
    { id: "saved", type: "gif", query: "saved", src: "https://g/saved.gif" },
  ] } as unknown as import("@motion/dsl/schema").Scene, timeline: { totalSec: 2 } as never, audioFile: "/audio.wav", durationSec: 2 }],
});

it("backfills replay GIFs with a fake search without replacing saved URLs or changing the bundle", async () => {
  const bundle = gifBundle();
  const search = vi.fn(async () => "https://g/new.gif");
  const event = (await replayStream(bundle, search).next()).value;
  expect(search).toHaveBeenCalledExactlyOnceWith("wow");
  expect(event).toMatchObject({ scene: { objects: [{ src: "https://g/new.gif" }, { src: "https://g/saved.gif" }] } });
  expect(bundle.scenes[0].scene.objects[0]).not.toHaveProperty("src");
});

it("no key or a failed lookup keeps replay placeholder cards", async () => {
  for (const search of [null, vi.fn(async () => { throw new Error("offline"); })]) {
    const event = (await replayStream(gifBundle(), search).next()).value;
    expect(event).toMatchObject({ scene: { objects: [{ query: "wow" }, { src: "https://g/saved.gif" }] } });
    if (event?.type === "scene") expect(event.scene.objects[0]).not.toHaveProperty("src");
  }
});

it("uses the saved GIPHY key when no search override is supplied", async () => {
  const { resetGiphyKey } = await import("../media/giphy");
  resetGiphyKey();
  vi.mocked(invoke).mockResolvedValueOnce("KEY");
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: [{ images: { fixed_height: { url: "https://g/found.gif" } } }] })));
  vi.stubGlobal("fetch", fetchFn);
  try {
    const event = (await replayStream(gifBundle()).next()).value;
    expect(event).toMatchObject({ scene: { objects: [{ src: "https://g/found.gif" }, {}] } });
    expect(fetchFn).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); resetGiphyKey(); }
});

it("time-boxes a slow replay lookup to 1.5 seconds and ignores its late result", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (url: string) => void;
    const first = replayStream(gifBundle(), () => new Promise(resolve => { finish = resolve; })).next();
    await vi.advanceTimersByTimeAsync(1499);
    let emitted = false;
    void first.then(() => { emitted = true; });
    await Promise.resolve();
    expect(emitted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const event = (await first).value;
    finish("https://g/late.gif");
    await vi.advanceTimersByTimeAsync(0);
    if (event?.type === "scene") expect(event.scene.objects[0]).not.toHaveProperty("src");
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
