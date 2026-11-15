import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Scene } from "@motion/dsl/schema";
import type { Timeline } from "@motion/dsl/compile";
import Stage from "./Stage";

const mocks = vi.hoisted(() => ({ render: vi.fn(), renderers: [] as { draw: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock("pixi.js", () => ({ Application: class {
  canvas = document.createElement("canvas");
  renderer = { on: vi.fn(), off: vi.fn() };
  init = vi.fn(async () => {});
  render = mocks.render;
  destroy = vi.fn();
} }));
vi.mock("@motion/stage/renderer", () => ({ SceneRenderer: class {
  draw = vi.fn(); destroy = vi.fn(); setAnnotations = vi.fn();
  constructor() { mocks.renderers.push(this); }
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.renderers.length = 0; });
const scene: Scene = { scene: "test", objects: [{ id: "a", type: "text", text: "A" }], beats: [] } as Scene;
const timeline: Timeline = { totalSec: 2, insertedSilences: [], events: [{ start: 0, end: .1, verb: "create", target: "a", args: {}, beat: 0 }] };

it("rebuilds both scene frames from audio time across pause, seek and rejoin", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const drawRef = createRef<((t: number) => void) | null>();
  await act(async () => { render(<Stage scene={scene} timeline={timeline} previous={{ scene, timeline }} drawRef={drawRef} />); });
  const [old, incoming] = mocks.renderers;
  for (const t of [0, .1, .2, .4, 1, .2, .2]) {
    act(() => drawRef.current!(t));
    const p = t >= .4 ? 1 : t === 0 ? 0 : t === .1 ? .0625 : .5;
    expect(old.draw).toHaveBeenLastCalledWith(expect.anything(), { x: -p, opacity: 1 - p }, false);
    expect(incoming.draw).toHaveBeenLastCalledWith(expect.anything(), { x: 1 - p, opacity: p }, false);
    expect(old.draw.mock.lastCall![0].objects.get("a").opacity).toBe(1);
  }
  expect(mocks.render).toHaveBeenCalledTimes(8); // initial frame, then each supplied audio time
  cleanup();
  expect(old.destroy).toHaveBeenCalledOnce();
  expect(incoming.destroy).toHaveBeenCalledOnce();
  expect(drawRef.current).toBeNull();
});

it("starts the first scene without an entrance transition", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const drawRef = createRef<((t: number) => void) | null>();
  await act(async () => { render(<Stage scene={scene} timeline={timeline} drawRef={drawRef} />); });
  expect(mocks.renderers).toHaveLength(1);
  expect(mocks.renderers[0].draw).toHaveBeenLastCalledWith(expect.anything(), { x: 0, opacity: 1 }, false);
});
