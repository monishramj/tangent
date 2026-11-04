import { describe, expect, it, vi } from "vitest";
import type { Timeline } from "../dsl/compile";
import { resumeTime } from "../tutor/tutor";
import { SceneQueue } from "./queue";

class FakeAudio extends EventTarget {
  currentTime = 0;
  readyState = 4;
  preload = "";
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}
const scene = (sceneId: string, totalSec = 5) => ({
  sceneId, wavPath: `${sceneId}.wav`, timeline: {
    totalSec, insertedSilences: [], events: [0, 2].map(start => ({ start, end: start + 1, verb: "say", beat: start, args: {} })),
  } as Timeline,
});
function setup(readyState = 4) {
  const audios: FakeAudio[] = [];
  const callbacks = new Map<number, () => void>();
  let id = 0;
  const render = vi.fn();
  const onChange = vi.fn();
  const onError = vi.fn();
  const queue = new SceneQueue({ render, onChange, onError,
    createAudio: () => { const audio = new FakeAudio(); audio.readyState = readyState; audios.push(audio); return audio; },
    raf: cb => { callbacks.set(++id, cb); return id; },
    caf: h => { callbacks.delete(h); },
  });
  const frame = () => { for (const [h, cb] of [...callbacks]) { callbacks.delete(h); cb(); } };
  return { queue, audios, render, onChange, onError, frame, callbacks };
}

describe("SceneQueue", () => {
  it("preloads incoming audio and grows duration without starting playback", () => {
    const { queue, audios } = setup();
    queue.enqueue(scene("a"));
    queue.enqueue(scene("b", 7));
    expect(queue.duration).toBe(12);
    expect(audios.map(a => a.preload)).toEqual(["auto", "auto"]);
    expect(audios.every(a => a.play.mock.calls.length === 0)).toBe(true);
    expect(queue.playing).toBe(false);
  });
  it("switches on ended immediately, using only the next audio clock plus its offset", () => {
    const { queue, audios, render, frame, callbacks } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b")); queue.finish();
    queue.play(); queue.play();
    audios[0].currentTime = 1.7; frame();
    expect(queue.currentTime).toBe(1.7);
    audios[0].currentTime = 5; audios[0].dispatchEvent(new Event("ended"));
    expect(audios[1].play).toHaveBeenCalledTimes(1);
    expect(queue.currentTime).toBe(5);
    audios[1].currentTime = 0.4; frame();
    expect(queue.currentTime).toBe(5.4);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ sceneId: "b" }), 0.4);
    expect(callbacks.size).toBe(1);
  });
  it("does not loop a WAV that ends before its timeline (inserted silence)", () => {
    const { queue, audios } = setup();
    queue.enqueue(scene("a"));
    queue.play();
    const real = audios[0] as FakeAudio & { ended?: boolean };
    // browsers clamp currentTime to the media duration (4s) even when set to the 5s timeline end
    Object.defineProperty(real, "currentTime", { get: () => 4, set: () => {} });
    real.ended = true; real.dispatchEvent(new Event("ended"));
    expect(real.play).toHaveBeenCalledTimes(1);
    expect(queue.buffering).toBe(true);
  });
  it("also switches at timeline end without waiting for another animation frame", () => {
    const { queue, audios, frame } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b")); queue.play();
    audios[0].currentTime = 5; frame();
    expect(audios[1].play).toHaveBeenCalledTimes(1);
    expect(queue.currentTime).toBe(5);
  });
  it("buffers at starvation and automatically resumes on arrival", () => {
    const { queue, audios, callbacks, frame } = setup();
    queue.enqueue(scene("a")); queue.play();
    audios[0].currentTime = 5; frame();
    expect(queue.buffering).toBe(true);
    expect(queue.playing).toBe(true);
    expect(callbacks.size).toBe(0);
    expect(audios[0].pause).toHaveBeenCalled();
    queue.enqueue(scene("b"));
    expect(queue.buffering).toBe(false);
    expect(audios[1].play).toHaveBeenCalledTimes(1);
    expect(queue.currentTime).toBe(5);
  });
  it("waits for preloaded audio to become playable at the boundary", () => {
    const { queue, audios, frame } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b"));
    audios[1].readyState = 0;
    queue.play(); audios[0].currentTime = 5; frame();
    expect(queue.buffering).toBe(true);
    expect(audios[1].play).not.toHaveBeenCalled();
    audios[1].readyState = 4; audios[1].dispatchEvent(new Event("canplay"));
    expect(queue.buffering).toBe(false);
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });
  it("pause during buffering cancels automatic resume; play can wait for the first scene", () => {
    const { queue, audios } = setup();
    queue.play(); expect(queue.buffering).toBe(true);
    queue.pause(); queue.enqueue(scene("a"));
    expect(audios[0].play).not.toHaveBeenCalled();
    expect(queue.buffering).toBe(false);
    queue.play(); expect(audios[0].play).toHaveBeenCalledTimes(1);
  });
  it("seeks across scenes, renders paused seeks and clamps to the known duration", () => {
    const { queue, audios, render } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b", 7));
    queue.seek(6.5);
    expect(audios[1].currentTime).toBe(1.5);
    expect(queue.currentTime).toBe(6.5);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ sceneId: "b" }), 1.5);
    queue.seek(5); expect(queue.current?.sceneId).toBe("b");
    queue.seek(99); expect(queue.currentTime).toBe(12);
    queue.seek(-1); expect(queue.currentTime).toBe(0);
  });
  it("seeks backward while playing, pausing the old scene and retaining one loop", () => {
    const { queue, audios, callbacks } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b"));
    queue.seek(6); queue.play(); queue.seek(1);
    expect(audios[1].pause).toHaveBeenCalled();
    expect(audios[0].currentTime).toBe(1);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);
  });
  it("exposes local beat starts and global offsets for tutor resume", () => {
    const { queue } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b"));
    expect(queue.sceneBeats).toEqual([
      { sceneId: "a", offset: 0, beatStarts: [0, 2] },
      { sceneId: "b", offset: 5, beatStarts: [0, 2] },
    ]);
    expect(resumeTime(queue.beatStarts, 8)).toBe(7);
  });
  it("finish clears starvation and ends rather than buffering at EOF", () => {
    const { queue, audios, frame } = setup();
    queue.enqueue(scene("a")); queue.play();
    audios[0].currentTime = 5; frame(); queue.finish();
    expect(queue.buffering).toBe(false); expect(queue.playing).toBe(false);
    queue.seek(0); queue.play(); audios[0].currentTime = 5; frame();
    expect(queue.playing).toBe(false); expect(queue.buffering).toBe(false);
  });
  it("handles rejected audio playback and cleans up loops and event listeners", async () => {
    const { queue, audios, onError, callbacks } = setup();
    queue.enqueue(scene("a")); queue.enqueue(scene("b"));
    audios[0].play.mockRejectedValueOnce(new Error("blocked"));
    queue.play(); await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "blocked" }));
    expect(queue.playing).toBe(false);
    queue.play(); queue.dispose();
    audios[0].dispatchEvent(new Event("ended"));
    expect(audios[1].play).not.toHaveBeenCalled(); expect(callbacks.size).toBe(0);
  });
  it("rejects invalid durations and ignores non-finite seeks", () => {
    const { queue } = setup();
    expect(() => queue.enqueue(scene("bad", NaN))).toThrow(/duration/i);
    expect(() => queue.enqueue(scene("bad", 0))).toThrow(/duration/i);
    queue.enqueue(scene("a")); queue.seek(NaN);
    expect(queue.currentTime).toBe(0);
  });
});
