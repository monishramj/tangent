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

/** Words of a cue with approximate times: duration shared by character count (+1 per word for the gap). */
export function timeWords(cue: Cue): TimedWord[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  const weight = words.map(w => w.length + 1);
  const total = weight.reduce((s, x) => s + x, 0) || 1;
  const span = Math.max(0, cue.end - cue.start);
  let t = cue.start;
  return words.map((word, i) => { const start = t; t += span * weight[i] / total; return { word, start, end: t }; });
}

/** Split into caption pages that fit two lines: break after a sentence end, else at `max` words (preferring a comma). */
export function pages(words: TimedWord[], max = 14): TimedWord[][] {
  const out: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const w of words) {
    cur.push(w);
    if (/[.!?]["')\]]*$/.test(w.word) && cur.length >= 4) flush();
    else if (cur.length >= max) {
      let comma = -1;
      for (let i = cur.length - 2; i >= max / 2; i--) if (/[,;:]$/.test(cur[i].word)) { comma = i; break; }
      if (comma >= 0) { const rest = cur.slice(comma + 1); cur = cur.slice(0, comma + 1); flush(); cur = rest; }
      else flush();
    }
  }
  flush();
  return out;
}

const HOLD = 0.8; // keep the last line up briefly after it ends (beat pauses, scene seams)

export default function Captions({ cues, time }: { cues: Cue[]; time: number }) {
  const idx = cues.reduce((k, c, i) => c.start <= time + .01 ? i : k, -1);
  const cue = idx >= 0 && time < cues[idx].end + HOLD ? cues[idx] : null;
  const split = useMemo(() => cue ? pages(timeWords(cue)) : [], [cue]);
  const flat = split.flat();
  const cur = flat.reduce((k, w, i) => w.start <= time ? i : k, -1);
  let page = split.length ? split.length - 1 : 0, n = 0;
  for (let p = 0; p < split.length; p++) { if (cur < n + split[p].length) { page = p; break; } n += split[p].length; }
  const first = split.slice(0, page).reduce((s, p) => s + p.length, 0);
  return (
    <div role="region" aria-label="Captions" className="flex h-[4.5rem] w-full items-start justify-center px-4 pt-3">
      {cue && split[page] && (
        // Fixed weight for every word: emphasis is color + a background pill, so nothing reflows as it moves.
        <p key={`${idx}-${page}`} className="captions-in line-clamp-2 max-w-[60ch] text-center text-[clamp(15px,1.6vw,20px)] leading-[1.45] font-medium text-balance">
          {split[page].map((w, i) => {
            const k = first + i, state = k === cur ? "now" : k < cur ? "said" : "next";
            return <span key={i} data-current={state === "now" || undefined}
              className={`rounded-[0.3em] px-[0.08em] transition-[color,background-color] duration-150 ease-out ${state === "now" ? "bg-fg/15 text-fg" : state === "said" ? "text-fg/85" : "text-fg/40"}`}>{w.word}</span>;
          }).flatMap((el, i) => i ? [" ", el] : [el])}
        </p>
      )}
    </div>
  );
}
