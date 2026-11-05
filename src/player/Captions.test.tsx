import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Captions, { captionCues, pages, timeWords, type Cue } from "./Captions";
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

it("word times fill the cue in order, weighted by length", () => {
  const w = timeWords({ start: 10, end: 12, text: "a heapify" });
  expect(w.map(x => x.word)).toEqual(["a", "heapify"]);
  expect(w[0].start).toBe(10);
  expect(w[1].end).toBeCloseTo(12, 6);
  expect(w[1].end - w[1].start).toBeGreaterThan(w[0].end - w[0].start);
});

it("pages break at sentence ends and cap long runs", () => {
  const words = timeWords({ start: 0, end: 10, text: "First we build the heap. Then the parent swaps with its bigger child, and we check again one level down until nothing is out of place." });
  const p = pages(words, 14);
  expect(p[0].map(x => x.word).join(" ")).toBe("First we build the heap.");
  for (const page of p) expect(page.length).toBeLessThanOrEqual(14);
  expect(p.flat()).toHaveLength(words.length);
  expect(p[1][p[1].length - 1].word).toBe("child,"); // prefers the comma when it must break
});

const cues: Cue[] = [{ start: 0, end: 2, text: "Heapify fixes one broken spot." }, { start: 3, end: 5, text: "The parent swaps." }];

it("shows the cue playing now with exactly one current word, and only words before it marked said", () => {
  render(<Captions cues={cues} time={1.2} />);
  const region = screen.getByRole("region", { name: "Captions" });
  expect(region.textContent).toBe("Heapify fixes one broken spot.");
  const cur = region.querySelectorAll("[data-current]");
  expect(cur).toHaveLength(1);
  expect(["one", "broken"]).toContain(cur[0].textContent);
});

it("holds the last line briefly, then clears; empty before the first cue", () => {
  const { rerender } = render(<Captions cues={cues} time={2.5} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toContain("Heapify");
  rerender(<Captions cues={cues} time={6} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toBe("");
  rerender(<Captions cues={[{ start: 1, end: 2, text: "Later." }]} time={0.5} />);
  expect(screen.getByRole("region", { name: "Captions" }).textContent).toBe("");
});
