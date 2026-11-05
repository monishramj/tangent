import { expect, it } from "vitest";
import { narrationLines, transcriptUntil } from "./narration";
import { scene, timeline } from "@motion/stage/demo";

it("lays scenes end to end and cuts the transcript at t", () => {
  const lines = narrationLines([{ scene, timeline }, { scene, timeline }]);
  expect(lines.length).toBeGreaterThanOrEqual(4);
  expect(lines[lines.length / 2].t).toBeCloseTo(timeline.totalSec);
  expect(transcriptUntil(lines, 0)).toBe(lines[0].say);
});
