// Time comes only from audio.currentTime (CLAUDE.md: one clock). rAF just paces redraws.
export type Clock = { currentTime: number; play(): unknown; pause(): void };
type Opts = {
  timeline: { totalSec: number };
  audio: Clock;
  render: (t: number) => void; // Stage: update scene to t, then app.render()
  raf?: (cb: () => void) => number;
  caf?: (h: number) => void;
  onEnd?: () => void;
};

export class Player {
  private h: number | null = null;
  private raf: NonNullable<Opts["raf"]>;
  private caf: NonNullable<Opts["caf"]>;
  constructor(private o: Opts) {
    this.raf = o.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = o.caf ?? ((h) => cancelAnimationFrame(h));
  }
  /** Playback rate of the audio clock (the queue sets it), so the extrapolation between coarse updates keeps pace. */
  rate = 1;
  get time() { return this.o.audio.currentTime; }
  get playing() { return this.h !== null; }

  private sample = { audio: -1, at: 0 };
  /** WKWebView updates currentTime coarsely; between updates, extrapolate (capped) so motion doesn't judder. Audio stays the clock. */
  private smooth() {
    const audio = this.time, now = performance.now();
    if (audio !== this.sample.audio) { this.sample = { audio, at: now }; return audio; }
    return Math.min(this.o.timeline.totalSec, audio + Math.min(.25 * this.rate, (now - this.sample.at) / 1000 * this.rate));
  }
  private tick = () => {
    const t = this.smooth();
    this.o.render(t);
    if (this.time >= this.o.timeline.totalSec) { this.pause(); this.o.onEnd?.(); return; } // raw clock: extrapolation must not end a scene early
    this.h = this.raf(this.tick);
  };
  private cancel() { if (this.h !== null) this.caf(this.h); this.h = null; }

  play() {
    if (this.h !== null) return;
    this.o.audio.play();
    this.h = this.raf(this.tick);
  }
  pause() { this.cancel(); this.o.audio.pause(); this.sample.audio = -1; }
  seek(t: number) {
    this.o.audio.currentTime = Math.min(Math.max(t, 0), this.o.timeline.totalSec);
    if (this.h === null) this.o.render(this.time); // paused: draw once; playing: next frame does
  }
  stop() { this.pause(); this.seek(0); }
}
