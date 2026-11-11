import type { Timeline } from "../dsl/compile";
/** Where to resume after an answer: start of the beat containing `t`. `beatStarts` sorted ascending (sec). */
export function resumeTime(beatStarts: number[], t: number): number {
  let r = 0;
  for (const s of beatStarts) if (s <= t) r = s; else break;
  return r;
}

/** Start time (sec) of each spoken beat, ascending. */
export const beatStarts = (tl: Timeline) => tl.events.filter(e => e.verb === "say").map(e => e.start).sort((a, b) => a - b);
import { Player, type Clock } from "./player";

export type QueuedScene = { sceneId: string; timeline: Timeline; wavPath: string };
type AudioClock = Clock & EventTarget & { readyState: number; preload: string; playbackRate?: number; preservesPitch?: boolean };
type Options<T> = Pick<ConstructorParameters<typeof Player>[0], "raf" | "caf"> & {
  render: (scene: T, localTime: number) => void;
  createAudio?: (wavPath: string) => AudioClock;
  onChange?: () => void;
  onError?: (error: unknown) => void;
  /** Silent hold on a scene's last frame before the next scene starts (s). Default DEFAULT_GAP_SEC. */
  gapSec?: number;
  /** Wall clock in ms for the gap only (no audio plays then). Default performance.now. */
  now?: () => number;
};
export const DEFAULT_GAP_SEC = 0.6;
type Entry<T> = { scene: T; offset: number; audio: AudioClock; player: Player; cleanup: () => void };

/**
 * Scene-local audio is the only clock; offsets never include buffering wall time.
 * Between scenes there is a gap of `gapSec`: the last frame holds, silent, before the next scene starts.
 * The gap belongs to the earlier scene's span (offset + totalSec + gap = next offset), so seek, duration and
 * beatStarts all see it. No audio plays during it, so it is timed on `now` (paused with the queue); the last
 * scene gets no trailing gap once the queue is finished.
 */
// The WAV can end slightly before its timeline (rounding, decoder padding): an ended audio is done, or play() would restart it from 0.
const atEnd = (e: { audio: { currentTime: number; ended?: boolean }; scene: { timeline: { totalSec: number } } }) => e.audio.ended || e.audio.currentTime >= e.scene.timeline.totalSec;

export class SceneQueue<T extends QueuedScene = QueuedScene> {
  private entries: Entry<T>[] = [];
  private index = 0;
  private wanted = false;
  private complete = false;
  private waiting = false;
  private total = 0;
  // Gap after the current scene: seconds elapsed (null = not in a gap), and the wall time it last resumed.
  private gapAt: number | null = null;
  private gapSince: number | null = null;
  private gapFrame: number | null = null;
  private readonly gap: number;
  private speed = 1;
  private readonly now: () => number;
  private readonly raf: (cb: () => void) => number;
  private readonly caf: (h: number) => void;
  constructor(private options: Options<T>) {
    const gap = options.gapSec ?? DEFAULT_GAP_SEC;
    if (!Number.isFinite(gap) || gap < 0) throw new Error("gapSec must be a non-negative number");
    this.gap = gap;
    this.now = options.now ?? (() => performance.now());
    this.raf = options.raf ?? (cb => requestAnimationFrame(cb));
    this.caf = options.caf ?? (h => cancelAnimationFrame(h));
  }

  private get entry() { return this.entries[this.index]; }
  get current() { return this.entry?.scene; }
  get currentTime() {
    const e = this.entry;
    if (!e) return 0;
    if (this.gapAt !== null) return e.offset + e.scene.timeline.totalSec + this.gapElapsed();
    return e.offset + Math.min(e.audio.currentTime, e.scene.timeline.totalSec);
  }
  get time() { return this.currentTime; }
  get duration() { return this.total; }
  get playing() { return this.wanted; }
  get rate() { return this.speed; }
  get buffering() { return this.waiting; }
  get sceneBeats() { return this.entries.map(e => ({ sceneId: e.scene.sceneId, offset: e.offset, beatStarts: beatStarts(e.scene.timeline) })); }
  get beatStarts() { return this.sceneBeats.flatMap(e => e.beatStarts.map(t => e.offset + t)); }

  enqueue(scene: T) {
    if (this.complete) throw new Error("Scene queue is complete");
    if (!Number.isFinite(scene.timeline.totalSec) || scene.timeline.totalSec <= 0) throw new Error("Invalid scene duration");
    const audio = this.options.createAudio?.(scene.wavPath) ?? new Audio(scene.wavPath);
    audio.preload = "auto";
    this.applyRate(audio);
    const offset = this.entries.length ? this.total + this.gap : 0;
    const entry: Entry<T> = { scene, offset, audio, player: null!, cleanup: () => {} };
    const fail = (error: unknown) => {
      if (this.entry !== entry || !this.wanted) return;
      this.pause();
      this.options.onError?.(error);
    };
    entry.player = new Player({
      timeline: scene.timeline,
      audio: { get currentTime() { return audio.currentTime; }, set currentTime(t) { audio.currentTime = t; },
        play: () => { try { void Promise.resolve(audio.play()).catch(fail); } catch (error) { fail(error); } },
        pause: () => audio.pause(),
      },
      raf: this.options.raf, caf: this.options.caf,
      render: t => { this.options.render(scene, t); this.options.onChange?.(); },
      onEnd: () => this.boundary(entry),
    });
    entry.player.rate = this.speed;
    const ended = () => this.boundary(entry);
    const ready = () => { if (this.entry === entry && this.waiting) this.sync(); };
    const stalled = () => {
      if (this.entry !== entry || !this.wanted) return;
      entry.player.pause(); this.waiting = true; this.options.onChange?.();
    };
    // A load/decode failure is reported even for a preloading scene: otherwise it is dropped and that scene buffers forever.
    const error = () => {
      const e = new Error(`Unable to play scene ${scene.sceneId}: ${(audio as { error?: { message?: string } | null }).error?.message || "audio failed to load"}`);
      if (this.entry === entry && this.wanted) this.pause();
      this.options.onError?.(e);
    };
    audio.addEventListener("ended", ended);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("waiting", stalled);
    audio.addEventListener("error", error);
    entry.cleanup = () => {
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("waiting", stalled);
      audio.removeEventListener("error", error);
    };
    this.entries.push(entry);
    this.total = offset + scene.timeline.totalSec;
    if (this.entries.length === 1) this.options.render(scene, 0);
    this.sync();
  }

  private boundary(entry: Entry<T>) {
    if (entry !== this.entry || !this.wanted) return;
    entry.player.pause();
    entry.audio.currentTime = entry.scene.timeline.totalSec;
    this.sync();
  }

  private applyRate(audio: AudioClock) {
    audio.playbackRate = this.speed;
    audio.preservesPitch = true; // faster narration, same voice
  }
  /** The gap is timeline seconds, so wall time counts `rate`× as fast: a 0.6 s gap holds 0.3 s of wall time at 2×. */
  private gapElapsed() {
    if (this.gapAt === null) return 0;
    return Math.min(this.gap, this.gapAt + (this.gapSince === null ? 0 : (this.now() - this.gapSince) / 1000 * this.speed));
  }
  /** Playback speed for the current and every later scene (audio + the between-scene hold). */
  setRate(r: number) {
    if (!Number.isFinite(r) || r <= 0) throw new Error("rate must be a positive number");
    // Bank the gap time elapsed at the old rate before switching.
    if (this.gapAt !== null && this.gapSince !== null) { this.gapAt = this.gapElapsed(); this.gapSince = this.now(); }
    this.speed = r;
    for (const e of this.entries) { this.applyRate(e.audio); e.player.rate = r; }
    this.options.onChange?.();
  }
  /** Freeze the gap clock (pause, seek, dispose). */
  private holdGap() {
    if (this.gapAt !== null) this.gapAt = this.gapElapsed();
    this.gapSince = null;
    if (this.gapFrame !== null) this.caf(this.gapFrame);
    this.gapFrame = null;
  }
  private leaveGap() { this.holdGap(); this.gapAt = null; }
  private gapTick = () => {
    this.gapFrame = null;
    if (this.gapAt === null || !this.wanted) return;
    if (this.gapElapsed() >= this.gap) { this.holdGap(); this.sync(); return; }
    this.options.onChange?.();
    this.gapFrame = this.raf(this.gapTick);
  };

  private sync() {
    let entry = this.entry;
    if (this.wanted && entry && atEnd(entry)) {
      entry.player.pause();
      const hasNext = this.index + 1 < this.entries.length;
      if (!hasNext && this.complete) { this.wanted = false; this.leaveGap(); }
      else {
        if (this.gapAt === null) { this.gapAt = 0; this.options.render(entry.scene, entry.scene.timeline.totalSec); } // hold the last frame
        if (this.gapElapsed() >= this.gap) {
          if (hasNext) { this.leaveGap(); entry = this.entries[++this.index]; entry.player.seek(0); }
        } else if (this.gapSince === null) {
          this.gapSince = this.now();
          this.gapFrame = this.raf(this.gapTick);
        }
      }
    }
    const inGap = this.gapAt !== null;
    // A finished gap with nothing after it is starvation; an unfinished gap is just the pause.
    this.waiting = this.wanted && (!entry || (inGap ? this.gapElapsed() >= this.gap : atEnd(entry) || entry.audio.readyState < 3));
    if (this.wanted && !this.waiting && !inGap) entry!.player.play();
    this.options.onChange?.();
  }

  play() { this.wanted = true; this.sync(); }
  pause() {
    this.wanted = false;
    this.waiting = false;
    this.holdGap();
    this.entry?.player.pause();
    this.options.onChange?.();
  }
  seek(time: number) {
    if (!Number.isFinite(time) || !this.entries.length) return;
    const t = Math.min(this.duration, Math.max(0, time));
    this.entry?.player.pause();
    this.leaveGap();
    const last = this.entries.length - 1;
    this.index = this.entries.findIndex((_, i) => i === last || t < this.entries[i + 1].offset);
    const local = t - this.entry.offset, total = this.entry.scene.timeline.totalSec;
    this.entry.player.seek(Math.min(local, total));
    if (local > total) this.gapAt = local - total; // inside the gap after this scene
    this.sync();
  }
  finish() { this.complete = true; this.sync(); }
  /** Stop and empty the queue. It can be filled again: React re-runs the stream effect on the same queue (StrictMode, Fast
   *  Refresh), and a queue left `complete` made every re-run fail with "Scene queue is complete". */
  dispose() {
    this.pause();
    this.leaveGap();
    this.entries.forEach(e => { e.cleanup(); e.player.pause(); });
    this.entries = []; this.index = 0; this.total = 0; this.complete = false; this.waiting = false;
    this.options.onChange?.();
  }
}
