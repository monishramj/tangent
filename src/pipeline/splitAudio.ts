import type { BeatAudio, Word } from "@motion/dsl/compile";

/**
 * Split one scene-wide alignment back into per-beat clips (times local to each clip).
 * Beats are cut at the midpoint of the silence between them, so clip durations sum to audio.sec
 * and the timeline (compiled with no extra beat pause) stays on the single wav's clock.
 * Mirrors the sidecar, which only aligns tokens containing [a-z'].
 */
export function splitBeatAudio(spoken: string[], audio: { sec: number; words: Word[] }): BeatAudio[] {
  const counts = spoken.map(s => s.split(/\s+/).filter(w => /[a-z']/i.test(w)).length);
  if (counts.includes(0) || counts.reduce((a, b) => a + b, 0) !== audio.words.length)
    throw new Error("Alignment does not match narration beats");
  let at = 0;
  const groups = counts.map(c => audio.words.slice(at, at += c));
  const bounds = groups.map((g, b) => b === 0 ? 0 : (groups[b - 1][groups[b - 1].length - 1].end + g[0].start) / 2);
  bounds.push(audio.sec);
  return groups.map((g, b) => ({
    words: g.map(w => ({ ...w, start: w.start - bounds[b], end: w.end - bounds[b] })),
    duration: bounds[b + 1] - bounds[b],
  }));
}
