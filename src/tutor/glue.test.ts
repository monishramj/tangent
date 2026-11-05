import { expect, it } from "vitest";
import { timeline } from "@motion/stage/demo";
import { beatStarts, stubProvider } from "./glue";
import { ask, buildTutorContext, resumeTime } from "./tutor";

it("beatStarts: ascending say-event starts, one per spoken beat", () => {
  const starts = beatStarts(timeline);
  const says = timeline.events.filter((e) => e.verb === "say");
  expect(starts).toHaveLength(says.length);
  expect(starts.length).toBeGreaterThan(1);
  expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  expect(resumeTime(starts, starts[1] + 0.5)).toBe(starts[1]);
});

it("stubProvider answers through ask() with no annotations", async () => {
  const context = buildTutorContext({ objects: [{ id: "h", type: "Array" }], transcript: "", section: "s", priorQuestions: [] });
  const r = await ask({ question: "why?", context, provider: stubProvider });
  expect(r.answer).toBeTruthy();
  expect(r.annotations).toEqual([]);
});
