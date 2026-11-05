import type { Scene } from "@motion/dsl/schema";
import type { Timeline } from "@motion/dsl/compile";

export type Line = { t: number; say: string };
/** Narration lines with global start times, from scenes laid end to end in play order. */
export function narrationLines(scenes: { scene: Scene; timeline: Timeline }[]): Line[] {
  let offset = 0;
  const out: Line[] = [];
  for (const { scene, timeline } of scenes) {
    for (const e of timeline.events) if (e.verb === "say") {
      const beat = scene.beats[e.beat];
      if (beat && "say" in beat) out.push({ t: offset + e.start, say: beat.say });
    }
    offset += timeline.totalSec;
  }
  return out.sort((a, b) => a.t - b.t);
}
/** Everything narrated up to and including the line playing at t. */
export const transcriptUntil = (lines: Line[], t: number) => lines.filter(l => l.t <= t + .01).map(l => l.say).join(" ");
