import type { BeatAudio, Word } from "@motion/dsl/compile";

export type Segment = { start: number; end: number };

/**
 * Split one scene-wide alignment back into per-beat clips (times local to each clip).
 * With `segments` (the sidecar synthesizes one per beat), beat b's clip runs from its segment start to the
 * next segment's start, so it carries its trailing silence; the first clip starts at 0 and the last ends at
 * audio.sec. Clip durations therefore sum to audio.sec and the timeline (compiled with no extra beat pause)
 * stays on the single WAV's clock. Words are assigned to beats by time, not by counting.
 * Without segments (legacy), words are grouped by count (the sidecar only aligns tokens containing [a-z'])
 * and beats are cut at the midpoint of the silence between them.
 */
export function splitBeatAudio(spoken: string[], audio: { sec: number; words: Word[]; segments?: Segment[] }): BeatAudio[] {
  const n = spoken.length;
  let groups: Word[][];
  let bounds: number[];
  if (audio.segments) {
    const segs = audio.segments;
    if (segs.length !== n) throw new Error("Alignment does not match narration beats");
    bounds = segs.map((s, b) => b === 0 ? 0 : s.start);
    bounds.push(audio.sec);
    if (bounds.some((t, b) => b > 0 && t < bounds[b - 1])) throw new Error("Alignment segments are out of order");
    groups = segs.map(() => []);
    for (const w of audio.words) {
      let b = n - 1;
      while (b > 0 && w.start < bounds[b] - 1e-6) b--;
      groups[b].push(w);
    }
    if (groups.some(g => !g.length)) throw new Error("Alignment does not match narration beats");
  } else {
    const counts = spoken.map(s => s.split(/\s+/).filter(w => /[a-z']/i.test(w)).length);
    if (counts.includes(0) || counts.reduce((a, b) => a + b, 0) !== audio.words.length)
      throw new Error("Alignment does not match narration beats");
    let at = 0;
    groups = counts.map(c => audio.words.slice(at, at += c));
    bounds = groups.map((g, b) => b === 0 ? 0 : (groups[b - 1][groups[b - 1].length - 1].end + g[0].start) / 2);
    bounds.push(audio.sec);
  }
  return groups.map((g, b) => ({
    words: g.map(w => ({ ...w, start: w.start - bounds[b], end: w.end - bounds[b] })),
    duration: bounds[b + 1] - bounds[b],
  }));
}
