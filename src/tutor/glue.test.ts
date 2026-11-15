import { expect, it } from "vitest";
import { timeline } from "@motion/stage/demo";
import { beatStarts, currentPassageIds, stubProvider } from "./glue";
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


it("selects ids by the active say event, with empty fallback for old scenes", () => {
  const tl = { ...timeline, totalSec: 4, events: [
    { ...timeline.events.find(e => e.verb === "say")!, verb: "say" as const, beat: 0, start: 0, end: 2 },
    { ...timeline.events.find(e => e.verb === "say")!, verb: "say" as const, beat: 2, start: 2, end: 4 },
  ] };
  const scenes = [{ timeline: tl, passageIds: [["p1"], [], ["p3", "p4"]] }, { timeline: tl }];
  expect(currentPassageIds(scenes, -1)).toEqual([]);
  expect(currentPassageIds(scenes, 0)).toEqual(["p1"]);
  expect(currentPassageIds(scenes, 2)).toEqual(["p3", "p4"]);
  expect(currentPassageIds(scenes, 4.4)).toEqual(["p3", "p4"]);
  expect(currentPassageIds(scenes, 4.6)).toEqual([]);
});
