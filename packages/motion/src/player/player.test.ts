import { describe, expect, it, vi } from "vitest";
import { Player } from "./player";

function setup(totalSec = 10) {
  const audio = { currentTime: 0, play: vi.fn(() => Promise.resolve()), pause: vi.fn() };
  const cbs = new Map<number, () => void>();
  let id = 0;
  const raf = (cb: () => void) => (cbs.set(++id, cb), id);
  const caf = (h: number) => void cbs.delete(h);
  const frame = () => { const [h, cb] = [...cbs][0]; cbs.delete(h); cb(); };
  const render = vi.fn();
  const p = new Player({ timeline: { totalSec }, audio, render, raf, caf });
  return { audio, cbs, frame, render, p };
}

describe("Player", () => {
  it("renders the audio clock time every frame, not accumulated dt", () => {
    const { audio, frame, render, p } = setup();
    p.play();
    expect(audio.play).toHaveBeenCalled();
    audio.currentTime = 1.5; frame();
    audio.currentTime = 1.6; frame();
    expect(render.mock.calls.map((c) => c[0])).toEqual([1.5, 1.6]);
  });
  it("pause stops the loop and the audio", () => {
    const { audio, cbs, p } = setup();
    p.play(); p.pause();
    expect(audio.pause).toHaveBeenCalled();
    expect(cbs.size).toBe(0);
  });
  it("seek while paused renders exactly one frame at the new time", () => {
    const { audio, cbs, render, p } = setup();
    p.seek(4);
    expect(audio.currentTime).toBe(4);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(4);
    expect(cbs.size).toBe(0);
  });
  it("seek while playing sets the clock and lets the loop render; clamps", () => {
    const { audio, render, p } = setup();
    p.play(); p.seek(99);
    expect(audio.currentTime).toBe(10);
    expect(render).not.toHaveBeenCalled();
    p.seek(-5);
    expect(audio.currentTime).toBe(0);
  });
  it("stop cancels rAF, pauses and rewinds with one render", () => {
    const { audio, cbs, render, p } = setup();
    p.play(); audio.currentTime = 3; p.stop();
    expect(cbs.size).toBe(0);
    expect(audio.currentTime).toBe(0);
    expect(render).toHaveBeenLastCalledWith(0);
  });
  it("play is idempotent (one rAF chain) and ends at totalSec", () => {
    const { audio, cbs, frame, render, p } = setup(2);
    p.play(); p.play();
    expect(cbs.size).toBe(1);
    audio.currentTime = 2.1; frame();
    expect(render).toHaveBeenLastCalledWith(2.1);
    expect(cbs.size).toBe(0);
    expect(audio.pause).toHaveBeenCalled();
  });
});
