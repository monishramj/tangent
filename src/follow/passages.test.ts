// Data package: passage ids → boxes, and which boxes the beat at time t draws from (docs/textbook-follow.md).
import { describe, expect, it } from "vitest";
import type { Timeline } from "@motion/dsl/compile";
import { boxesAt, boxesFor, hasPassages } from "./passages";
import type { BBox, FollowScene, Passage, PassageBox } from "./types";

const box = (page: number, y = 0.1): PassageBox => ({ page, bbox: [0.1, y, 0.9, y + 0.05] as BBox });
const passages: Passage[] = [
  { id: "p1", markdown: "one", boxes: [box(2)] },
  { id: "p2", markdown: "two", boxes: [box(2, 0.5), box(3)] }, // spans a page break
];

describe("boxesFor", () => {
  it("maps ids to their boxes in the given order, skipping unknown ids and duplicates", () => {
    expect(boxesFor(["p2", "p1"], passages)).toEqual([box(2, 0.5), box(3), box(2)]);
    expect(boxesFor(["p1", "nope", "p1"], passages)).toEqual([box(2)]);
    expect(boxesFor([], passages)).toEqual([]);
    expect(boxesFor(["p1"], [])).toEqual([]);
  });
});

// Two beats per scene: say events at 0 and 2 s; a reaction beat in scene 2 has no say and no boxes.
const tl = (says: [number, number][], totalSec: number) => ({
  events: says.map(([beat, start]) => ({ start, end: start + 1.5, verb: "say", beat, args: {} })), totalSec, insertedSilences: [],
}) as unknown as Timeline;
const scenes: FollowScene[] = [
  { scene: { beats: [{}, {}] }, timeline: tl([[0, 0], [1, 2]], 4), passages: [[box(2)], []] },
  { scene: { beats: [{}, {}, {}] }, timeline: tl([[0, 0], [2, 3]], 5), passages: [[box(3)], [], [box(4), box(5)]] },
];

describe("boxesAt", () => {
  it("returns the boxes of the beat playing at t, on the queue clock with the gap between scenes", () => {
    expect(boxesAt(scenes, -1)).toEqual({ beat: -1, boxes: [] });
    expect(boxesAt(scenes, 0)).toEqual({ beat: 0, boxes: [box(2)] });
    expect(boxesAt(scenes, 1.9)).toEqual({ beat: 0, boxes: [box(2)] });
    expect(boxesAt(scenes, 2)).toEqual({ beat: 1, boxes: [] });
    expect(boxesAt(scenes, 4.5)).toEqual({ beat: 1, boxes: [] }); // in the 0.6 s gap: still the last beat
    expect(boxesAt(scenes, 4.6)).toEqual({ beat: 2, boxes: [box(3)] });
    expect(boxesAt(scenes, 4.6 + 3)).toEqual({ beat: 3, boxes: [box(4), box(5)] }); // scene beat index 2, global beat 3
    expect(boxesAt(scenes, 999)).toEqual({ beat: 3, boxes: [box(4), box(5)] });
  });

  it("honours a custom gap", () => {
    expect(boxesAt(scenes, 5, 1)).toEqual({ beat: 2, boxes: [box(3)] });
    expect(boxesAt(scenes, 4.9, 1)).toEqual({ beat: 1, boxes: [] });
  });

  it("old scenes without a mapping give beats with no boxes", () => {
    const old = scenes.map(({ passages: _p, ...s }) => s);
    expect(boxesAt(old, 0)).toEqual({ beat: 0, boxes: [] });
    expect(boxesAt(old, 4.6)).toEqual({ beat: 2, boxes: [] });
  });
});

describe("hasPassages", () => {
  it("is true only when some scene carries a mapping with at least one box", () => {
    expect(hasPassages(scenes)).toBe(true);
    expect(hasPassages(scenes.map(({ passages: _p, ...s }) => s))).toBe(false);
    expect(hasPassages([{ ...scenes[0], passages: [[], []] }])).toBe(false);
    expect(hasPassages([])).toBe(false);
  });
});
