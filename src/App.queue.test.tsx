import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlayerScreen } from "./App";
import type { PipelineEvent } from "./pipeline/streamVideo";
import { scene } from "./stage/demo";
import { stubProvider } from "./tutor/glue";

const stage = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong"), convertFileSrc: (path: string) => path }));
vi.mock("./Stage", () => ({ default: (props: unknown) => { stage(props); return null; } }));
vi.mock("@/components/ShinyText", () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  const audios: (EventTarget & { currentTime: number; readyState: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> })[] = [];
  vi.stubGlobal("Audio", class extends EventTarget {
    currentTime = 0; readyState = 4; preload = "";
    play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
    constructor() { super(); audios.push(this); }
  });
  let release: (value: IteratorResult<PipelineEvent>) => void;
  const stream = {
    next: () => new Promise<IteratorResult<PipelineEvent>>(resolve => { release = resolve; }),
    return: vi.fn(async () => ({ done: true as const, value: undefined })),
    [Symbol.asyncIterator]() { return this; },
  };
  const send = async (id: string) => act(async () => {
    release({ done: false, value: { type: "scene", sceneId: id, scene: { ...scene, scene: id }, wavPath: `${id}.wav`, generationMs: 1,
      timeline: { totalSec: 5, insertedSilences: [], events: [0, 2].map(start => ({ start, end: start + 1, verb: "say", beat: start, args: {} })) } } });
  });
  return { stream, audios, send };
}

it("feeds streamed scenes into the stage and growing scrubber; shows and clears buffering", async () => {
  const { stream, audios, send } = setup();
  const view = render(<PlayerScreen stream={stream} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(screen.getByRole("status", { name: "Buffering" })).toBeTruthy();
  await send("one");
  expect(screen.queryByRole("status", { name: "Buffering" })).toBeNull();
  expect(screen.getByRole("slider").getAttribute("max")).toBe("5");
  act(() => { audios[0].currentTime = 5; audios[0].dispatchEvent(new Event("ended")); });
  expect(screen.getByRole("status", { name: "Buffering" })).toBeTruthy();
  await send("two");
  expect(screen.getByRole("slider").getAttribute("max")).toBe("10");
  expect(stage).toHaveBeenLastCalledWith(expect.objectContaining({ scene: expect.objectContaining({ scene: "two" }) }));
  expect(audios[1].play).toHaveBeenCalledTimes(1);
  view.unmount(); expect(stream.return).toHaveBeenCalledTimes(1);
});

it("tutor Resume seeks to a globally offset beat in the active streamed scene", async () => {
  const { stream, audios, send } = setup();
  render(<PlayerScreen stream={stream} provider={stubProvider} />);
  await act(async () => {});
  await send("one"); await send("two");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  fireEvent.change(screen.getByLabelText(/ask about this moment/i), { target: { value: "Why?" } });
  fireEvent.submit(screen.getByLabelText(/ask about this moment/i).closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
  expect(audios[1].currentTime).toBe(2);
  expect(screen.getByRole("slider").getAttribute("value")).toBe("7");
});
