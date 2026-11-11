// Timeline compiler: a validated scene + per-beat word timestamps -> absolute, audio-clock events.
// Pure. Assumes validateScene passed; throws only on missing audio or an anchor absent from the spoken words.
import { FRACTION_ANCHOR, type Action, type Scene } from "./schema";
import type { OpPlan } from "./ops";

// Tunable. Default motion length per verb (s); op reserves its whole anchor gap.
export const DURATION: Record<Action["do"], number> = {
  create: 0.4, fade: 0.3, move: 0.5, transform: 0.6, highlight: 0.4, indicate: 0.4, camera: 0.6, wait: 0.5, op: Infinity, pose: 0.45, pulse: 0.8,
};
export const TRANSITION: Record<string, number> = { cut: 0, whip: 0.3, push: 0.4, "match-cut": 0.3 };
export const MIN_SEC = 0.15; // squash motion down to this (never insert silence: the WAV can't be padded mid-clip)
export const REACTION_SEC = 2; // capped by the beat's maxSec
export const BEAT_PAUSE = 0.25; // silence between consecutive beats

export type Word = { word: string; start: number; end: number };
export type BeatAudio = { words: Word[]; duration: number }; // times local to this beat's own clip
export type TimelineEvent = {
  start: number;
  end: number;
  verb: Action["do"] | "say" | "transition" | "reaction"; // say = play this beat's clip
  target?: string;
  args: Record<string, unknown>;
  beat: number;
};
// Legacy: the compiler used to pad silence into a beat's clip. It never does now (see compile), so
// Timeline.insertedSilences is always empty; the field stays for saved bundles and callers that read it.
export type InsertedSilence = { beat: number; afterWord: number; at: number; sec: number };
export type Timeline = { events: TimelineEvent[]; totalSec: number; insertedSilences: InsertedSilence[] };

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

// Index of the first word of the first whole-word run matching `at`, or -1.
export function resolveAnchor(words: Word[], at: string): number {
  if (FRACTION_ANCHOR.test(at)) return words.length ? Math.min(words.length - 1, Math.floor(Number(at.slice(1)) * words.length)) : -1;
  const want = at.split(/\s+/).map(norm).filter(Boolean);
  const got = words.map((w) => norm(w.word));
  for (let i = 0; i + want.length <= got.length; i++) if (want.every((t, j) => got[i + j] === t)) return i;
  return -1;
}

// Objects an action touches, for overlap checks: "h.slot[0]" and "h" are the same object.
const objectKey = (act: Action) => act.target ? act.target.split(/[.[]/)[0] : `@${act.do}`;

/**
 * Every action starts exactly at its anchor word. Timing is never bought with silence: the scene is one
 * WAV played as-is, so a silence the audio doesn't contain would make the visuals drift behind it
 * (the old mid-beat insert bug). Instead an animation may run past later anchors that touch other
 * objects, up to the next anchor on the same object or the end of its beat (which includes the
 * beat's trailing pause). If even that is too short, the motion is compressed, down to MIN_SEC.
 */
export function compile(scene: Scene, audio: (BeatAudio | undefined)[], pause = BEAT_PAUSE, ops?: OpPlan): Timeline {
  const events: TimelineEvent[] = [];
  const beatSec = (b: number) => {
    const beat = scene.beats[b];
    if (!("say" in beat)) return Math.min(beat.reaction.maxSec, REACTION_SEC);
    const a = audio[b];
    if (!a) throw new Error(`no audio for beat ${b}`);
    return a.duration;
  };
  let totalSec = 0; // same summation order as `t` below, so caps match the returned total exactly
  scene.beats.forEach((_, b) => { if (b > 0) totalSec += pause; totalSec += beatSec(b); });
  let t = 0;
  scene.beats.forEach((beat, b) => {
    if (b > 0) t += pause;
    if (!("say" in beat)) {
      const sec = beatSec(b);
      events.push({ start: t, end: t + sec, verb: "reaction", beat: b, args: { intent: beat.reaction.intent } });
      t += sec;
      return;
    }
    const { words, duration } = audio[b]!;
    const placed = beat.actions.map((act) => {
      const w = resolveAnchor(words, act.at);
      if (w < 0) throw new Error(`beat ${b}: anchor "${act.at}" not in spoken words`);
      return { act, w, key: objectKey(act) };
    });

    events.push({ start: t, end: t + duration, verb: "say", beat: b, args: {} });
    if (beat.transition)
      events.push({ start: t, end: t + TRANSITION[beat.transition], verb: "transition", beat: b, args: { type: beat.transition } });
    for (const { act, w, key } of placed) {
      const { at: _at, do: verb, target, delay = 0, ...args } = act;
      const local = words[w].start + delay;
      const limit = Math.min(duration, ...placed.filter((q) => q.w > w && q.key === key).map((q) => words[q.w].start));
      const room = limit - local;
      const start = t + local;
      const steps = ops?.get(act);
      const d = act.duration ?? DURATION[act.do];
      // op steps share the room, at least MIN_SEC each; plain motion keeps its default length if it fits.
      let len = steps ? (steps.length ? Math.max(room, steps.length * MIN_SEC) : 0)
        : Math.max(Math.min(d, room), Math.min(d, MIN_SEC));
      len = Math.max(0, Math.min(len, totalSec - start)); // never past the scene's audio
      if (steps) steps.forEach((step, i) => {
        for (const { at: _at, do: verb, target, ...args } of step)
          events.push({ start: start + len * i / steps.length, end: start + len * (i + 1) / steps.length, verb, target, args, beat: b });
      });
      else events.push({ start, end: start + len, verb, target, args, beat: b });
    }
    t += duration;
  });
  events.sort((x, y) => x.start - y.start);
  return { events, totalSec: t, insertedSilences: [] };
}
