import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PlayerScreen, { clock } from "./PlayerScreen";
import type { PipelineEvent } from "@/pipeline/streamVideo";
import type { Checkpoint } from "@/gen/checkpoints";
import type { LLMProvider } from "@/llm/provider";
import { memoryJsonStore, type Thread } from "@/storage/projects";
import { scene, timeline } from "@/stage/demo";
import { narrationLines } from "@/tutor/narration";

const stage = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null), convertFileSrc: (p: string) => p }));
vi.mock("@/Stage", () => ({ default: (props: unknown) => { stage(props); return null; } }));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); stage.mockClear(); });

type FakeAudio = EventTarget & { currentTime: number; readyState: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };
const sceneEvent = (id = "s1"): Extract<PipelineEvent, { type: "scene" }> => ({ type: "scene", sceneId: id, scene, timeline, wavPath: `${id}.wav`, generationMs: 1 });
const mcq: Checkpoint = { id: "cp1", afterScene: 0, kind: "mcq", prompt: "Which child swaps?", choices: ["The bigger", "The smaller"], answer: "The bigger", explanation: "Bigger keeps the heap valid.", source: "generated" };

/** A stream the test drives by hand. */
function setup(opts: { provider?: LLMProvider; store?: ReturnType<typeof memoryJsonStore> } = {}) {
  const audios: FakeAudio[] = [];
  vi.stubGlobal("Audio", class extends EventTarget {
    currentTime = 0; readyState = 4; preload = "";
    play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    constructor() { super(); audios.push(this as unknown as FakeAudio); }
  });
  const pending: ((r: IteratorResult<PipelineEvent>) => void)[] = [];
  const buffered: IteratorResult<PipelineEvent>[] = [];
  const stream: AsyncIterable<PipelineEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: () => buffered.length ? Promise.resolve(buffered.shift()!) : new Promise(r => pending.push(r)),
      return: async () => ({ done: true as const, value: undefined }),
    }),
  };
  const deliver = (r: IteratorResult<PipelineEvent>) => { const f = pending.shift(); if (f) f(r); else buffered.push(r); };
  const push = (ev: PipelineEvent) => act(async () => { deliver({ done: false, value: ev }); });
  const end = () => act(async () => { deliver({ done: true, value: undefined }); });
  const store = opts.store ?? memoryJsonStore();
  const complete = vi.fn().mockResolvedValue(JSON.stringify({ answer: "Because the bigger child keeps the heap valid.", annotations: [] }));
  const provider = opts.provider ?? { complete };
  const props = { stream, title: "Heapify", videoId: "vid1", store, provider, onRetry: vi.fn(), onBack: vi.fn(), onPinNote: vi.fn() };
  const view = render(<PlayerScreen {...props} />);
  return { ...props, complete, audios, push, end, view };
}
const settle = () => act(async () => {});
const startWithScene = async (s: ReturnType<typeof setup>) => { await settle(); await s.push(sceneEvent()); };
const ask = async (q: string, label = "Ask about this moment") => {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: q } });
  await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
};

it("shows progress Loading before the first scene, then the title and a 16:9 video box", async () => {
  const s = setup();
  await settle();
  expect(screen.getByRole("heading", { name: "Heapify" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Generation progress" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.getByTestId("video").className).toContain("aspect-video");
  await s.push(sceneEvent());
  expect(screen.queryByRole("status", { name: "Generation progress" })).toBeNull();
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({ scene }));
  expect(screen.getByRole("slider").getAttribute("max")).toBe(String(timeline.totalSec));
});

it("play and pause buttons drive the audio", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(s.audios[0].play).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(s.audios[0].pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
});

it("scrubbing never calls play per input event, then resumes once on release", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const slider = screen.getByRole("slider");
  fireEvent.pointerDown(slider);
  s.audios[0].play.mockClear();
  for (const v of [1, 2, 3]) fireEvent.change(slider, { target: { value: String(v) } });
  expect(s.audios[0].play).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  expect(s.audios[0].play).toHaveBeenCalledTimes(1);
});

it("an error before any scene shows an alert and Try again calls onRetry", async () => {
  const s = setup();
  await settle();
  await s.push({ type: "error", sceneId: "scene-1", error: new Error("boom") } as PipelineEvent);
  expect(screen.getByRole("alert").textContent).toContain("boom");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(s.onRetry).toHaveBeenCalledTimes(1);
});

it("an error after a scene is skipped, not overlaid", async () => {
  const s = setup();
  await startWithScene(s);
  await s.push({ type: "error", sceneId: "scene-2", error: new Error("late") } as PipelineEvent);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("Ask pauses and opens the side panel; the question is answered and saved as a thread", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(s.audios[0].pause).toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Side panel" })).toBeTruthy();
  await ask("Why the bigger child?");
  await screen.findByText("Because the bigger child keeps the heap valid.");
  const panel = within(screen.getByRole("dialog"));
  expect(panel.getByText("Why the bigger child?")).toBeTruthy();
  expect(s.complete).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    const saved = s.store.data.get("threads-vid1") as Thread[];
    expect(saved).toHaveLength(1);
    expect(saved[0].messages.map(m => m.role)).toEqual(["user", "tutor"]);
    expect(saved[0].title).toBe("Why the bigger child?");
  });
});

it("a follow-up in the same thread sends the history", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("First?");
  await screen.findByText(/keeps the heap valid/);
  await ask("And then?", "Reply in thread");
  await waitFor(() => expect(s.complete).toHaveBeenCalledTimes(2));
  const second = s.complete.mock.calls[1][0] as string;
  expect(second).toContain("This thread so far");
  expect(second).toContain("Student: First?");
  expect(s.complete.mock.calls[0][0]).not.toContain("This thread so far");
  await waitFor(() => expect((s.store.data.get("threads-vid1") as Thread[])[0].messages).toHaveLength(4));
});

it("a failing provider yields a graceful tutor message", async () => {
  const s = setup({ provider: { complete: vi.fn().mockRejectedValue(new Error("down")) } });
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("Hello?");
  await screen.findByText(/couldn't answer that just now/);
});

it("thread list after 'All questions', a scrubber marker, Pin to notes, and Resume", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("Why?");
  await screen.findByText(/keeps the heap valid/);
  fireEvent.click(screen.getByRole("button", { name: /Pin to notes/ }));
  expect(s.onPinNote).toHaveBeenCalledWith("Q: Why?\nA: Because the bigger child keeps the heap valid.", 0);
  fireEvent.click(screen.getByRole("button", { name: "All questions" }));
  expect(within(screen.getByRole("list", { name: "Questions" })).getByText("Why?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Question at 0:00: Why?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Question at 0:00: Why?" }));
  fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  expect(s.audios[0].play).toHaveBeenCalled();
});

it("threads saved earlier load for this video", async () => {
  const th: Thread = { id: "old", videoId: "vid1", t: 2, title: "Old question", messages: [{ role: "user", text: "Old question", at: 1 }, { role: "tutor", text: "Old answer", at: 2 }] };
  const s = setup({ store: memoryJsonStore({ "threads-vid1": [th] }) });
  await startWithScene(s);
  expect(await screen.findByRole("button", { name: "Question at 0:02: Old question" })).toBeTruthy();
});

it("Transcript lists narration lines and clicking one seeks", async () => {
  const s = setup();
  await startWithScene(s);
  const lines = narrationLines([{ scene, timeline }]);
  expect(lines.length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
  const list = within(screen.getByRole("list", { name: "Transcript" }));
  for (const l of lines) expect(list.getByText(l.say)).toBeTruthy();
  fireEvent.click(list.getByText(lines[1].say));
  expect(s.audios[0].currentTime).toBeCloseTo(lines[1].t, 3);
});

async function reachEnd(s: ReturnType<typeof setup>) {
  await s.push({ type: "checkpoints", items: [mcq] });
  await s.push(sceneEvent());
  await s.end();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => { s.audios[0].currentTime = timeline.totalSec; s.audios[0].dispatchEvent(new Event("ended")); });
}

it("checkpoint opens at the end of the scene; the right answer is graded and stored", async () => {
  const s = setup();
  await settle();
  await reachEnd(s);
  const card = await screen.findByRole("region", { name: "Checkpoint" });
  expect(within(card).getByText("Which child swaps?")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Check" }).getAttribute("aria-selected")).toBe("true");
  await act(async () => { fireEvent.click(within(card).getByRole("radio", { name: "The bigger" })); });
  await screen.findByText("Nailed it.");
  expect(screen.queryByRole("button", { name: "Ask about it" })).toBeNull();
  await waitFor(() => expect(s.store.data.get("checks-vid1")).toEqual({ cp1: expect.objectContaining({ response: "The bigger", correct: true }) }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.queryByRole("region", { name: "Checkpoint" })).toBeNull();
});

it("a wrong answer offers 'Ask about it', which opens a thread", async () => {
  const s = setup();
  await settle();
  await reachEnd(s);
  const card = await screen.findByRole("region", { name: "Checkpoint" });
  await act(async () => { fireEvent.click(within(card).getByRole("radio", { name: "The smaller" })); });
  await screen.findByText("Not quite.");
  await waitFor(() => expect((s.store.data.get("checks-vid1") as Record<string, { correct: boolean }>).cp1.correct).toBe(false));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask about it" })); });
  await screen.findByText(/I got this checkpoint wrong/);
  expect(screen.getByRole("tab", { name: "Ask" }).getAttribute("aria-selected")).toBe("true");
  expect(s.complete).toHaveBeenCalledTimes(1);
  expect(s.complete.mock.calls[0][0]).toContain("Why is the answer \"The bigger\"");
  await waitFor(() => expect((s.store.data.get("threads-vid1") as Thread[])).toHaveLength(1));
});

it("the dock Play/Pause button toggles playback", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(s.audios[0].play).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Pause video" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(s.audios[0].pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

it("hovering the seek bar previews the time and scene without seeking", async () => {
  const s = setup();
  await startWithScene(s);
  const wrap = screen.getByRole("slider").parentElement!;
  wrap.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 10, height: 10, x: 0, y: 0, toJSON() {} });
  fireEvent.pointerMove(wrap, { clientX: 50 });
  expect(screen.getByTestId("scrub-preview").textContent).toBe(`${clock(timeline.totalSec / 2)} · Scene 1`);
  expect(s.audios[0].currentTime).toBe(0);
  fireEvent.pointerLeave(wrap);
  expect(screen.queryByTestId("scrub-preview")).toBeNull();
});

it("clicking a scene card seeks to that scene's offset", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const s = setup();
  await startWithScene(s); await s.push(sceneEvent("s2"));
  fireEvent.click(screen.getByRole("button", { name: "Scenes" }));
  fireEvent.click(screen.getByRole("option", { name: /2\. Scene 2/ }));
  expect(Number((screen.getByLabelText("Seek") as HTMLInputElement).value)).toBeCloseTo(timeline.totalSec, 1);
});
