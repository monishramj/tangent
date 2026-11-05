import { expect, it } from "vitest";
import { narrationLines, transcriptUntil } from "./narration";
import { scene, timeline } from "@motion/stage/demo";

it("lays scenes end to end and cuts the transcript at t", () => {
  const lines = narrationLines([{ scene, timeline }, { scene, timeline }]);
  expect(lines.length).toBeGreaterThanOrEqual(4);
  expect(lines[lines.length / 2].t).toBeCloseTo(timeline.totalSec + 0.6);
  expect(transcriptUntil(lines, 0)).toBe(lines[0].say);
});

it("nowSayingAt returns the line playing at t", async () => {
  const { nowSayingAt } = await import("./narration");
  const lines = [{ t: 0, say: "One." }, { t: 2, say: "Two." }, { t: 5, say: "Three." }];
  expect(nowSayingAt(lines, -1)).toBe("");
  expect(nowSayingAt(lines, 0)).toBe("One.");
  expect(nowSayingAt(lines, 3.9)).toBe("Two.");
  expect(nowSayingAt(lines, 99)).toBe("Three.");
});
