/**
 * A scene's audio as a decoded buffer on one shared AudioContext, shaped like the bits of HTMLAudioElement SceneQueue uses.
 * Why: one <audio> per scene made WebKit re-activate its audio session on every play/pause/seek, and that sync IPC to the
 * GPU process deadlocked the whole webview (frozen window, no right-click). One context that keeps running = one activation.
 */
type Ctx = Pick<AudioContext, "currentTime" | "destination" | "createBufferSource" | "resume" | "decodeAudioData">;
let shared: AudioContext | null = null;
const sharedCtx = () => (shared ??= new AudioContext());

export class BufferClock extends EventTarget {
  preload = "auto";
  readyState = 0;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  preservesPitch = true; // accepted for SceneQueue; Web Audio can't honor it (pitch shifts with rate)
  private rate = 1;
  private startedAt = 0; // ctx time when the current source started
  private pos = 0; // buffer position at startedAt (or while stopped)

  constructor(load: Promise<AudioBuffer>, private ctx: Ctx) {
    super();
    load.then(b => { this.buffer = b; this.readyState = 4; this.dispatchEvent(new Event("canplay")); },
      () => this.dispatchEvent(new Event("error")));
  }

  /** Like <audio>: stopped at the end. Setting currentTime to/past the end keeps it ended, or SceneQueue's boundary() would replay the scene. */
  get ended() { return !this.src && !!this.buffer && this.pos >= this.buffer.duration; }
  get duration() { return this.buffer?.duration ?? NaN; }
  get currentTime() { return this.src ? Math.min(this.pos + (this.ctx.currentTime - this.startedAt) * this.rate, this.duration) : this.pos; }
  set currentTime(t: number) {
    const playing = !!this.src;
    this.stop();
    this.pos = Math.max(0, Math.min(t, this.duration || t));
    if (playing) this.start();
  }

  play() {
    if (!this.buffer || this.src) return Promise.resolve();
    if (this.pos >= this.buffer.duration) this.pos = 0; // like <audio>: play after the end restarts
    this.start();
    return this.ctx.resume();
  }
  get playbackRate() { return this.rate; }
  set playbackRate(r: number) {
    if (this.src) { this.pos = this.currentTime; this.startedAt = this.ctx.currentTime; this.src.playbackRate.value = r; }
    this.rate = r;
  }
  pause() { if (this.src) { this.pos = this.currentTime; this.stop(); } }

  private start() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffer;
    s.connect(this.ctx.destination);
    s.onended = () => {
      if (this.src !== s) return;
      this.src = null; this.pos = this.duration;
      this.dispatchEvent(new Event("ended"));
    };
    s.playbackRate.value = this.rate;
    this.startedAt = this.ctx.currentTime;
    s.start(0, this.pos);
    this.src = s;
  }
  private stop() {
    const s = this.src;
    this.src = null;
    if (s) { s.onended = null; s.stop(); s.disconnect(); }
  }
}

export function bufferClock(url: string, ctx: Ctx = sharedCtx()) {
  const load = fetch(url).then(r => { if (!r.ok) throw new Error(`audio ${r.status}`); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b));
  return new BufferClock(load, ctx);
}
