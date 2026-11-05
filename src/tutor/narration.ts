import type { Scene } from "@motion/dsl/schema";
import type { Timeline } from "@motion/dsl/compile";
import { DEFAULT_GAP_SEC } from "@motion/player/queue";

export type Line = { t: number; say: string };
/** Narration lines with global start times, from scenes laid end to end in play order. */
/** `gapSec` must match the SceneQueue's silent hold between scenes, or times drift per scene. */
export function narrationLines(scenes: { scene: Scene; timeline: Timeline }[], gapSec = DEFAULT_GAP_SEC): Line[] {
  let offset = 0;
  const out: Line[] = [];
  for (const { scene, timeline } of scenes) {
    for (const e of timeline.events) if (e.verb === "say") {
      const beat = scene.beats[e.beat];
      if (beat && "say" in beat) out.push({ t: offset + e.start, say: beat.say });
    }
    offset += timeline.totalSec + gapSec;
  }
  return out.sort((a, b) => a.t - b.t);
}
/** Everything narrated up to and including the line playing at t. */
export const transcriptUntil = (lines: Line[], t: number) => lines.filter(l => l.t <= t + .01).map(l => l.say).join(" ");
/** The narration line playing at t (the last line that started by t), or "" before the first line. */
export function nowSayingAt(lines: Line[], t: number): string {
  let cur = "";
  for (const l of lines) { if (l.t <= t + .01) cur = l.say; else break; }
  return cur;
}
