import { expect, it } from "vitest";
import { BufferClock } from "./bufferClock";

function fakeCtx() {
  const sources: { offset: number; stopped: boolean; playbackRate: { value: number }; onended: (() => void) | null }[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    decodeAudioData: () => Promise.reject(new Error("unused")),
    createBufferSource() {
      const s = { buffer: null, playbackRate: { value: 1 }, onended: null as (() => void) | null, offset: 0, stopped: false,
        connect() {}, disconnect() {}, start(_w: number, o: number) { s.offset = o; }, stop() { s.stopped = true; } };
      sources.push(s);
      return s;
    },
  };
  return { ctx: ctx as unknown as ConstructorParameters<typeof BufferClock>[1] & { currentTime: number }, sources };
}

it("tracks the context clock across play, pause, seek and end", async () => {
  const { ctx, sources } = fakeCtx();
  const clock = new BufferClock(Promise.resolve({ duration: 10 } as AudioBuffer), ctx);
  let canplay = 0, ended = 0;
  clock.addEventListener("canplay", () => canplay++);
  clock.addEventListener("ended", () => ended++);
  expect(clock.readyState).toBe(0);
  await Promise.resolve();
  expect([clock.readyState, canplay]).toEqual([4, 1]);

  ctx.currentTime = 5; clock.play();
  ctx.currentTime = 7; expect(clock.currentTime).toBe(2);
  clock.pause(); expect(sources[0].stopped).toBe(true);
  ctx.currentTime = 20; expect(clock.currentTime).toBe(2); // paused: frozen

  clock.currentTime = 8; clock.play();
  expect(sources[1].offset).toBe(8);
  ctx.currentTime = 22;
  sources[0].onended?.(); expect(ended).toBe(0); // a stale source never fires ended
  sources[1].onended?.();
  expect([clock.ended, clock.currentTime, ended]).toEqual([true, 10, 1]);

  clock.currentTime = 12; expect(clock.ended).toBe(true); // queue's boundary() sets totalSec (> WAV length): must stay ended, not replay
  clock.play(); expect(sources[2].offset).toBe(0); // play after the end restarts, like <audio>
  expect(clock.ended).toBe(false);
});

it("playbackRate scales the clock and the source", async () => {
  const { ctx, sources } = fakeCtx();
  const clock = new BufferClock(Promise.resolve({ duration: 10 } as AudioBuffer), ctx);
  await Promise.resolve();
  clock.playbackRate = 2; clock.play();
  expect(sources[0].playbackRate.value).toBe(2);
  ctx.currentTime = 1; expect(clock.currentTime).toBe(2);
  clock.playbackRate = 1; expect(sources[0].playbackRate.value).toBe(1);
  ctx.currentTime = 2; expect(clock.currentTime).toBe(3);
});
