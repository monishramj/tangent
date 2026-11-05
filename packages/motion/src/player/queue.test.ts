import { describe, expect, it, vi } from "vitest";
import type { Timeline } from "../dsl/compile";
import { resumeTime } from "./queue";
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
// Most tests check scene switching itself, so they run with no inter-scene gap.
function setup(readyState = 4, gapSec = 0) {
  const audios: FakeAudio[] = [];
  const callbacks = new Map<number, () => void>();
  let id = 0;
  const render = vi.fn();
  const onChange = vi.fn();
  const onError = vi.fn();
  const clock = { ms: 0 };
  const queue = new SceneQueue({ render, onChange, onError, gapSec, now: () => clock.ms,
    createAudio: () => { const audio = new FakeAudio(); audio.readyState = readyState; audios.push(audio); return audio; },
    raf: cb => { callbacks.set(++id, cb); return id; },
    caf: h => { callbacks.delete(h); },
  });
  const frame = () => { for (const [h, cb] of [...callbacks]) { callbacks.delete(h); cb(); } };
  return { queue, audios, render, onChange, onError, frame, callbacks, clock };
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
  it("after dispose a finished queue can be filled again (effect re-run on the same queue)", () => {
    const { queue } = setup();
    queue.enqueue(scene("a")); queue.finish();
    queue.dispose();
    expect([queue.duration, queue.current]).toEqual([0, undefined]);
    expect(() => queue.enqueue(scene("a"))).not.toThrow();
    expect(queue.sceneBeats.map(b => b.sceneId)).toEqual(["a"]);
  });
  it("rejects invalid durations and ignores non-finite seeks", () => {
    const { queue } = setup();
    expect(() => queue.enqueue(scene("bad", NaN))).toThrow(/duration/i);
    expect(() => queue.enqueue(scene("bad", 0))).toThrow(/duration/i);
    queue.enqueue(scene("a")); queue.seek(NaN);
    expect(queue.currentTime).toBe(0);
  });
});

describe("SceneQueue gap between scenes", () => {
  const gapped = () => setup(4, 0.6);
  it("offsets, duration and beat starts include the gap after every scene but the last", () => {
    const { queue } = gapped();
    queue.enqueue(scene("a")); queue.enqueue(scene("b", 7)); queue.enqueue(scene("c"));
    expect(queue.sceneBeats.map(e => e.offset)).toEqual([0, 5.6, 13.2]);
    expect(queue.duration).toBeCloseTo(18.2, 9);
    expect(queue.beatStarts).toEqual([0, 2, 5.6, 7.6, 13.2, 15.2]);
    expect(resumeTime(queue.beatStarts, 5.3)).toBe(2); // the gap belongs to the earlier scene
  });
  it("holds the last frame silently for gapSec on the clock, then starts the next scene", () => {
    const { queue, audios, render, frame, clock } = gapped();
    queue.enqueue(scene("a")); queue.enqueue(scene("b")); queue.play();
    audios[0].currentTime = 5; audios[0].dispatchEvent(new Event("ended"));
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ sceneId: "a" }), 5);
    expect(audios[1].play).not.toHaveBeenCalled();
    expect(queue.buffering).toBe(false);
    clock.ms = 300; frame();
    expect(queue.currentTime).toBeCloseTo(5.3, 9);
    expect(queue.current?.sceneId).toBe("a");
    expect(audios[1].play).not.toHaveBeenCalled();
    clock.ms = 600; frame();
    expect(audios[1].play).toHaveBeenCalledTimes(1);
    expect(queue.current?.sceneId).toBe("b");
    expect(queue.currentTime).toBeCloseTo(5.6, 9);
  });
  it("pausing freezes the gap; play resumes it where it was", () => {
    const { queue, audios, frame, clock } = gapped();
    queue.enqueue(scene("a")); queue.enqueue(scene("b")); queue.play();
    audios[0].currentTime = 5; frame();
    clock.ms = 200; queue.pause();
    clock.ms = 5000;
    expect(queue.currentTime).toBeCloseTo(5.2, 9);
    queue.play();
    clock.ms = 5300; frame();
    expect(audios[1].play).not.toHaveBeenCalled();
    clock.ms = 5400; frame();
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });
  it("seeks into a gap (renders the last frame) and across it", () => {
    const { queue, audios, render, frame, clock } = gapped();
    queue.enqueue(scene("a")); queue.enqueue(scene("b"));
    queue.seek(5.4);
    expect(queue.current?.sceneId).toBe("a");
    expect(queue.currentTime).toBeCloseTo(5.4, 9);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ sceneId: "a" }), 5);
    queue.play(); clock.ms = 200; frame();
    expect(audios[1].play).toHaveBeenCalledTimes(1);
    queue.seek(6);
    expect(queue.current?.sceneId).toBe("b");
    expect(audios[1].currentTime).toBeCloseTo(0.4, 9);
    queue.seek(1);
    expect(queue.currentTime).toBe(1);
  });
  it("a starved queue waits after the gap; the last scene of a finished queue has no gap", () => {
    const { queue, audios, frame, clock } = gapped();
    queue.enqueue(scene("a")); queue.play();
    audios[0].currentTime = 5; frame();
    expect(queue.buffering).toBe(false); // the pause first
    clock.ms = 600; frame();
    expect(queue.buffering).toBe(true);
    queue.enqueue(scene("b"));
    expect(queue.buffering).toBe(false);
    expect(audios[1].play).toHaveBeenCalledTimes(1);
    expect(queue.currentTime).toBeCloseTo(5.6, 9);
    queue.finish();
    audios[1].currentTime = 5; frame();
    expect(queue.playing).toBe(false);
    expect(queue.currentTime).toBeCloseTo(10.6, 9);
    expect(queue.duration).toBeCloseTo(10.6, 9);
  });
  it("rejects a negative gap", () => {
    expect(() => new SceneQueue({ render: () => {}, gapSec: -1 })).toThrow(/gapSec/);
  });
});

describe("SceneQueue playback rate", () => {
  type RateAudio = FakeAudio & { playbackRate?: number; preservesPitch?: boolean };
  it("applies the rate, pitch-preserved, to current and later scene audio", () => {
    const { queue, audios } = setup(4, 0.6);
    queue.enqueue(scene("a"));
    expect((audios[0] as RateAudio).playbackRate).toBe(1);
    queue.setRate(1.5);
    queue.enqueue(scene("b"));
    expect(queue.rate).toBe(1.5);
    for (const a of audios as RateAudio[]) { expect(a.playbackRate).toBe(1.5); expect(a.preservesPitch).toBe(true); }
    expect(queue.duration).toBeCloseTo(10.6, 9); // timeline seconds: speed never changes positions
  });
  it("the gap holds 1/rate as long on the wall clock", () => {
    const { queue, audios, frame, clock } = setup(4, 0.6);
    queue.enqueue(scene("a")); queue.enqueue(scene("b"));
    queue.setRate(2); queue.play();
    audios[0].currentTime = 5; frame();
    clock.ms = 200; frame();
    expect(queue.currentTime).toBeCloseTo(5.4, 9);
    expect(audios[1].play).not.toHaveBeenCalled();
    clock.ms = 300; frame();
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });
  it("a rate change mid-gap keeps the time already held", () => {
    const { queue, audios, frame, clock } = setup(4, 0.6);
    queue.enqueue(scene("a")); queue.enqueue(scene("b")); queue.play();
    audios[0].currentTime = 5; frame();
    clock.ms = 200; queue.setRate(2); // 0.2 s held at 1x
    expect(queue.currentTime).toBeCloseTo(5.2, 9);
    clock.ms = 350; frame(); // + 0.15 s wall x2 = 0.5 s
    expect(queue.currentTime).toBeCloseTo(5.5, 9);
    clock.ms = 400; frame();
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });
  it("rejects a non-positive rate", () => {
    const { queue } = setup();
    expect(() => queue.setRate(0)).toThrow(/rate/);
  });
});
