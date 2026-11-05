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
type AudioClock = Clock & EventTarget & { readyState: number; preload: string };
type Options<T> = Pick<ConstructorParameters<typeof Player>[0], "raf" | "caf"> & {
  render: (scene: T, localTime: number) => void;
  createAudio?: (wavPath: string) => AudioClock;
  onChange?: () => void;
  onError?: (error: unknown) => void;
};
type Entry<T> = { scene: T; offset: number; audio: AudioClock; player: Player; cleanup: () => void };

/** Scene-local audio is the only clock; offsets never include buffering wall time. */
// The WAV can be shorter than the timeline (compiler-inserted silence): an ended audio is done, or play() would restart it from 0.
const atEnd = (e: { audio: { currentTime: number; ended?: boolean }; scene: { timeline: { totalSec: number } } }) => e.audio.ended || e.audio.currentTime >= e.scene.timeline.totalSec;

export class SceneQueue<T extends QueuedScene = QueuedScene> {
  private entries: Entry<T>[] = [];
  private index = 0;
  private wanted = false;
  private complete = false;
  private waiting = false;
  private total = 0;
  constructor(private options: Options<T>) {}

  private get entry() { return this.entries[this.index]; }
  get current() { return this.entry?.scene; }
  get currentTime() { return this.entry ? this.entry.offset + Math.min(this.entry.audio.currentTime, this.entry.scene.timeline.totalSec) : 0; }
  get time() { return this.currentTime; }
  get duration() { return this.total; }
  get playing() { return this.wanted; }
  get buffering() { return this.waiting; }
  get sceneBeats() { return this.entries.map(e => ({ sceneId: e.scene.sceneId, offset: e.offset, beatStarts: beatStarts(e.scene.timeline) })); }
  get beatStarts() { return this.sceneBeats.flatMap(e => e.beatStarts.map(t => e.offset + t)); }

  enqueue(scene: T) {
    if (this.complete) throw new Error("Scene queue is complete");
    if (!Number.isFinite(scene.timeline.totalSec) || scene.timeline.totalSec <= 0) throw new Error("Invalid scene duration");
    const audio = this.options.createAudio?.(scene.wavPath) ?? new Audio(scene.wavPath);
    audio.preload = "auto";
    const entry: Entry<T> = { scene, offset: this.total, audio, player: null!, cleanup: () => {} };
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
    const ended = () => this.boundary(entry);
    const ready = () => { if (this.entry === entry && this.waiting) this.sync(); };
    const stalled = () => {
      if (this.entry !== entry || !this.wanted) return;
      entry.player.pause(); this.waiting = true; this.options.onChange?.();
    };
    const error = () => fail(new Error(`Unable to play scene ${scene.sceneId}`));
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
    this.total += scene.timeline.totalSec;
    if (this.entries.length === 1) this.options.render(scene, 0);
    this.sync();
  }

  private boundary(entry: Entry<T>) {
    if (entry !== this.entry || !this.wanted) return;
    entry.player.pause();
    entry.audio.currentTime = entry.scene.timeline.totalSec;
    this.sync();
  }

  private sync() {
    let entry = this.entry;
    if (this.wanted && entry && atEnd(entry)) {
      entry.player.pause();
      if (this.index + 1 < this.entries.length) {
        entry = this.entries[++this.index];
        entry.player.seek(0);
      } else if (this.complete) this.wanted = false;
    }
    this.waiting = this.wanted && (!entry || atEnd(entry) || entry.audio.readyState < 3);
    if (this.wanted && !this.waiting) entry!.player.play();
    this.options.onChange?.();
  }

  play() { this.wanted = true; this.sync(); }
  pause() {
    this.wanted = false;
    this.waiting = false;
    this.entry?.player.pause();
    this.options.onChange?.();
  }
  seek(time: number) {
    if (!Number.isFinite(time) || !this.entries.length) return;
    const t = Math.min(this.duration, Math.max(0, time));
    this.entry?.player.pause();
    this.index = this.entries.findIndex((e, i) => t < e.offset + e.scene.timeline.totalSec || i === this.entries.length - 1);
    this.entry.player.seek(t - this.entry.offset);
    this.sync();
  }
  finish() { this.complete = true; this.sync(); }
  dispose() {
    this.pause();
    this.entries.forEach(e => { e.cleanup(); e.player.pause(); });
  }
}
