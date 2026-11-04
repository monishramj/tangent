// Timeline compiler: a validated scene + per-beat word timestamps -> absolute, audio-clock events.
// Pure. Assumes validateScene passed; throws only on missing audio or an anchor absent from the spoken words.
import type { Action, Scene } from "./schema";
import type { OpPlan } from "./ops";

// Tunable. Default motion length per verb (s); op reserves its whole anchor gap.
export const DURATION: Record<Action["do"], number> = {
  create: 0.4, fade: 0.3, move: 0.5, transform: 0.6, highlight: 0.4, indicate: 0.4, camera: 0.6, wait: 0.5, op: Infinity,
};
export const TRANSITION: Record<string, number> = { cut: 0, whip: 0.3, push: 0.4, "match-cut": 0.3 };
export const MIN_SEC = 0.15; // never squash motion below this; insert silence instead
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
// Pad `sec` of silence into beat `beat`'s clip at clip-local time `at` (just after word `afterWord`).
export type InsertedSilence = { beat: number; afterWord: number; at: number; sec: number };
export type Timeline = { events: TimelineEvent[]; totalSec: number; insertedSilences: InsertedSilence[] };

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const endsSentence = (w: string) => /[.!?]["')\]]*$/.test(w);

// Index of the first word of the first whole-word run matching `at`, or -1.
export function resolveAnchor(words: Word[], at: string): number {
  const want = at.split(/\s+/).map(norm).filter(Boolean);
  const got = words.map((w) => norm(w.word));
  for (let i = 0; i + want.length <= got.length; i++) if (want.every((t, j) => got[i + j] === t)) return i;
  return -1;
}

export function compile(scene: Scene, audio: (BeatAudio | undefined)[], pause = BEAT_PAUSE, ops?: OpPlan): Timeline {
  const events: TimelineEvent[] = [];
  const insertedSilences: InsertedSilence[] = [];
  let t = 0;
  scene.beats.forEach((beat, b) => {
    if (b > 0) t += pause;
    if (!("say" in beat)) {
      const sec = Math.min(beat.reaction.maxSec, REACTION_SEC);
      events.push({ start: t, end: t + sec, verb: "reaction", beat: b, args: { intent: beat.reaction.intent } });
      t += sec;
      return;
    }
    const a = audio[b];
    if (!a) throw new Error(`no audio for beat ${b}`);
    const { words, duration } = a;
    const placed = beat.actions.map((act) => {
      const w = resolveAnchor(words, act.at);
      if (w < 0) throw new Error(`beat ${b}: anchor "${act.at}" not in spoken words`);
      return { act, w, len: 0 };
    });

    // Fit each anchor's actions into the gap before the next anchor (or beat end); silence pads what can't fit MIN_SEC.
    const anchors = [...new Set(placed.map((p) => p.w))].sort((x, y) => x - y);
    const silences: InsertedSilence[] = [];
    anchors.forEach((w, i) => {
      const next = anchors[i + 1];
      const gap = (next === undefined ? duration : words[next].start) - words[w].start;
      let need = 0;
      for (const p of placed.filter((p) => p.w === w)) {
        const d = p.act.duration ?? DURATION[p.act.do];
        const steps = ops?.get(p.act);
        p.len = steps ? (steps.length ? Math.max(gap, steps.length * MIN_SEC) : 0)
          : Math.max(Math.min(d, gap), Math.min(d, MIN_SEC));
        need = Math.max(need, p.len - gap);
      }
      if (need <= 0) return;
      // First sentence end inside the gap; else the word just before the next anchor.
      // ponytail: that fallback is a short mid-sentence pause; revisit if it sounds bad.
      const last = next === undefined ? words.length - 1 : next - 1;
      let k = w;
      while (k < last && !endsSentence(words[k].word)) k++;
      const at = k === words.length - 1 ? duration : (words[k].end + words[k + 1].start) / 2;
      silences.push({ beat: b, afterWord: k, at, sec: need });
    });

    const shift = (x: number) => t + x + silences.reduce((s, q) => s + (q.at <= x ? q.sec : 0), 0);
    events.push({ start: t, end: shift(duration), verb: "say", beat: b, args: {} });
    if (beat.transition)
      events.push({ start: t, end: t + TRANSITION[beat.transition], verb: "transition", beat: b, args: { type: beat.transition } });
    for (const { act, w, len } of placed) {
      const { at: _at, do: verb, target, ...args } = act;
      const start = shift(words[w].start);
      const steps = ops?.get(act);
      if (steps) steps.forEach((step, i) => {
        for (const { at: _at, do: verb, target, ...args } of step)
          events.push({ start: start + len * i / steps.length, end: start + len * (i + 1) / steps.length, verb, target, args, beat: b });
      });
      else events.push({ start, end: start + len, verb, target, args, beat: b });
    }
    t = shift(duration);
    insertedSilences.push(...silences);
  });
  events.sort((x, y) => x.start - y.start);
  return { events, totalSec: t, insertedSilences };
}
