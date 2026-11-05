import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PlayerScreen, { IDLE_MS, clock } from "./PlayerScreen";
import type { PipelineEvent } from "@/pipeline/streamVideo";
import type { Checkpoint } from "@/gen/checkpoints";
import type { LLMProvider } from "@/llm/provider";
import { memoryJsonStore, type Thread } from "@/storage/store";
import { scene, timeline } from "@motion/stage/demo";
import { narrationLines } from "@/tutor/narration";
import { DEFAULT_GAP_SEC } from "@motion/player/queue";
import { captionCues } from "./Captions";

const stage = vi.fn();
const snap = vi.hoisted(() => ({ image: "FRAMEPNG" as string | null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null), convertFileSrc: (p: string) => p }));
vi.mock("@/Stage", () => ({ default: (props: { snapshotRef?: { current: unknown } }) => {
  stage(props);
  if (props.snapshotRef) props.snapshotRef.current = async () => snap.image;
  return null;
} }));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); stage.mockClear(); localStorage.clear(); snap.image = "FRAMEPNG"; });

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
  const props = { stream, title: "Heapify", videoId: "vid1", store, provider, onRetry: vi.fn(), onBack: vi.fn() };
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
  expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
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
  expect(second).toContain("Student: First?");
  expect(s.complete.mock.calls[0][0]).toContain("(this is the first question)");
  await waitFor(() => expect((s.store.data.get("threads-vid1") as Thread[])[0].messages).toHaveLength(4));
});

it("a failing provider yields a graceful tutor message", async () => {
  const s = setup({ provider: { complete: vi.fn().mockRejectedValue(new Error("down")) } });
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("Hello?");
  await screen.findByText(/couldn't answer that just now/);
});

it("thread list after 'All questions', a scrubber marker, and Resume", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("Why?");
  await screen.findByText(/keeps the heap valid/);
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

it("reopening Ask at the same moment returns to the open thread; at another moment it starts a new question", async () => {
  const s = setup();
  await startWithScene(s); await s.push(sceneEvent("s2"));
  const askBtn = () => screen.getByRole("button", { name: "Ask" });
  fireEvent.click(askBtn());
  await ask("Why?");
  await screen.findByText(/keeps the heap valid/);
  fireEvent.click(askBtn()); // close
  fireEvent.click(askBtn()); // same moment
  expect(screen.getByLabelText("Reply in thread")).toBeTruthy();
  fireEvent.click(askBtn());
  fireEvent.click(screen.getByRole("button", { name: "Next scene" })); // > 3 s away, another scene
  fireEvent.click(askBtn());
  const box = screen.getByLabelText("Ask about this moment");
  expect(document.activeElement).toBe(box);
  expect(screen.queryByLabelText("Reply in thread")).toBeNull();
  expect(within(screen.getByRole("list", { name: "Questions" })).getByText("Why?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Question at 0:00: Why?" })); // a marker still opens its thread
  expect(screen.getByLabelText("Reply in thread")).toBeTruthy();
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

it("checkpoint pauses at the end of its scene and opens inside the video; the right answer is graded and stored", async () => {
  const s = setup();
  await settle();
  await reachEnd(s);
  const card = await screen.findByRole("region", { name: "Checkpoint" });
  expect(screen.getByTestId("video").contains(card)).toBe(true);
  expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull();
  expect(within(card).getByText("Which child swaps?")).toBeTruthy();
  expect(within(card).getByText(/Checkpoint 1/)).toBeTruthy();
  await act(async () => { fireEvent.click(within(card).getByRole("radio", { name: "The bigger" })); });
  await screen.findByText("Nailed it.");
  expect(screen.queryByRole("button", { name: "Ask about it" })).toBeNull();
  await waitFor(() => expect(s.store.data.get("checks-vid1")).toEqual({ cp1: expect.objectContaining({ response: "The bigger", correct: true }) }));
  expect(screen.getByTestId("checks-badge").textContent).toBe("1/1");
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
  expect(screen.queryByRole("region", { name: "Checkpoint" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Ask" }).getAttribute("aria-selected")).toBe("true");
  expect(s.complete).toHaveBeenCalledTimes(1);
  expect(s.complete.mock.calls[0][0]).toContain("Why is the answer");
  await waitFor(() => expect((s.store.data.get("threads-vid1") as Thread[])).toHaveLength(1));
});

it("the bottom Play/Pause button toggles playback; the center play shows only while paused", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(s.audios[0].play).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(s.audios[0].pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

it("Space toggles playback, but not while typing", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.keyDown(window, { key: " " });
  expect(s.audios[0].play).toHaveBeenCalledTimes(1);
  const box = document.createElement("textarea"); document.body.appendChild(box);
  fireEvent.keyDown(box, { key: " " });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  box.remove();
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

it("Next scene seeks to the next scene's offset", async () => {
  const s = setup();
  await startWithScene(s); await s.push(sceneEvent("s2"));
  expect((screen.getByRole("button", { name: "Previous scene" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next scene" }));
  expect(Number((screen.getByLabelText("Seek") as HTMLInputElement).value)).toBeCloseTo(timeline.totalSec + DEFAULT_GAP_SEC, 1);
});

// --- checkpoints mid-video, the Checks tab, quiz, captions, speed, chrome, and what the tutor sees ---

const mid: Checkpoint = { ...mcq, id: "cp1", afterScene: 0, prompt: "Mid question?" };
const last: Checkpoint = { ...mcq, id: "cp2", afterScene: 1, kind: "short", prompt: "Last question?", choices: undefined, answer: "A sentence." };

it("a mid-video checkpoint pauses when its scene ends, and Continue resumes the next scene", async () => {
  const s = setup();
  await settle();
  await s.push({ type: "checkpoints", items: [last, mid] });
  await s.push(sceneEvent("s1")); await s.push(sceneEvent("s2"));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => { s.audios[0].currentTime = timeline.totalSec; s.audios[0].dispatchEvent(new Event("ended")); });
  const card = await screen.findByRole("region", { name: "Checkpoint" });
  expect(within(card).getByText("Mid question?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); // paused
  s.audios[1].play.mockClear();
  await act(async () => { fireEvent.click(within(card).getByRole("radio", { name: "The bigger" })); });
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  expect(s.audios[1].play).toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Checkpoint" })).toBeNull();
});

const openChecks = () => { fireEvent.click(screen.getByRole("button", { name: "Checks" })); return within(screen.getByRole("navigation", { name: "Checks" })); };

it("header buttons are icon-only with tooltips; Checks shows an answered/total badge and opens the Checks tab", async () => {
  const s = setup();
  await settle();
  await s.push({ type: "checkpoints", items: [last, mid] });
  await s.push(sceneEvent("s1"));
  for (const name of ["Checks", "Transcript", "Ask", "Toggle fullscreen", "Back"]) {
    const b = screen.getByRole("button", { name });
    expect(b.getAttribute("title")).toBeTruthy();
    expect(b.textContent).not.toContain(name);
  }
  expect(screen.getByTestId("checks-badge").textContent).toBe("0/2");
  openChecks();
  expect(screen.getByRole("tab", { name: "Checks" }).getAttribute("aria-selected")).toBe("true");
});

it("the Checks tab lists checkpoints by scene; one opens its card paused at the scene end; Skip records a skip", async () => {
  const s = setup();
  await settle();
  await s.push({ type: "checkpoints", items: [last, mid] });
  await s.push(sceneEvent("s1"));
  expect(screen.getByRole("button", { name: `Checkpoint 1 at ${clock(timeline.totalSec)}` })).toBeTruthy();
  const list = openChecks();
  const items = list.getAllByRole("button");
  expect(items.map(c => c.getAttribute("aria-label"))).toEqual(["Checkpoint 1: Mid question? (upcoming)", "Checkpoint 2: Last question? (upcoming)"]);
  expect((items[1] as HTMLButtonElement).disabled).toBe(true); // its scene hasn't arrived yet
  fireEvent.click(items[0]);
  const card = screen.getByRole("region", { name: "Checkpoint" });
  expect(within(card).getByText("Mid question?")).toBeTruthy();
  expect(s.audios[0].currentTime).toBeCloseTo(timeline.totalSec - 0.05, 2);
  fireEvent.click(within(card).getByRole("button", { name: "Skip" }));
  expect(screen.queryByRole("region", { name: "Checkpoint" })).toBeNull();
  expect(list.getByRole("button", { name: "Checkpoint 1: Mid question? (skipped)" })).toBeTruthy();
  await waitFor(() => expect((s.store.data.get("checks-vid1") as Record<string, { skipped?: boolean }>).cp1.skipped).toBe(true));
});

it("saved results show in the list and badge, and an answered checkpoint never auto-pops again", async () => {
  const s = setup({ store: memoryJsonStore({ "checks-vid1": { cp1: { response: "x", correct: false, at: 1 }, cp2: { response: "y", correct: true, at: 2 } } }) });
  await settle();
  await s.push({ type: "checkpoints", items: [mid, last] });
  await s.push(sceneEvent("s1")); await s.push(sceneEvent("s2"));
  await waitFor(() => expect(screen.getByTestId("checks-badge").textContent).toBe("2/2"));
  const list = openChecks();
  expect(list.getByRole("button", { name: "Checkpoint 1: Mid question? (wrong)" })).toBeTruthy();
  expect(list.getByRole("button", { name: "Checkpoint 2: Last question? (right)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => { s.audios[0].currentTime = timeline.totalSec; s.audios[0].dispatchEvent(new Event("ended")); });
  expect(screen.queryByRole("region", { name: "Checkpoint" })).toBeNull();
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); // still playing
});

it("pressing the bottom Play while a card is open records a skip and plays on", async () => {
  const s = setup();
  await settle();
  await s.push({ type: "checkpoints", items: [mid] });
  await s.push(sceneEvent("s1")); await s.push(sceneEvent("s2"));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => { s.audios[0].currentTime = timeline.totalSec; s.audios[0].dispatchEvent(new Event("ended")); });
  await screen.findByRole("region", { name: "Checkpoint" });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(screen.queryByRole("region", { name: "Checkpoint" })).toBeNull();
  await waitFor(() => expect((s.store.data.get("checks-vid1") as Record<string, { skipped?: boolean }>).cp1.skipped).toBe(true));
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

it("two checkpoints after one scene pop one after the other before the next scene", async () => {
  const s = setup();
  await settle();
  const second: Checkpoint = { ...mid, id: "cp3", prompt: "Second question?" };
  await s.push({ type: "checkpoints", items: [mid, second] });
  await s.push(sceneEvent("s1")); await s.push(sceneEvent("s2"));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => { s.audios[0].currentTime = timeline.totalSec; s.audios[0].dispatchEvent(new Event("ended")); });
  await act(async () => { fireEvent.click(within(await screen.findByRole("region", { name: "Checkpoint" })).getByRole("button", { name: "Skip" })); });
  expect(within(screen.getByRole("region", { name: "Checkpoint" })).getByText("Second question?")).toBeTruthy();
  expect(s.audios[1].play).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(within(screen.getByRole("region", { name: "Checkpoint" })).getByRole("button", { name: "Skip" })); });
  expect(s.audios[1].play).toHaveBeenCalled();
});

it("a checkpoint with a table shows it as context on the card", async () => {
  const s = setup();
  await settle();
  const withTable = { ...mid, table: { headers: ["i", "A[i]"], rows: [["0", "9"], ["1", "4"]] } } as Checkpoint;
  await s.push({ type: "checkpoints", items: [withTable] });
  await s.push(sceneEvent("s1"));
  fireEvent.click(openChecks().getByRole("button", { name: /Checkpoint 1/ }));
  const ctx = within(screen.getByRole("region", { name: "Checkpoint" })).getByTestId("check-context");
  expect(within(ctx).getAllByRole("columnheader").map(h => h.textContent)).toEqual(["i", "A[i]"]);
  expect(within(ctx).getAllByRole("row")).toHaveLength(3);
});

it("Take the quiz steps through the ready questions and ends with scenes to rewatch", async () => {
  const s = setup();
  await settle();
  const q2: Checkpoint = { ...mcq, id: "cp9", afterScene: 1, prompt: "Root after?" };
  await s.push({ type: "checkpoints", items: [mid, q2] });
  await s.push(sceneEvent("s1")); await s.push(sceneEvent("s2")); await s.end();
  openChecks();
  fireEvent.click(screen.getByRole("button", { name: /Take the quiz/ }));
  const quiz = within(screen.getByRole("dialog", { name: "Quiz" }));
  expect(quiz.getByText(/Question/).textContent).toContain("1 of 2");
  await act(async () => { fireEvent.click(quiz.getByRole("radio", { name: "The bigger" })); });
  await quiz.findByText("Nailed it.");
  fireEvent.click(quiz.getByRole("button", { name: "Next question" }));
  expect(quiz.getAllByText("Root after?").length).toBeGreaterThan(0);
  await act(async () => { fireEvent.click(quiz.getAllByRole("radio", { name: "The smaller" }).slice(-1)[0]); });
  await quiz.findByText("Not quite.");
  fireEvent.click(quiz.getByRole("button", { name: "See results" }));
  expect(quiz.getByLabelText("1 of 2 right")).toBeTruthy();
  await waitFor(() => expect(Object.keys(s.store.data.get("checks-vid1") as object).sort()).toEqual(["cp1", "cp9"]));
  fireEvent.click(quiz.getByRole("button", { name: "Rewatch scene 2" }));
  expect(screen.queryByRole("dialog", { name: "Quiz" })).toBeNull();
  expect(Number((screen.getByLabelText("Seek") as HTMLInputElement).value)).toBeCloseTo(timeline.totalSec + DEFAULT_GAP_SEC, 1);
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

it("captions sit over the video (not in the canvas), show the current beat as plain text, and CC toggles and persists", async () => {
  const s = setup();
  await startWithScene(s);
  const cues = captionCues([{ scene, timeline }]);
  const region = screen.getByRole("region", { name: "Captions" });
  expect(screen.getByTestId("video").contains(region)).toBe(false);
  expect(screen.getByTestId("frame").contains(region)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  const t = (cues[1].start + cues[1].end) / 2;
  await act(async () => { s.audios[0].currentTime = t; s.audios[0].dispatchEvent(new Event("timeupdate")); });
  fireEvent.click(screen.getByRole("button", { name: "Pause" })); // re-renders at the paused time
  const text = region.textContent!.replace(/\s+/g, " ").trim();
  expect(text.length).toBeGreaterThan(0);
  expect(cues[1].text.replace(/\s+/g, " ")).toContain(text);
  expect(region.querySelectorAll("[data-current]").length).toBe(0);
  const cc = screen.getByRole("button", { name: "Captions" });
  expect(cc.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(cc);
  expect(screen.queryByRole("region", { name: "Captions" })).toBeNull();
  expect(localStorage.getItem("tangent.cc")).toBe("off");
  cleanup();
  setup();
  expect(screen.getByRole("button", { name: "Captions" }).getAttribute("aria-pressed")).toBe("false");
});

it("speed menu sets the audio rate, persists it, and < / > step it (not while typing)", async () => {
  const s = setup();
  await startWithScene(s);
  const audio = s.audios[0] as FakeAudio & { playbackRate?: number; preservesPitch?: boolean };
  expect(audio.playbackRate).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Playback speed" }));
  fireEvent.click(within(screen.getByRole("menu", { name: "Speed" })).getByRole("menuitemradio", { name: "1.5×" }));
  expect(audio.playbackRate).toBe(1.5);
  expect(audio.preservesPitch).toBe(true);
  expect(localStorage.getItem("tangent.speed")).toBe("1.5");
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.keyDown(window, { key: ">" });
  expect(audio.playbackRate).toBe(1.75);
  fireEvent.keyDown(window, { key: "<" }); fireEvent.keyDown(window, { key: "<" });
  expect(audio.playbackRate).toBe(1.25);
  const box = document.createElement("textarea"); document.body.appendChild(box);
  fireEvent.keyDown(box, { key: ">" });
  expect(audio.playbackRate).toBe(1.25);
  box.remove();
  cleanup();
  const again = setup();
  await startWithScene(again);
  expect((again.audios[0] as FakeAudio & { playbackRate?: number }).playbackRate).toBe(1.25);
  expect(screen.getByRole("button", { name: "Playback speed" }).textContent).toBe("1.25×");
});

it("chrome over the video fades out after idle playback and comes back on pointer move; stays while paused", async () => {
  const s = setup();
  await startWithScene(s);
  const frame = screen.getByTestId("frame");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    expect(frame.dataset.chrome).toBe("shown");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => { vi.advanceTimersByTime(IDLE_MS + 10); });
    expect(frame.dataset.chrome).toBe("hidden");
    expect(screen.getByRole("button", { name: "Pause" }).closest("[data-hidden]")).toBeTruthy();
    fireEvent.pointerMove(frame);
    expect(frame.dataset.chrome).toBe("shown");
    act(() => { vi.advanceTimersByTime(IDLE_MS + 10); });
    expect(frame.dataset.chrome).toBe("hidden");
    fireEvent.keyDown(window, { key: "k" }); // pause
    act(() => { vi.advanceTimersByTime(IDLE_MS * 2); });
    expect(frame.dataset.chrome).toBe("shown");
  } finally { vi.useRealTimers(); }
});

it("Ask sends the frame, what's on screen, and the line being said", async () => {
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("What is that?");
  await screen.findByText(/keeps the heap valid/);
  const [prompt, opts] = s.complete.mock.calls[0];
  expect(opts).toEqual({ images: ["FRAMEPNG"] });
  expect(prompt).toContain("<screen>");
  expect(prompt).toContain("<now_saying>");
  expect(prompt).toContain(narrationLines([{ scene, timeline }])[0].say.split(" ")[0]);
});

it("without a frame the question still goes through, text only", async () => {
  snap.image = null;
  const s = setup();
  await startWithScene(s);
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await ask("Hm?");
  await screen.findByText(/keeps the heap valid/);
  expect(s.complete.mock.calls[0][1]).toBeUndefined();
});
