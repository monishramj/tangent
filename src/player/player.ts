// Time comes only from audio.currentTime (CLAUDE.md: one clock). rAF just paces redraws.
export type Clock = { currentTime: number; play(): unknown; pause(): void };
type Opts = {
  timeline: { totalSec: number };
  audio: Clock;
  render: (t: number) => void; // Stage: update scene to t, then app.render()
  raf?: (cb: () => void) => number;
  caf?: (h: number) => void;
};

export class Player {
  private h: number | null = null;
  private raf: NonNullable<Opts["raf"]>;
  private caf: NonNullable<Opts["caf"]>;
  constructor(private o: Opts) {
    this.raf = o.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = o.caf ?? ((h) => cancelAnimationFrame(h));
  }
  get time() { return this.o.audio.currentTime; }
  get playing() { return this.h !== null; }

  private tick = () => {
    const t = this.time;
    this.o.render(t);
    if (t >= this.o.timeline.totalSec) return this.pause();
    this.h = this.raf(this.tick);
  };
  private cancel() { if (this.h !== null) this.caf(this.h); this.h = null; }

  play() {
    if (this.h !== null) return;
    this.o.audio.play();
    this.h = this.raf(this.tick);
  }
  pause() { this.cancel(); this.o.audio.pause(); }
  seek(t: number) {
    this.o.audio.currentTime = Math.min(Math.max(t, 0), this.o.timeline.totalSec);
    if (this.h === null) this.o.render(this.time); // paused: draw once; playing: next frame does
  }
  stop() { this.pause(); this.seek(0); }
}
