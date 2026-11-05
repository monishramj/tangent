import { expect, it } from "vitest";
import { BufferClock } from "./bufferClock";

function fakeCtx() {
  const sources: { offset: number; stopped: boolean; playbackRate: { value: number }; buffer: unknown; onended: (() => void) | null }[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    decodeAudioData: () => Promise.reject(new Error("unused")),
    createBufferSource() {
      const s = { buffer: null as unknown, playbackRate: { value: 1 }, onended: null as (() => void) | null, offset: 0, stopped: false,
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

it("rate ≠ 1 plays a stretched copy at 1× (same pitch) and the clock still counts scene time", async () => {
  const { ctx, sources } = fakeCtx();
  const made: { len: number }[] = [];
  Object.assign(ctx, { createBuffer: (_c: number, len: number) => { const b = { len, copyToChannel() {} }; made.push(b); return b; } });
  const buf = { duration: 10, length: 1000, sampleRate: 100, numberOfChannels: 1, getChannelData: () => new Float32Array(1000) };
  const clock = new BufferClock(Promise.resolve(buf as unknown as AudioBuffer), ctx);
  await Promise.resolve();
  clock.playbackRate = 2; clock.play();
  expect([sources[0].playbackRate.value, made[0].len]).toEqual([1, 500]);
  ctx.currentTime = 1; expect(clock.currentTime).toBe(2);
  clock.playbackRate = 1; // restarts on the original buffer at the same scene time
  expect([sources[1].buffer, sources[1].offset]).toEqual([buf, 2]);
  ctx.currentTime = 2; expect(clock.currentTime).toBe(3);
  clock.currentTime = 4; clock.playbackRate = 2; // cached: no second stretch; offset is in stretched time
  expect([made.length, sources[sources.length - 1].offset]).toEqual([1, 2]);
});
