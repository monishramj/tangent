import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Captions, { captionCues, captionParts, type Cue } from "./Captions";
import { scene, timeline } from "@motion/stage/demo";

afterEach(cleanup);

it("cues come from say events with global times across scenes", () => {
  const one = captionCues([{ scene, timeline }]);
  const two = captionCues([{ scene, timeline }, { scene, timeline }]);
  expect(one.length).toBeGreaterThan(1);
  expect(two).toHaveLength(one.length * 2);
  expect(two[one.length].start).toBeCloseTo(timeline.totalSec + one[0].start, 6);
  for (const c of one) expect(c.end).toBeGreaterThan(c.start);
  const gapped = captionCues([{ scene, timeline }, { scene, timeline }], [0, timeline.totalSec + 0.6]);
  expect(gapped[one.length].start).toBeCloseTo(timeline.totalSec + 0.6 + one[0].start, 6);
});

it("long beats split at sentence ends into timed parts; short beats stay whole", () => {
  const short = captionParts({ start: 0, end: 2, text: "Heapify fixes one broken spot." });
  expect(short).toEqual([{ start: 0, end: 2, text: "Heapify fixes one broken spot." }]);
  const long = captionParts({ start: 10, end: 20, text: "First we build the heap from the bottom up, one level at a time. Then the parent swaps with its bigger child, and we check again one level down until nothing is out of place." });
  expect(long).toHaveLength(2);
  expect(long[0].text).toBe("First we build the heap from the bottom up, one level at a time.");
  expect(long[0].start).toBe(10);
  expect(long[1].start).toBeCloseTo(long[0].end, 9);
  expect(long[1].end).toBeCloseTo(20, 9);
});

const cues: Cue[] = [{ start: 0, end: 2, text: "Heapify fixes one broken spot." }, { start: 3, end: 5, text: "The parent swaps." }];

it("shows the line playing now as plain text, with no per-word marks", () => {
  render(<Captions cues={cues} time={1.2} />);
  const region = screen.getByRole("region", { name: "Captions" });
  expect(region.textContent).toBe("Heapify fixes one broken spot.");
  expect(region.querySelectorAll("[data-current]")).toHaveLength(0);
  expect(region.querySelectorAll("span")).toHaveLength(0);
});

it("changes per beat", () => {
  const { rerender } = render(<Captions cues={cues} time={1} />);
  rerender(<Captions cues={cues} time={3.5} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toBe("The parent swaps.");
});

it("holds the last line briefly, then clears; empty before the first cue", () => {
  const { rerender } = render(<Captions cues={cues} time={2.5} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toContain("Heapify");
  rerender(<Captions cues={cues} time={6} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toBe("");
  rerender(<Captions cues={[{ start: 1, end: 2, text: "Later." }]} time={0.5} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toBe("");
});
