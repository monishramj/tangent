import { useMemo } from "react";
import type { Scene } from "@motion/dsl/schema";
import type { Timeline } from "@motion/dsl/compile";

// Closed captions in their own strip under the video (never drawn into the canvas).
// The timeline keeps only per-beat `say` spans, not word times, so words are spread over the span by length.

export type Cue = { start: number; end: number; text: string };
export type TimedWord = { word: string; start: number; end: number };

/** One cue per spoken beat, on the global clock. `offsets[i]` = scene i's start (the queue's, which include
 *  between-scene gaps); without it, scenes are laid end to end. */
export function captionCues(scenes: { scene: Scene; timeline: Timeline }[], offsets: number[] = []): Cue[] {
  let offset = 0;
  const out: Cue[] = [];
  for (const [i, { scene, timeline }] of scenes.entries()) {
    offset = offsets[i] ?? offset;
    for (const e of timeline.events) if (e.verb === "say") {
      const beat = scene.beats[e.beat];
      if (beat && "say" in beat && beat.say.trim()) out.push({ start: offset + e.start, end: offset + e.end, text: beat.say.trim() });
    }
    offset += timeline.totalSec;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Long beats (two sentences) split at sentence ends into parts that fit two lines, timed by character share.
 *  Sentence-level timing is coarse on purpose: per-word estimates drift visibly from the voice. */
export function captionParts(cue: Cue, max = 110): Cue[] {
  const text = cue.text.replace(/\s+/g, " ").trim();
  if (text.length <= max) return [{ ...cue, text }];
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map(x => x.trim()).filter(Boolean) ?? [text];
  const parts: string[] = [];
  for (const s of sentences) {
    const last = parts.length - 1;
    if (last >= 0 && parts[last].length + 1 + s.length <= max) parts[last] += ` ${s}`;
    else parts.push(s);
  }
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  let t = cue.start;
  return parts.map(p => { const start = t; t += (cue.end - cue.start) * p.length / total; return { start, end: t, text: p }; });
}

const HOLD = 0.8; // keep the last line up briefly after it ends (beat pauses, scene seams)

/** The line being said, plain: no per-word highlight. Sits over the bottom of the video; `lift` moves it above the controls. */
export default function Captions({ cues, time, lift = false }: { cues: Cue[]; time: number; lift?: boolean }) {
  const idx = cues.reduce((k, c, i) => c.start <= time + .01 ? i : k, -1);
  const cue = idx >= 0 && time < cues[idx].end + HOLD ? cues[idx] : null;
  const parts = useMemo(() => cue ? captionParts(cue) : [], [cue]);
  const k = parts.reduce((j, p, i) => p.start <= time + .01 ? i : j, 0);
  const part = parts[k];
  return (
    <div role="region" aria-label="Captions" aria-live="off"
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-[6%] pb-[max(0.75rem,3.2%)] transition-transform duration-300 ease-out ${lift ? "-translate-y-[5.25rem]" : ""}`}>
      {part && <p key={`${idx}-${k}`} className="captions-in line-clamp-2 max-w-[56ch] rounded-lg bg-black/70 px-[0.6em] py-[0.2em] text-center text-[clamp(14px,1.9cqw,22px)] leading-[1.4] font-medium text-balance text-fg [box-decoration-break:clone]">
        {part.text}
      </p>}
    </div>
  );
}
