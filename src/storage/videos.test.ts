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
