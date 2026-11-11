import { DEFAULT_GAP_SEC } from "@motion/player/queue";
import type { FollowAt, FollowScene, Passage, PassageBox } from "./types";

/** Boxes of the given passage ids, in the given order; unknown ids and duplicates are skipped. */
export function boxesFor(ids: string[], passages: Passage[]): PassageBox[] {
  const byId = new Map(passages.map(p => [p.id, p]));
  return [...new Set(ids)].flatMap(id => byId.get(id)?.boxes ?? []);
}

/** The spoken beat playing at t (scenes end to end with the queue's gap, like narrationLines). */
export function boxesAt(scenes: FollowScene[], t: number, gapSec = DEFAULT_GAP_SEC): FollowAt {
  let offset = 0, count = 0, at: FollowAt = { beat: -1, boxes: [] };
  for (const s of scenes) {
    for (const e of s.timeline.events) {
      if (e.verb !== "say") continue;
      if (offset + e.start <= t + .01) at = { beat: count, boxes: s.passages?.[e.beat] ?? [] };
      count++;
    }
    offset += s.timeline.totalSec + gapSec;
  }
  return at;
}

export const hasPassages = (scenes: FollowScene[]) => scenes.some(s => s.passages?.some(b => b.length));
